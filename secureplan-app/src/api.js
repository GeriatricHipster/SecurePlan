import { Capacitor } from '@capacitor/core';

/**
 * SecurePlan Surveyor same-origin API client with offline caching/queueing.
 *
 * GET requests are cached in IndexedDB so surveys open faster and can be
 * viewed while offline after they have been loaded once.
 *
 * Mutation requests are queued when the network is unavailable and replayed
 * automatically when the browser comes back online.
 */

const nativeClient = Capacitor.isNativePlatform();
const configuredApiBase = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
let nativeSessionToken = null;

const DB_NAME = 'secureplan-offline';
const DB_VERSION = 1;
const RESPONSE_STORE = 'responses';
const QUEUE_STORE = 'queue';
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

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

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESPONSE_STORE)) db.createObjectStore(RESPONSE_STORE);
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
}

async function dbGet(storeName, key) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
  });
}

async function dbPut(storeName, value, key = undefined) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = key === undefined ? store.put(value) : store.put(value, key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB write failed'));
  });
}

async function dbDelete(storeName, key) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
  });
}

async function dbAll(storeName) {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('IndexedDB list failed'));
  });
}

function storageKey(path, method = 'GET') {
  return `${nativeClient ? 'native:' : 'web:'}${method}:${path}`;
}

function isOfflineError(error) {
  return !navigator.onLine || error?.name === 'TypeError' || /failed to fetch/i.test(error?.message || '');
}

function canQueue(path, method) {
  if (method === 'GET') return false;
  if (path.startsWith('/api/auth/')) return false;
  return true;
}

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function serializeBody(body) {
  if (body == null) return null;
  if (body instanceof FormData) {
    const entries = [];
    for (const [key, value] of body.entries()) {
      if (value instanceof File || value instanceof Blob) {
        const file = value;
        entries.push({
          key,
          kind: 'file',
          name: file.name || 'upload.bin',
          type: file.type || 'application/octet-stream',
          data: bufferToBase64(await file.arrayBuffer()),
        });
      } else {
        entries.push({ key, kind: 'text', value: String(value) });
      }
    }
    return { kind: 'form', entries };
  }
  if (typeof body === 'string') return { kind: 'text', value: body };
  if (typeof body === 'object') return { kind: 'json', value: body };
  return { kind: 'text', value: String(body) };
}

function restoreBody(serialized) {
  if (!serialized) return undefined;
  if (serialized.kind === 'json') return serialized.value;
  if (serialized.kind === 'text') return serialized.value;
  if (serialized.kind === 'form') {
    const form = new FormData();
    for (const entry of serialized.entries || []) {
      if (entry.kind === 'file') {
        const blob = new Blob([base64ToBuffer(entry.data)], { type: entry.type || 'application/octet-stream' });
        form.append(entry.key, new File([blob], entry.name || 'upload.bin', { type: entry.type || blob.type }));
      } else {
        form.append(entry.key, entry.value);
      }
    }
    return form;
  }
  return undefined;
}

function previewBody(body) {
  if (body == null) return null;
  if (body instanceof FormData) {
    const preview = {};
    for (const [key, value] of body.entries()) {
      preview[key] = value instanceof File ? value.name : String(value);
    }
    return preview;
  }
  if (typeof body === 'object') return structuredClone(body);
  return body;
}

function syntheticQueuedResponse(path, method, body) {
  const now = new Date().toISOString();
  const preview = previewBody(body) || {};

  if (method === 'POST' && /\/api\/surveys\/[^/]+\/elements$/.test(path)) {
    return {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      offlineQueued: true,
      ...preview,
    };
  }

  if (method === 'POST' && /\/api\/elements\/[^/]+\/photos$/.test(path)) {
    return {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      caption: preview.caption || '',
      offlineQueued: true,
    };
  }

  if (method === 'POST' && /\/api\/surveys($|\/batch)/.test(path)) {
    return {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      offlineQueued: true,
      ...preview,
    };
  }

  if (method === 'PATCH') {
    return {
      offlineQueued: true,
      ...preview,
    };
  }

  if (method === 'DELETE') {
    return { offlineQueued: true };
  }

  return {
    offlineQueued: true,
    ...preview,
  };
}

async function queueMutation(path, method, options) {
  const queued = {
    id: crypto.randomUUID(),
    path,
    method,
    headers: options.headers || {},
    body: await serializeBody(options.body),
    queuedAt: Date.now(),
  };
  await dbPut(QUEUE_STORE, queued);
  return queued;
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
  const method = String(options.method || 'GET').toUpperCase();
  const cacheKey = storageKey(path, method);

  if (method === 'GET') {
    try {
      const response = await fetchApi(path, options);
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : await response.text();

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

      const value = payload?.data ?? payload;
      await dbPut(RESPONSE_STORE, { key: cacheKey, value, cachedAt: Date.now() }, cacheKey);
      return value;
    } catch (error) {
      const cached = await dbGet(RESPONSE_STORE, cacheKey).catch(() => undefined);
      if (cached) return cached.value;
      throw error;
    }
  }

  try {
    const response = await fetchApi(path, options);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

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
  } catch (error) {
    if (canQueue(path, method) && isOfflineError(error)) {
      await queueMutation(path, method, options);
      return syntheticQueuedResponse(path, method, options.body);
    }
    throw error;
  }
}

async function flushOfflineQueue() {
  const items = (await dbAll(QUEUE_STORE)).sort((a, b) => a.queuedAt - b.queuedAt);
  for (const item of items) {
    try {
      await request(item.path, {
        method: item.method,
        headers: item.headers,
        body: restoreBody(item.body),
      });
      await dbDelete(QUEUE_STORE, item.id);
    } catch (error) {
      // Stop on the first failure so we keep the queue in order.
      throw error;
    }
  }
  return { synced: true, remaining: 0 };
}

if (typeof window !== 'undefined' && !window.__secureplanOfflineSyncHooked) {
  window.__secureplanOfflineSyncHooked = true;
  window.addEventListener('online', () => {
    flushOfflineQueue().catch(() => {});
  });
}

const json = (method, body) => ({ method, body });

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  me: () => request('/api/auth/me'),
  setupOwner: (values) => request('/api/auth/setup', json('POST', values)),
  login: (values) => request('/api/auth/login', json('POST', values)),
  register: (values) => request('/api/auth/register', json('POST', values)),
  forgotPassword: (email) => request('/api/auth/forgot-password', json('POST', { email })),
  resetPassword: (values) => request('/api/auth/reset-password', json('POST', values)),
  adminResetPassword: (userId) => request(`/api/members/${userId}/reset-password`, json('POST')),
  changePassword: (values) => request('/api/auth/change-password', json('POST', values)),
  adminResetPassword: (userId) => request(`/api/members/${userId}/reset-password`, json('POST')),
  logout: async () => {
    try { return await request('/api/auth/logout', json('POST')); }
    finally { nativeSessionToken = null; }
  },
  sites: () => request('/api/sites'),
  search: (query) => request(`/api/search?q=${encodeURIComponent(query)}`),
  activity: (params = {}) => {
    const search = new URLSearchParams();
    if (params.siteId) search.set('siteId', params.siteId);
    if (params.surveyId) search.set('surveyId', params.surveyId);
    if (params.limit) search.set('limit', params.limit);
    const suffix = search.toString();
    return request(`/api/activity${suffix ? `?${suffix}` : ''}`);
  },
  dashboardSummary: () => request('/api/dashboard-summary'),
  notifyAboutElement: (elementId, values) => request(`/api/elements/${elementId}/notify`, json('POST', values)),
  notifyRecipients: (elementId) => request(`/api/elements/${elementId}/notify-recipients`),
  surveyAssignments: (surveyId) => request(`/api/surveys/${surveyId}/assignments`),
  assignableUsers: (surveyId) => request(`/api/surveys/${surveyId}/assignable-users`),
  assignToSurvey: (surveyId, userId) => request(`/api/surveys/${surveyId}/assignments`, json('POST', { userId })),
  unassignFromSurvey: (surveyId, userId) => request(`/api/surveys/${surveyId}/assignments/${userId}`, json('DELETE')),
  reports: (surveyId) => request(`/api/surveys/${surveyId}/reports`),
  createReport: (surveyId, form) => request(`/api/surveys/${surveyId}/reports`, { method: 'POST', body: form }),
  deleteReport: (reportId) => request(`/api/reports/${reportId}`, json('DELETE')),
  reportRecipients: (surveyId) => request(`/api/surveys/${surveyId}/report-recipients`),
  sendReport: (reportId, values) => request(`/api/reports/${reportId}/send`, json('POST', values)),
  reportPhotoUrl: (photoId) => apiUrl(`/api/report-photos/${photoId}/file`),
  securityEvents: (limit = 100) => request(`/api/security-events?limit=${limit}`),
  site: (id) => request(`/api/sites/${id}`),
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
  copySurvey: (id, values) => request(`/api/surveys/${id}/copy`, json('POST', values)),
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
  checklist: (elementId) => request(`/api/elements/${elementId}/checklist`),
  addChecklistItem: (elementId, values) => request(`/api/elements/${elementId}/checklist`, json('POST', values)),
  updateChecklistItem: (itemId, values) => request(`/api/checklist-items/${itemId}`, json('PATCH', values)),
  deleteChecklistItem: (itemId) => request(`/api/checklist-items/${itemId}`, json('DELETE')),
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
  reportPhotoBlob: async (id) => {
    const response = await fetchApi(`/api/report-photos/${id}/file`);
    if (!response.ok) throw new Error(`Photo download failed (${response.status}).`);
    return response.blob();
  },
  notifications: (limit = 50) => request(`/api/notifications?limit=${limit}`),
  unreadNotificationCount: () => request('/api/notifications/unread-count'),
  markNotificationRead: (id) => request(`/api/notifications/${id}/read`, json('POST')),
  markAllNotificationsRead: () => request('/api/notifications/mark-all-read', json('POST')),
  messages: (limit = 100) => request(`/api/messages?limit=${limit}`),
  createMessage: (form) => request('/api/messages', { method: 'POST', body: form }),
  messageRecipients: () => request('/api/message-recipients'),
  deleteMessage: (id) => request(`/api/messages/${id}`, json('DELETE')),
  messageAttachmentUrl: (id) => apiUrl(`/api/message-attachments/${id}/file`),
  messageAttachmentBlob: async (id) => {
    const response = await fetchApi(`/api/message-attachments/${id}/file`);
    if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
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
  flushOfflineQueue,
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
