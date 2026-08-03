import crypto from 'node:crypto';
import { copyStoredFile, deleteStoredFile } from './storage.js';

export async function cloneSurvey(db, config, sourceSurvey, target, actorId, options = {}) {
  const now = new Date().toISOString();
  const surveyId = crypto.randomUUID();
  const createdFiles = [];
  let pdfKey = null;

  try {
    if (sourceSurvey.storage_key) {
      pdfKey = await copyStoredFile(sourceSurvey.storage_key, 'survey', config);
      createdFiles.push({ key: pdfKey, kind: 'survey' });
    }

    const transaction = db.transaction(async () => {
      const nextOrder =
        (await db
          .prepare(
            `SELECT COALESCE(MAX(order_index), -1) + 1 AS value
               FROM surveys WHERE site_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')`,
          )
          .get(target.siteId, target.folderId || null)).value || 0;

      await db.prepare(
        `INSERT INTO surveys
          (id, site_id, folder_id, name, description, original_filename, storage_key, mime_type, size_bytes,
           rotation, order_index, version, copied_from, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      ).run(
        surveyId,
        target.siteId,
        target.folderId || null,
        target.name,
        sourceSurvey.description,
        sourceSurvey.original_filename,
        pdfKey,
        sourceSurvey.mime_type,
        sourceSurvey.size_bytes,
        sourceSurvey.rotation,
        nextOrder,
        sourceSurvey.id,
        actorId,
        actorId,
        now,
        now,
      );

      const profileMap = options.profileMap || new Map();
      const elements = await db.prepare('SELECT * FROM elements WHERE survey_id = ? ORDER BY z_index, created_at').all(sourceSurvey.id);
      const insertElement = db.prepare(`
        INSERT INTO elements
          (id, survey_id, profile_id, category, type, label, x, y, width, height, rotation, color,
           z_index, locked, metadata_json, created_by, updated_by, created_at, updated_at)
        VALUES
          (@id, @surveyId, @profileId, @category, @type, @label, @x, @y, @width, @height, @rotation,
           @color, @zIndex, @locked, @metadataJson, @actorId, @actorId, @now, @now)
      `);
      const insertNote = db.prepare(`
        INSERT INTO element_notes
          (id, element_id, body, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertPhoto = db.prepare(`
        INSERT INTO element_photos
          (id, element_id, original_filename, storage_key, mime_type, size_bytes, caption, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const element of elements) {
        const elementId = crypto.randomUUID();
        let profileId = profileMap.get(element.profile_id) || element.profile_id;
        if (profileId) {
          const accessibleProfile = await db
            .prepare('SELECT id FROM icon_profiles WHERE id = ? AND (site_id IS NULL OR site_id = ?)')
            .get(profileId, target.siteId);
          if (!accessibleProfile) profileId = null;
        }
        await insertElement.run({
          id: elementId,
          surveyId,
          profileId,
          category: element.category,
          type: element.type,
          label: element.label,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
          color: element.color,
          zIndex: element.z_index,
          locked: element.locked,
          metadataJson: element.metadata_json,
          actorId,
          now,
        });

        for (const note of await db.prepare('SELECT * FROM element_notes WHERE element_id = ?').all(element.id)) {
          await insertNote.run(crypto.randomUUID(), elementId, note.body, actorId, actorId, now, now);
        }
        for (const photo of await db.prepare('SELECT * FROM element_photos WHERE element_id = ?').all(element.id)) {
          const photoKey = await copyStoredFile(photo.storage_key, 'photo', config);
          createdFiles.push({ key: photoKey, kind: 'photo' });
          await insertPhoto.run(
            crypto.randomUUID(),
            elementId,
            photo.original_filename,
            photoKey,
            photo.mime_type,
            photo.size_bytes,
            photo.caption,
            actorId,
            now,
          );
        }
      }
    });
    await transaction();
    return db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  } catch (error) {
    for (const file of createdFiles) await deleteStoredFile(file.key, file.kind, config);
    throw error;
  }
}

export async function cloneSite(db, config, sourceSite, name, actorId) {
  const now = new Date().toISOString();
  const siteId = crypto.randomUUID();
  const profileMap = new Map();
  const folderMap = new Map();

  const createBase = db.transaction(async () => {
    const orderIndex = (await db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM sites').get()).value;
    await db.prepare(
      `INSERT INTO sites
        (id, name, address, description, order_index, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(siteId, name, sourceSite.address, sourceSite.description, orderIndex, actorId, actorId, now, now);
    await db.prepare(
      `INSERT INTO site_members (site_id, user_id, role, added_by, created_at, updated_at)
       VALUES (?, ?, 'admin', ?, ?, ?)`,
    ).run(siteId, actorId, actorId, now, now);

    for (const profile of await db.prepare('SELECT * FROM icon_profiles WHERE site_id = ? AND is_builtin = 0').all(sourceSite.id)) {
      const newId = crypto.randomUUID();
      profileMap.set(profile.id, newId);
      await db.prepare(
        `INSERT INTO icon_profiles
          (id, site_id, name, category, description, color, components_json, icon_data, is_shared,
           is_builtin, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        newId,
        siteId,
        profile.name,
        profile.category,
        profile.description,
        profile.color,
        profile.components_json,
        profile.icon_data,
        profile.is_shared,
        actorId,
        actorId,
        now,
        now,
      );
    }

    const pending = await db.prepare('SELECT * FROM folders WHERE site_id = ? ORDER BY created_at, order_index').all(sourceSite.id);
    while (pending.length) {
      const before = pending.length;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const folder = pending[index];
        if (folder.parent_id && !folderMap.has(folder.parent_id)) continue;
        const newId = crypto.randomUUID();
        folderMap.set(folder.id, newId);
        await db.prepare(
          `INSERT INTO folders
            (id, site_id, parent_id, name, order_index, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId,
          siteId,
          folder.parent_id ? folderMap.get(folder.parent_id) : null,
          folder.name,
          folder.order_index,
          actorId,
          actorId,
          now,
          now,
        );
        pending.splice(index, 1);
      }
      if (pending.length === before) throw new Error('The folder tree contains an invalid cycle.');
    }
  });
  await createBase();

  try {
    const surveys = await db.prepare('SELECT * FROM surveys WHERE site_id = ? ORDER BY created_at').all(sourceSite.id);
    for (const survey of surveys) {
      await cloneSurvey(
        db,
        config,
        survey,
        {
          siteId,
          folderId: survey.folder_id ? folderMap.get(survey.folder_id) : null,
          name: survey.name,
        },
        actorId,
        { profileMap },
      );
    }
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  } catch (error) {
    const fileRows = await db
      .prepare(
        `SELECT storage_key, 'survey' AS kind FROM surveys WHERE site_id = ? AND storage_key IS NOT NULL
         UNION ALL
         SELECT p.storage_key, 'photo' AS kind
           FROM element_photos p
           JOIN elements e ON e.id = p.element_id
           JOIN surveys s ON s.id = e.survey_id
          WHERE s.site_id = ?`,
      )
      .all(siteId, siteId);
    await db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
    for (const file of fileRows) await deleteStoredFile(file.storage_key, file.kind, config);
    throw error;
  }
}

export async function cloneFolderTree(db, config, sourceFolder, targetParentId, name, actorId) {
  const now = new Date().toISOString();
  const folderMap = new Map();
  const rootId = crypto.randomUUID();

  const descendants = await db
    .prepare(
      `WITH RECURSIVE descendants AS (
         SELECT * FROM folders WHERE id = ?
         UNION ALL
         SELECT f.* FROM folders f JOIN descendants d ON f.parent_id = d.id
       ) SELECT * FROM descendants`,
    )
    .all(sourceFolder.id);
  const pending = [...descendants];
  const insertFolders = db.transaction(async () => {
    while (pending.length) {
      const before = pending.length;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const folder = pending[index];
        if (folder.id !== sourceFolder.id && !folderMap.has(folder.parent_id)) continue;
        const newId = folder.id === sourceFolder.id ? rootId : crypto.randomUUID();
        folderMap.set(folder.id, newId);
        const parentId = folder.id === sourceFolder.id ? targetParentId : folderMap.get(folder.parent_id);
        const orderIndex = (await db
          .prepare("SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM folders WHERE site_id = ? AND COALESCE(parent_id, '') = COALESCE(?, '')")
          .get(sourceFolder.site_id, parentId || null)).value;
        await db.prepare(
          `INSERT INTO folders
            (id, site_id, parent_id, name, order_index, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId,
          sourceFolder.site_id,
          parentId || null,
          folder.id === sourceFolder.id ? name : folder.name,
          orderIndex,
          actorId,
          actorId,
          now,
          now,
        );
        pending.splice(index, 1);
      }
      if (pending.length === before) throw new Error('The folder tree contains an invalid cycle.');
    }
  });
  await insertFolders();

  try {
    for (const folder of descendants) {
      for (const survey of await db.prepare('SELECT * FROM surveys WHERE folder_id = ?').all(folder.id)) {
        await cloneSurvey(
          db,
          config,
          survey,
          { siteId: sourceFolder.site_id, folderId: folderMap.get(folder.id), name: survey.name },
          actorId,
        );
      }
    }
    return db.prepare('SELECT * FROM folders WHERE id = ?').get(rootId);
  } catch (error) {
    await db.prepare('DELETE FROM folders WHERE id = ?').run(rootId);
    throw error;
  }
}
