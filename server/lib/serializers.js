import { publicUser } from './auth.js';

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function serializeUser(row) {
  return publicUser(row);
}

export function serializeSite(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    description: row.description,
    orderIndex: row.order_index,
    role: row.access_role || row.role,
    folderCount: Number(row.folder_count || 0),
    surveyCount: Number(row.survey_count || 0),
    memberCount: Number(row.member_count || 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeFolder(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    parentId: row.parent_id,
    name: row.name,
    orderIndex: row.order_index,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeSurvey(row) {
  const lastEditor = row.updated_by_name
    ? { id: row.updated_by, name: row.updated_by_name, email: row.updated_by_email }
    : null;
  return {
    id: row.id,
    siteId: row.site_id,
    folderId: row.folder_id,
    name: row.name,
    originalFilename: row.original_filename,
    hasPdf: Boolean(row.storage_key),
    pdfUrl: row.storage_key ? `/api/surveys/${row.id}/file` : null,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    rotation: Number(row.rotation || 0),
    orientation: Number(row.rotation || 0),
    orderIndex: Number(row.order_index || 0),
    version: Number(row.version || 1),
    copiedFrom: row.copied_from,
    elementCount: Number(row.element_count || 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    lastEditor,
    lastEditedBy: lastEditor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeElement(row) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    profileId: row.profile_id,
    category: row.category,
    type: row.type,
    label: row.label,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    rotation: Number(row.rotation),
    color: row.color,
    zIndex: Number(row.z_index),
    locked: Boolean(row.locked),
    metadata: parseJson(row.metadata_json, {}),
    noteCount: Number(row.note_count || 0),
    photoCount: Number(row.photo_count || 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeNote(row) {
  return {
    id: row.id,
    elementId: row.element_id,
    body: row.body,
    author: row.author_name ? { id: row.created_by, name: row.author_name, email: row.author_email } : null,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializePhoto(row) {
  return {
    id: row.id,
    elementId: row.element_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    caption: row.caption,
    url: `/api/photos/${row.id}/file`,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function serializeProfile(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    category: row.category,
    description: row.description,
    color: row.color,
    components: parseJson(row.components_json, []),
    iconData: row.icon_data,
    isShared: Boolean(row.is_shared),
    isBuiltin: Boolean(row.is_builtin),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeInvitation(row) {
  return {
    id: row.id,
    codeLastFour: row.code_last_four,
    email: row.email,
    siteId: row.site_id,
    siteName: row.site_name,
    role: row.role,
    maxUses: Number(row.max_uses),
    useCount: Number(row.use_count),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function serializeMember(row) {
  const role = row.site_role || row.global_role || row.role;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    globalRole: row.global_role || row.role,
    siteId: row.site_id,
    siteRole: row.site_role,
    role,
    createdAt: row.created_at,
  };
}
