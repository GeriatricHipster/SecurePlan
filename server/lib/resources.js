import { notFound } from './errors.js';

export async function getSite(db, siteId) {
  const row = await db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  if (!row) throw notFound('Site');
  return row;
}

export async function getFolder(db, folderId) {
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  if (!row) throw notFound('Folder');
  return row;
}

export async function getSurvey(db, surveyId) {
  const row = await db
    .prepare(
      `SELECT s.*, u.name AS updated_by_name, u.email AS updated_by_email
         FROM surveys s
         LEFT JOIN users u ON u.id = s.updated_by
        WHERE s.id = ?`,
    )
    .get(surveyId);
  if (!row) throw notFound('Survey');
  return row;
}

export async function getElement(db, elementId) {
  const row = await db
    .prepare(
      `SELECT e.*, s.site_id, s.folder_id
         FROM elements e
         JOIN surveys s ON s.id = e.survey_id
        WHERE e.id = ?`,
    )
    .get(elementId);
  if (!row) throw notFound('Element');
  return row;
}

export async function getNote(db, noteId) {
  const row = await db
    .prepare(
      `SELECT n.*, e.survey_id, s.site_id
         FROM element_notes n
         JOIN elements e ON e.id = n.element_id
         JOIN surveys s ON s.id = e.survey_id
        WHERE n.id = ?`,
    )
    .get(noteId);
  if (!row) throw notFound('Note');
  return row;
}

export async function getPhoto(db, photoId) {
  const row = await db
    .prepare(
      `SELECT p.*, e.survey_id, s.site_id
         FROM element_photos p
         JOIN elements e ON e.id = p.element_id
         JOIN surveys s ON s.id = e.survey_id
        WHERE p.id = ?`,
    )
    .get(photoId);
  if (!row) throw notFound('Photo');
  return row;
}

export async function getProfile(db, profileId) {
  const row = await db.prepare('SELECT * FROM icon_profiles WHERE id = ?').get(profileId);
  if (!row) throw notFound('Profile');
  return row;
}
