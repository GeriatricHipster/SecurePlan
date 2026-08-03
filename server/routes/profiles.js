import { Router } from 'express';
import crypto from 'node:crypto';
import { assertSiteAccess, hasRole } from '../lib/auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { getProfile, getSite } from '../lib/resources.js';
import { serializeProfile } from '../lib/serializers.js';
import {
  booleanValue,
  colorValue,
  idValue,
  jsonArray,
  optionalNullableString,
  stringValue,
} from '../lib/validation.js';

export function createProfilesRouter({ db, auth, emitSiteUpdate }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/profiles', async (req, res) => {
    const siteId = optionalNullableString(req.query.siteId, 'siteId', 80);
    if (siteId) {
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId);
    }
    const rows = siteId
      ? await db
          .prepare(
            `SELECT * FROM icon_profiles
              WHERE is_builtin = 1 OR site_id IS NULL OR site_id = ?
              ORDER BY is_builtin DESC, category, name COLLATE NOCASE`,
          )
          .all(siteId)
      : await db
          .prepare(
            `SELECT * FROM icon_profiles
              WHERE is_builtin = 1 OR (site_id IS NULL AND (is_shared = 1 OR created_by = ?))
              ORDER BY is_builtin DESC, category, name COLLATE NOCASE`,
          )
          .all(req.user.id);
    const profiles = rows.map(serializeProfile);
    res.json({ data: profiles, profiles });
  });

  router.post('/profiles', async (req, res) => {
    const siteId = optionalNullableString(req.body?.siteId, 'siteId', 80) ?? null;
    if (siteId) {
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'editor');
    } else if (!req.user.workspace_access || !hasRole(req.user.role, 'editor')) {
      throw forbidden('A workspace editor or administrator is required to create workspace profiles.');
    }
    const values = validateProfile(req.body, false);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO icon_profiles
        (id, site_id, name, category, description, color, components_json, icon_data, is_shared,
         is_builtin, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(
      id,
      siteId,
      values.name,
      values.category,
      values.description,
      values.color,
      JSON.stringify(values.components),
      values.iconData,
      values.isShared ? 1 : 0,
      req.user.id,
      req.user.id,
      now,
      now,
    );
    const profile = serializeProfile(await getProfile(db, id));
    if (siteId) emitSiteUpdate(siteId, 'profile.created', req.user, { profile });
    res.status(201).json({ data: profile, profile });
  });

  router.patch('/profiles/:profileId', async (req, res) => {
    const profile = await getProfile(db, idValue(req.params.profileId, 'profileId'));
    if (profile.is_builtin) throw forbidden('Built-in profiles cannot be changed.');
    if (profile.site_id) await assertSiteAccess(db, req.user, profile.site_id, 'editor');
    else if (profile.created_by !== req.user.id && !hasRole(req.user.role, 'manager')) throw forbidden();
    const values = validateProfile(req.body, true);
    const merged = {
      name: values.name ?? profile.name,
      category: values.category ?? profile.category,
      description: values.description === undefined ? profile.description : values.description,
      color: values.color ?? profile.color,
      components: values.components ?? JSON.parse(profile.components_json || '[]'),
      iconData: values.iconData === undefined ? profile.icon_data : values.iconData,
      isShared: values.isShared === undefined ? Boolean(profile.is_shared) : values.isShared,
    };
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE icon_profiles
          SET name = ?, category = ?, description = ?, color = ?, components_json = ?, icon_data = ?,
              is_shared = ?, updated_by = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      merged.name,
      merged.category,
      merged.description,
      merged.color,
      JSON.stringify(merged.components),
      merged.iconData,
      merged.isShared ? 1 : 0,
      req.user.id,
      now,
      profile.id,
    );
    const updated = serializeProfile(await getProfile(db, profile.id));
    if (profile.site_id) emitSiteUpdate(profile.site_id, 'profile.updated', req.user, { profile: updated });
    res.json({ data: updated, profile: updated });
  });

  router.delete('/profiles/:profileId', async (req, res) => {
    const profile = await getProfile(db, idValue(req.params.profileId, 'profileId'));
    if (profile.is_builtin) throw forbidden('Built-in profiles cannot be deleted.');
    if (profile.site_id) await assertSiteAccess(db, req.user, profile.site_id, 'editor');
    else if (profile.created_by !== req.user.id && !hasRole(req.user.role, 'manager')) throw forbidden();
    await db.prepare('DELETE FROM icon_profiles WHERE id = ?').run(profile.id);
    if (profile.site_id) emitSiteUpdate(profile.site_id, 'profile.deleted', req.user, { profileId: profile.id });
    res.json({ data: { deletedId: profile.id }, success: true });
  });

  return router;
}

function validateProfile(body = {}, partial) {
  const components = body.components === undefined ? (partial ? undefined : []) : jsonArray(body.components, 'components');
  if (components && components.length > 100) throw badRequest('A profile may contain no more than 100 components.');
  if (components) {
    components.forEach((component, index) => {
      if (!component || typeof component !== 'object' || Array.isArray(component)) {
        throw badRequest(`components[${index}] must be an object.`);
      }
      stringValue(component.type, `components[${index}].type`, { max: 100 });
      stringValue(component.label || component.type, `components[${index}].label`, { max: 100 });
    });
    if (JSON.stringify(components).length > 65536) throw badRequest('Profile components may not exceed 64 KB.');
  }
  let iconData;
  if (body.iconData !== undefined) {
    iconData = optionalNullableString(body.iconData, 'iconData', 200000);
    if (iconData && !/^(data:image\/(png|jpeg|webp);base64,|[a-z0-9_-]{1,100}$)/i.test(iconData)) {
      throw badRequest('iconData must be a PNG, JPEG, or WebP data URL, or a built-in icon name.');
    }
  }
  return {
    name: body.name === undefined ? (partial ? undefined : stringValue(body.name, 'name')) : stringValue(body.name, 'name', { max: 140 }),
    category:
      body.category === undefined
        ? partial
          ? undefined
          : 'Custom'
        : stringValue(body.category, 'category', { max: 80 }),
    description:
      body.description === undefined ? undefined : optionalNullableString(body.description, 'description', 1000),
    color: body.color === undefined ? (partial ? undefined : '#DC2626') : colorValue(body.color),
    components,
    iconData,
    isShared: body.isShared === undefined ? (partial ? undefined : true) : booleanValue(body.isShared, 'isShared'),
  };
}
