import { Capacitor } from '@capacitor/core';

/**
 * SecurePlan Surveyor same-origin API client.
 *
 * Every endpoint returns JSON shaped as `{ data }` unless noted. Mutations use
 * JSON except survey and photo uploads, which use multipart FormData.
 */

const nativeClient = Capacitor.isNativePlatform();
const configuredApiBase = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
let nativeSessionToken = null;

function apiUrl(path) {
  if (!nativeClient) return path;
  if (!configuredApiBase) {
    throw new Error('This native build is missing VITE_API_URL. Rebuild it with the hosted SecurePlan server URL.');
  }
  return new URL(path, `${configuredApiBase}/`).toString();
}

function requestHeaders(headers = {}) {
  if (!nativeClient) return headers;
  return {
    'X-SecurePlan-Client': 'native',
    ...(nativeSessionToken ? { Authorization: `Bearer ${nativeSessionToken}` } : {}),
    ...headers,
  };
}

async function fetchApi(path, options = {}) {
  const { body, headers, ...rest } = options;
  const isForm = body instanceof FormData;
  const response = await fetch(apiUrl(path), {
    ...rest,
    credentials: nativeClient ? 'omit' : 'include',
    headers: requestHeaders({
      ...(!isForm && body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    }),
    body: body == null || isForm ? body : JSON.stringify(body),
  });
  if (nativeClient && response.status === 401) nativeSessionToken = null;
  return response;
}

async function request(path, options = {}) {
  const response = await fetchApi(path, options);

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || payload?.error || payload?.message || `Request failed (${response.status})`,
    );
    error.status = response.status;
    error.details = payload?.error?.details || payload?.details;
    error.code = payload?.error?.code;
    error.requestId = payload?.requestId || response.headers.get('x-request-id');
    if (error.requestId && response.status >= 500) error.message += ` Reference: ${error.requestId}`;
    throw error;
  }

  const issuedToken = payload?.data?.sessionToken || payload?.sessionToken;
  if (nativeClient && issuedToken) nativeSessionToken = issuedToken;

  return payload?.data ?? payload;
}

const json = (method, body) => ({ method, body });

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  me: () => request('/api/auth/me'),
  setupOwner: (values) => request('/api/auth/setup', json('POST', values)),
  login: (values) => request('/api/auth/login', json('POST', values)),
  register: (values) => request('/api/auth/register', json('POST', values)),
  logout: async () => {
    try { return await request('/api/auth/logout', json('POST')); }
    finally { nativeSessionToken = null; }
  },

  sites: () => request('/api/sites'),
  createSite: (values) => request('/api/sites', json('POST', values)),
  updateSite: (id, values) => request(`/api/sites/${id}`, json('PATCH', values)),
  deleteSite: (id, confirmation) => request(`/api/sites/${id}`, json('DELETE', { confirmation })),
  copySite: (id) => request(`/api/sites/${id}/copy`, json('POST')),
  reorderSites: (siteIds) => request('/api/sites/reorder', json('POST', { siteIds })),

  folders: (siteId) => request(`/api/folders?siteId=${encodeURIComponent(siteId)}`),
  createFolder: (values) => request('/api/folders', json('POST', values)),
  updateFolder: (id, values) => request(`/api/folders/${id}`, json('PATCH', values)),
  deleteFolder: (id, recursive = true) => request(`/api/folders/${id}?recursive=${recursive ? 'true' : 'false'}`, json('DELETE')),
  copyFolder: (id) => request(`/api/folders/${id}/copy`, json('POST')),
  moveFolder: (id, values) => request(`/api/folders/${id}/move`, json('POST', values)),

  surveys: (siteId, folderId) => {
    const query = new URLSearchParams({ siteId });
    if (folderId) query.set('folderId', folderId);
    return request(`/api/surveys?${query}`);
  },
  survey: (id) => request(`/api/surveys/${id}`),
  createSurvey: ({ file, ...values }) => {
    const form = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value != null) form.append(key, value);
    });
    if (file) form.append('pdf', file);
    return request('/api/surveys', { method: 'POST', body: form });
  },
  createSurveysBatch: ({ files, surveys, ...values }) => {
    const form = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value != null) form.append(key, value);
    });
    files.forEach((file) => form.append('pdfs', file));
    form.append('surveys', JSON.stringify(surveys));
    return request('/api/surveys/batch', { method: 'POST', body: form });
  },
  updateSurvey: (id, values) => request(`/api/surveys/${id}`, json('PATCH', values)),
  deleteSurvey: (id) => request(`/api/surveys/${id}`, json('DELETE')),
  copySurvey: (id) => request(`/api/surveys/${id}/copy`, json('POST')),
  moveSurvey: (id, values) => request(`/api/surveys/${id}/move`, json('POST', values)),
  rotateSurvey: (id, orientation) => request(`/api/surveys/${id}/rotate`, json('POST', { rotation: orientation })),
  surveyFileUrl: (id) => apiUrl(`/api/surveys/${id}/file`),
  surveyFileRequest: (id) => ({
    url: apiUrl(`/api/surveys/${id}/file`),
    withCredentials: !nativeClient,
    httpHeaders: nativeClient && nativeSessionToken ? { Authorization: `Bearer ${nativeSessionToken}` } : undefined,
  }),

  elements: (surveyId) => request(`/api/surveys/${surveyId}/elements`),
  createElement: (surveyId, values) => request(`/api/surveys/${surveyId}/elements`, json('POST', values)),
  updateElement: (id, values) => request(`/api/elements/${id}`, json('PATCH', values)),
  deleteElement: (id) => request(`/api/elements/${id}`, json('DELETE')),
  notes: (id) => request(`/api/elements/${id}/notes`),
  photos: (id) => request(`/api/elements/${id}/photos`),
  addNote: (id, text) => request(`/api/elements/${id}/notes`, json('POST', { text })),
  addPhoto: (id, file, caption = '') => {
    const form = new FormData();
    form.append('photo', file);
    if (caption) form.append('caption', caption);
    return request(`/api/elements/${id}/photos`, { method: 'POST', body: form });
  },
  photoUrl: (id) => apiUrl(`/api/photos/${id}/file`),
  photoBlob: async (id) => {
    const response = await fetchApi(`/api/photos/${id}/file`);
    if (!response.ok) throw new Error(`Photo download failed (${response.status}).`);
    return response.blob();
  },

  profiles: () => request('/api/profiles'),
  createProfile: (values) => request('/api/profiles', json('POST', values)),
  updateProfile: (id, values) => request(`/api/profiles/${id}`, json('PATCH', values)),
  deleteProfile: (id) => request(`/api/profiles/${id}`, json('DELETE')),

  members: () => request('/api/members'),
  updateMember: (id, values) => request(`/api/members/${id}`, json('PATCH', values)),
  removeMember: (id) => request(`/api/members/${id}`, json('DELETE')),
  invitations: () => request('/api/invitations'),
  createInvitation: (values) => request('/api/invitations', json('POST', values)),
  revokeInvitation: (id) => request(`/api/invitations/${id}`, json('DELETE')),
};

export const nativeTransport = {
  isNative: nativeClient,
  apiOrigin: nativeClient && configuredApiBase ? new URL(configuredApiBase).origin : undefined,
  sessionToken: () => nativeSessionToken,
};

export function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.sites)) return value.sites;
  if (Array.isArray(value?.folders)) return value.folders;
  if (Array.isArray(value?.surveys)) return value.surveys;
  if (Array.isArray(value?.elements)) return value.elements;
  if (Array.isArray(value?.profiles)) return value.profiles;
  if (Array.isArray(value?.members)) return value.members;
  if (Array.isArray(value?.invitations)) return value.invitations;
  return [];
}
