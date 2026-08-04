import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const projectRoot = process.cwd();
const readProjectFile = (relativePath) => readFileSync(path.join(projectRoot, relativePath));

function pngDimensions(relativePath) {
  const image = readProjectFile(relativePath);
  const expectedSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(image.subarray(0, 8), expectedSignature, `${relativePath} must be a PNG file`);
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

test('web app manifest supplies install metadata and correctly declared icons', () => {
  const manifest = JSON.parse(readProjectFile('public/manifest.webmanifest'));

  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.lang, 'en');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(manifest.categories, ['business', 'productivity', 'utilities']);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

  const iconsBySize = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));
  assert.equal(iconsBySize.get('192x192')?.src, '/app-icon-192.png');
  assert.equal(iconsBySize.get('512x512')?.src, '/app-icon-512.png');
  assert.ok(manifest.icons.every((icon) => icon.purpose === 'any'));
  assert.ok(manifest.icons.every((icon) => !icon.purpose.includes('maskable')));
  assert.deepEqual(pngDimensions('public/app-icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions('public/app-icon-512.png'), { width: 512, height: 512 });
});

test('document metadata agrees with the manifest and has one Apple touch icon', () => {
  const manifest = JSON.parse(readProjectFile('public/manifest.webmanifest'));
  const html = readProjectFile('index.html').toString('utf8');
  const themeColor = html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"\s*\/?>/i)?.[1];

  assert.equal(themeColor, manifest.theme_color);
  assert.match(html, new RegExp(`<html\\s+lang="${manifest.lang}"`, 'i'));
  assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/i);
  assert.equal(html.match(/rel="apple-touch-icon"/gi)?.length, 1);
});

function loadServiceWorker() {
  const handlers = {};
  const deletedCaches = [];
  const cache = {
    addAll: async () => {},
    put: async () => {},
  };
  const sandbox = {
    AbortController,
    Headers,
    Request,
    Response,
    URL,
    clearTimeout,
    console,
    fetch: async () => new Response('asset'),
    setTimeout,
    caches: {
      delete: async (key) => {
        deletedCaches.push(key);
        return true;
      },
      keys: async () => [
        'secureplan-shell-v2',
        'secureplan-shell-v3',
        'secureplan-static-v3',
        'another-app-cache',
      ],
      match: async () => undefined,
      open: async () => cache,
    },
    self: {
      addEventListener: (type, handler) => {
        handlers[type] = handler;
      },
      clients: { claim: async () => {} },
      location: { origin: 'https://secureplan.test' },
      skipWaiting: () => {},
    },
  };

  const source = readProjectFile('public/sw.js').toString('utf8');
  vm.runInNewContext(
    `${source}\nself.__test = { discoverShellUrls };`,
    sandbox,
    { filename: 'public/sw.js' },
  );
  return { deletedCaches, handlers, sandbox, source };
}

test('service worker discovers built assets and preserves unrelated caches', async () => {
  const { deletedCaches, handlers, sandbox, source } = loadServiceWorker();
  const discovered = sandbox.self.__test.discoverShellUrls(`
    <link rel="stylesheet" href="/assets/index-ABC123.css">
    <script type="module" src="/assets/index-XYZ789.js"></script>
    <img src="https://cdn.example.com/external.png">
    <a href="/api/session">API</a>
  `);

  assert.ok(discovered.includes('/assets/index-ABC123.css'));
  assert.ok(discovered.includes('/assets/index-XYZ789.js'));
  assert.ok(!discovered.includes('/api/session'));
  assert.ok(!discovered.includes('/external.png'));
  assert.match(source, /NETWORK_TIMEOUT_MS\s*=\s*4000/);
  assert.match(source, /caches\.match\('\/'\)/);

  let activation;
  handlers.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(deletedCaches, ['secureplan-shell-v2']);
});

test('service worker never intercepts API, Socket.IO, cross-origin, or authorized requests', () => {
  const { handlers } = loadServiceWorker();
  const wasIntercepted = (url, headers = {}) => {
    let intercepted = false;
    handlers.fetch({
      request: {
        destination: '',
        headers: new Headers(headers),
        method: 'GET',
        mode: 'cors',
        url,
      },
      respondWith: () => { intercepted = true; },
      waitUntil: () => {},
    });
    return intercepted;
  };

  assert.equal(wasIntercepted('https://secureplan.test/api/session'), false);
  assert.equal(wasIntercepted('https://secureplan.test/socket.io/?EIO=4'), false);
  assert.equal(wasIntercepted('https://cloud.example.com/photo.jpg'), false);
  assert.equal(wasIntercepted('https://secureplan.test/assets/app.js', { authorization: 'Bearer private' }), false);
  assert.equal(wasIntercepted('https://secureplan.test/assets/app.js', { range: 'bytes=0-99' }), false);
  assert.equal(wasIntercepted('https://secureplan.test/assets/app.js'), true);
});
