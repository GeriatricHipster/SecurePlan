const CACHE_PREFIX = 'secureplan-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-v3`;
const STATIC_CACHE = `${CACHE_PREFIX}static-v3`;
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);
const NETWORK_TIMEOUT_MS = 4000;
const CORE_SHELL_URLS = [
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/app-icon-192.png',
  '/app-icon-512.png',
];

function isBackendRequest(url) {
  return url.pathname === '/api'
    || url.pathname.startsWith('/api/')
    || url.pathname === '/socket.io'
    || url.pathname.startsWith('/socket.io/');
}

function isCacheable(response) {
  return response?.ok && (response.type === 'basic' || response.type === 'default');
}

function discoverShellUrls(html) {
  const urls = new Set(CORE_SHELL_URLS);
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/gi;
  let match;

  while ((match = attributePattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && !isBackendRequest(url)) {
        urls.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // Ignore malformed and non-URL attributes in the application shell.
    }
  }

  return [...urls];
}

async function precacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  const rootResponse = await fetch(new Request('/', { cache: 'reload' }));

  if (!isCacheable(rootResponse)) {
    throw new Error('SecurePlan application shell could not be cached.');
  }

  const html = await rootResponse.clone().text();
  await cache.put('/', rootResponse);
  const shellRequests = discoverShellUrls(html)
    .filter((url) => url !== '/')
    .map((url) => new Request(url, { cache: 'reload' }));
  await cache.addAll(shellRequests);
}

async function fetchWithTimeout(request, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function navigationResponse(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (isCacheable(response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cachedPage = await caches.match(request, { ignoreSearch: true });
    return cachedPage || caches.match('/');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const networkResponse = fetch(request).then(async (response) => {
    if (isCacheable(response)) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  });

  if (cached) {
    event.waitUntil(networkResponse.catch(() => undefined));
    return cached;
  }

  return networkResponse;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin
    || isBackendRequest(url)
    || event.request.headers.has('authorization')
    || event.request.headers.has('range')
  ) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(navigationResponse(event.request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (['style', 'script', 'worker', 'font', 'image', 'manifest'].includes(event.request.destination)) {
    event.respondWith(staleWhileRevalidate(event.request, event));
  }
});
