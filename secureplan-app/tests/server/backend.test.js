import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import { createApplication } from '../../server/app.js';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-server-test-'));
let runtime;
let owner;
let site;
let folder;
let survey;
let element;

before(() => {
  runtime = createApplication({
    dataDir: testDataDir,
    jwtSecret: 'secureplan-test-secret-at-least-thirty-two-characters',
    cookieSecure: false,
    frontendOrigin: 'http://localhost:3000',
    mobileOrigins: ['capacitor://localhost', 'ionic://localhost'],
    staticDir: path.join(testDataDir, 'no-static-build'),
  });
  owner = request.agent(runtime.app);
});

after(async () => {
  await runtime.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('owner setup, protected workspace CRUD, cloud files, and invitation roles', async () => {
  const initial = await owner.get('/api/bootstrap').expect(200);
  assert.equal(initial.body.data.setupRequired, true);

  const setup = await owner
    .post('/api/auth/setup')
    .send({ name: 'Workspace Owner', email: 'owner@example.com', password: 'LaunchReady123' })
    .expect(201);
  assert.equal(setup.body.data.user.role, 'owner');
  assert.equal(setup.body.data.user.workspaceAccess, true);
  assert.equal(setup.body.data.sessionToken, undefined);
  await request(runtime.app).post('/api/auth/setup').send({ name: 'Other', email: 'other@example.com', password: 'LaunchReady123' }).expect(409);

  const siteResponse = await owner
    .post('/api/sites')
    .send({ name: 'University Hospital', address: '100 Main Street', description: 'Security survey site' })
    .expect(201);
  site = siteResponse.body.data;
  assert.equal(site.address, '100 Main Street');

  folder = (
    await owner.post('/api/folders').send({ siteId: site.id, name: 'Main Building' }).expect(201)
  ).body.data;
  const nestedFolder = (
    await owner
      .post('/api/folders')
      .send({ siteId: site.id, parentId: folder.id, name: 'First Floor' })
      .expect(201)
  ).body.data;

  survey = (
    await owner
      .post('/api/surveys')
      .field('siteId', site.id)
      .field('folderId', nestedFolder.id)
      .field('name', 'A101 Blank Survey')
      .expect(201)
  ).body.data;
  assert.equal(survey.hasPdf, false);

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const pdfSurvey = (
    await owner
      .post('/api/surveys')
      .field('siteId', site.id)
      .field('folderId', nestedFolder.id)
      .field('name', 'A102 Floor Plan')
      .attach('pdf', pdf, { filename: 'A102.pdf', contentType: 'application/pdf' })
      .expect(201)
  ).body.data;
  assert.equal(pdfSurvey.hasPdf, true);
  const protectedPdf = await owner.get(`/api/surveys/${pdfSurvey.id}/file`).expect(200);
  assert.match(protectedPdf.headers['cache-control'], /no-store/);
  await request(runtime.app).get(`/api/surveys/${pdfSurvey.id}/file`).expect(401);

  element = (
    await owner
      .post(`/api/surveys/${survey.id}/elements`)
      .send({
        category: 'access-control',
        type: 'card-reader',
        label: 'CR-101',
        x: 0.35,
        y: 0.42,
        width: 0.04,
        height: 0.04,
        color: '#7C3AED',
        metadata: { manufacturer: 'Demo', model: 'R-100' },
      })
      .expect(201)
  ).body.data;
  assert.equal(element.color, '#7C3AED');
  assert.equal(element.width, 0.04);

  const defaultBlueElement = (
    await owner
      .post(`/api/surveys/${survey.id}/elements`)
      .send({ category: 'cctv', type: 'fixed_camera', label: 'CAM-BLUE', x: 0.2, y: 0.2 })
      .expect(201)
  ).body.data;
  assert.equal(defaultBlueElement.color, '#1769AA');
  const manuallyColored = (await owner.patch(`/api/elements/${defaultBlueElement.id}`).send({ color: '#E11D48' }).expect(200)).body.data;
  assert.equal(manuallyColored.color, '#E11D48');
  const statusChanged = (await owner.patch(`/api/elements/${defaultBlueElement.id}`).send({ metadata: { workflowStatus: 'complete' } }).expect(200)).body.data;
  assert.equal(statusChanged.color, '#E11D48');
  assert.equal(statusChanged.metadata.workflowStatus, 'complete');
  await owner.delete(`/api/elements/${defaultBlueElement.id}`).expect(200);

  const note = await owner.post(`/api/elements/${element.id}/notes`).send({ text: 'Verify wall construction.' }).expect(201);
  assert.equal(note.body.data.author.name, 'Workspace Owner');

  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const filesBeforeRejectedPhoto = fs.readdirSync(runtime.config.photoFilesDir).sort();
  await owner
    .post(`/api/elements/${element.id}/photos`)
    .field('caption', 'x'.repeat(1001))
    .attach('photo', pngHeader, { filename: 'rejected.png', contentType: 'image/png' })
    .expect(400);
  assert.deepEqual(fs.readdirSync(runtime.config.photoFilesDir).sort(), filesBeforeRejectedPhoto);
  const photo = await owner
    .post(`/api/elements/${element.id}/photos`)
    .field('caption', 'Door 101 field condition')
    .attach('photo', pngHeader, { filename: 'door-101.png', contentType: 'image/png' })
    .expect(201);
  const photoResponse = await owner.get(`/api/photos/${photo.body.data.id}/file`).expect(200);
  assert.match(photoResponse.headers['cache-control'], /no-store/);

  const profile = await owner
    .post('/api/profiles')
    .send({
      name: 'Full Door Custom',
      category: 'Custom',
      color: '#B91C1C',
      components: [
        { category: 'access-control', type: 'card-reader', label: 'CR' },
        { category: 'access-control', type: 'door-position-switch', label: 'DPS' },
        { category: 'access-control', type: 'request-to-exit', label: 'REX' },
        { category: 'doors', type: 'door-lock', label: 'DL' },
      ],
    })
    .expect(201);
  assert.equal(profile.body.data.components.length, 4);

  const copiedSite = await owner
    .post(`/api/sites/${site.id}/copy`)
    .send({ name: 'University Hospital Copy' })
    .expect(201);
  const copiedSurveys = await owner.get(`/api/surveys?siteId=${copiedSite.body.data.id}`).expect(200);
  assert.equal(copiedSurveys.body.data.length, 2);
  const copiedPdf = copiedSurveys.body.data.find((item) => item.hasPdf);
  await owner.get(`/api/surveys/${copiedPdf.id}/file`).expect(200);

  const globalInvite = await owner
    .post('/api/invitations')
    .send({ role: 'editor', maxUses: 1, expiresInDays: 7 })
    .expect(201);
  assert.match(globalInvite.body.data.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const editor = request.agent(runtime.app);
  const registration = await editor
    .post('/api/auth/register')
    .send({
      name: 'Survey Editor',
      email: 'editor@example.com',
      password: 'EditorAccess123',
      inviteCode: globalInvite.body.data.code,
    })
    .expect(201);
  assert.equal(registration.body.data.user.workspaceAccess, true);
  assert.equal((await editor.get('/api/sites').expect(200)).body.data.length >= 3, true);
  await editor.patch(`/api/elements/${element.id}`).send({ color: '#059669', x: 0.4 }).expect(200);
  await editor.post('/api/invitations').send({ role: 'viewer', expiresInDays: 7 }).expect(403);

  const scopedInvite = await owner
    .post('/api/invitations')
    .send({ siteId: site.id, role: 'viewer', maxUses: 1, expiresInDays: 7 })
    .expect(201);
  const viewer = request.agent(runtime.app);
  const viewerRegistration = await viewer
    .post('/api/auth/register')
    .send({
      name: 'Site Viewer',
      email: 'viewer@example.com',
      password: 'ViewerAccess123',
      inviteCode: scopedInvite.body.data.code,
    })
    .expect(201);
  assert.equal(viewerRegistration.body.data.user.workspaceAccess, false);
  const viewerSites = await viewer.get('/api/sites').expect(200);
  assert.deepEqual(viewerSites.body.data.map((value) => value.id), [site.id]);
  await viewer.patch(`/api/elements/${element.id}`).send({ x: 0.5 }).expect(403);

  const copy = await owner.post(`/api/surveys/${survey.id}/copy`).send({ name: 'A101 Copy' }).expect(201);
  assert.equal(copy.body.data.copiedFrom, survey.id);
  assert.equal((await owner.get(`/api/surveys/${copy.body.data.id}/elements`).expect(200)).body.data.length, 1);

  await editor.post('/api/auth/logout').expect(200);
  await editor.get('/api/auth/me').expect(401);

  await owner.delete(`/api/members/${registration.body.data.user.id}`).expect(200);
  await editor.post('/api/auth/login').send({ email: 'editor@example.com', password: 'EditorAccess123' }).expect(401);
  const restoreInvite = await owner
    .post('/api/invitations')
    .send({ role: 'installer', email: 'editor@example.com', maxUses: 1, expiresInDays: 7 })
    .expect(201);
  const restored = await editor
    .post('/api/auth/register')
    .send({
      name: 'Restored Survey Editor',
      email: 'editor@example.com',
      password: 'RestoredAccess123',
      inviteCode: restoreInvite.body.data.code,
    })
    .expect(201);
  assert.equal(restored.body.data.user.id, registration.body.data.user.id);
  assert.equal(restored.body.data.user.role, 'installer');
  assert.equal((await editor.get('/api/sites').expect(200)).body.data.length >= 3, true);
});

test('Socket.IO authenticates, joins survey rooms, reports presence, and receives persisted updates', async () => {
  await new Promise((resolve) => runtime.httpServer.listen(0, '127.0.0.1', resolve));
  const address = runtime.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await request(baseUrl)
    .post('/api/auth/login')
    .send({ email: 'owner@example.com', password: 'LaunchReady123' })
    .expect(200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];

  const socket = connectSocket(baseUrl, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: 'http://localhost:3000' },
    forceNew: true,
  });
  await once(socket, 'connect');
  const presencePromise = once(socket, 'survey:presence');
  const joined = await new Promise((resolve) => socket.emit('survey:join', { surveyId: survey.id }, resolve));
  assert.equal(joined.ok, true);
  const presence = await presencePromise;
  assert.equal(presence.users[0].email, 'owner@example.com');

  const updatePromise = once(socket, 'survey:updated');
  await request(baseUrl)
    .patch(`/api/elements/${element.id}`)
    .set('Cookie', cookie)
    .send({ label: 'CR-101A' })
    .expect(200);
  const update = await updatePromise;
  assert.equal(update.action, 'element.updated');
  assert.equal(update.elementId, element.id);
  assert.equal(update.user.email, 'owner@example.com');

  socket.disconnect();
});

test('native opt-in returns a bearer token for HTTP, protected files, and Socket.IO without exposing it to web login', async () => {
  const address = runtime.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const webLogin = await request(baseUrl)
    .post('/api/auth/login')
    .send({ email: 'owner@example.com', password: 'LaunchReady123' })
    .expect(200);
  assert.equal(webLogin.body.data.sessionToken, undefined);

  const preflight = await request(baseUrl)
    .options('/api/auth/login')
    .set('Origin', 'capacitor://localhost')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,x-secureplan-client,content-type')
    .expect(204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'capacitor://localhost');
  assert.equal(preflight.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);
  assert.match(preflight.headers['access-control-allow-headers'], /X-SecurePlan-Client/);

  const nativeLogin = await request(baseUrl)
    .post('/api/auth/login')
    .set('Origin', 'capacitor://localhost')
    .set('X-SecurePlan-Client', 'native')
    .send({ email: 'owner@example.com', password: 'LaunchReady123' })
    .expect(200);
  const token = nativeLogin.body.data.sessionToken;
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(nativeLogin.body.data.user.email, 'owner@example.com');
  assert.equal(nativeLogin.headers['access-control-allow-origin'], 'capacitor://localhost');
  assert.equal(nativeLogin.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(Array.isArray(nativeLogin.headers['set-cookie']), true, 'native opt-in must not disable the existing cookie');

  const nativeInvite = await request(baseUrl)
    .post('/api/invitations')
    .set('Origin', 'capacitor://localhost')
    .set('Authorization', `Bearer ${token}`)
    .send({ role: 'viewer', maxUses: 1, expiresInDays: 7 })
    .expect(201);
  const nativeRegistration = await request(baseUrl)
    .post('/api/auth/register')
    .set('Origin', 'capacitor://localhost')
    .set('X-SecurePlan-Client', 'native')
    .send({
      name: 'Native Viewer',
      email: 'native-viewer@example.com',
      password: 'NativeViewer123',
      inviteCode: nativeInvite.body.data.code,
    })
    .expect(201);
  assert.match(nativeRegistration.body.data.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const me = await request(baseUrl)
    .get('/api/auth/me')
    .set('Origin', 'capacitor://localhost')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(me.body.data.user.email, 'owner@example.com');

  const surveys = await request(baseUrl)
    .get(`/api/surveys?siteId=${site.id}`)
    .set('Origin', 'capacitor://localhost')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const pdfSurvey = surveys.body.data.find((item) => item.hasPdf);
  assert.ok(pdfSurvey);
  await request(baseUrl)
    .get(`/api/surveys/${pdfSurvey.id}/file`)
    .set('Origin', 'capacitor://localhost')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
    .expect('Cache-Control', /no-store/);

  await request(baseUrl)
    .get('/api/auth/me')
    .set('Authorization', 'Bearer malformed-token')
    .expect(401);
  await request(baseUrl)
    .get('/api/auth/me')
    .set('Origin', 'capacitor://attacker')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);

  const nativeSocket = connectSocket(baseUrl, {
    transports: ['websocket'],
    auth: { token },
    extraHeaders: { Origin: 'capacitor://localhost' },
    forceNew: true,
  });
  await once(nativeSocket, 'connect');
  const presencePromise = once(nativeSocket, 'survey:presence');
  const joined = await new Promise((resolve) => nativeSocket.emit('survey:join', { surveyId: survey.id }, resolve));
  assert.equal(joined.ok, true);
  const presence = await presencePromise;
  assert.equal(presence.users.some((user) => user.email === 'owner@example.com'), true);
  nativeSocket.disconnect();
});

test('an optional deployment setup code protects first-owner creation', async () => {
  const protectedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-setup-code-test-'));
  const protectedRuntime = createApplication({
    dataDir: protectedDataDir,
    jwtSecret: 'secureplan-protected-setup-test-secret-at-least-32-characters',
    setupCode: 'PRIVATE-FIRST-RUN-CODE',
    cookieSecure: false,
    staticDir: path.join(protectedDataDir, 'no-static-build'),
  });
  try {
    const bootstrap = await request(protectedRuntime.app).get('/api/bootstrap').expect(200);
    assert.equal(bootstrap.body.data.setupCodeRequired, true);
    const ownerDetails = { name: 'Protected Owner', email: 'protected@example.com', password: 'ProtectedOwner123' };
    await request(protectedRuntime.app).post('/api/auth/setup').send({ ...ownerDetails, setupCode: 'WRONG' }).expect(403);
    const nativeSetup = await request(protectedRuntime.app)
      .post('/api/auth/setup')
      .set('X-SecurePlan-Client', 'native')
      .send({ ...ownerDetails, setupCode: 'PRIVATE-FIRST-RUN-CODE' })
      .expect(201);
    assert.match(nativeSetup.body.data.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  } finally {
    await protectedRuntime.close();
    fs.rmSync(protectedDataDir, { recursive: true, force: true });
  }
});

test('production refuses unprotected first-owner setup', async () => {
  const productionDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-production-setup-test-'));
  const productionRuntime = createApplication({
    dataDir: productionDataDir,
    nodeEnv: 'production',
    jwtSecret: 'secureplan-production-setup-test-secret-at-least-32-characters',
    setupCode: '',
    cookieSecure: false,
    staticDir: path.join(productionDataDir, 'no-static-build'),
  });
  try {
    const bootstrap = await request(productionRuntime.app).get('/api/bootstrap').expect(200);
    assert.equal(bootstrap.body.data.setupRequired, true);
    assert.equal(bootstrap.body.data.setupCodeRequired, true);
    const response = await request(productionRuntime.app)
      .post('/api/auth/setup')
      .send({
        name: 'Unprotected Owner',
        email: 'unprotected@example.com',
        password: 'UnprotectedOwner123',
        setupCode: 'ANYTHING',
      })
      .expect(403);
    assert.match(response.body.error.message, /SETUP_CODE/);
  } finally {
    await productionRuntime.close();
    fs.rmSync(productionDataDir, { recursive: true, force: true });
  }
});

test('production static shell supports GET and HEAD with secure cache headers', async () => {
  const staticDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-static-test-'));
  const staticDir = path.join(staticDataDir, 'dist');
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>SecurePlan</title>');
  fs.writeFileSync(path.join(staticDir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  fs.writeFileSync(path.join(staticDir, 'assets', 'app-test.js'), 'export default true;');
  const staticRuntime = createApplication({
    dataDir: staticDataDir,
    nodeEnv: 'production',
    jwtSecret: 'secureplan-static-test-secret-at-least-thirty-two-characters',
    setupCode: 'STATIC-TEST-SETUP-CODE',
    cookieSecure: false,
    staticDir,
  });
  try {
    await request(staticRuntime.app)
      .head('/surveys/example')
      .expect(200)
      .expect('Cache-Control', /no-cache/)
      .expect('Content-Security-Policy', /default-src 'self'/);
    await request(staticRuntime.app).get('/sw.js').expect(200).expect('Cache-Control', /no-cache/);
    await request(staticRuntime.app)
      .get('/assets/app-test.js')
      .expect(200)
      .expect('Cache-Control', /max-age=31536000, immutable/);
  } finally {
    await staticRuntime.close();
    fs.rmSync(staticDataDir, { recursive: true, force: true });
  }
});

test('readiness checks SQLite and persistent storage while liveness remains independent', async () => {
  const healthy = await request(runtime.app).get('/api/health').expect(200);
  assert.equal(healthy.body.data.database, 'ok');
  assert.equal(healthy.body.data.storage.status, 'ok');
  assert.equal(Number.isFinite(healthy.body.data.storage.freeBytes), true);
  await request(runtime.app).get('/api/health/ready').expect(200);
  await request(runtime.app).get('/api/health/live').expect(200);

  const lowStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-low-storage-test-'));
  const lowStorageRuntime = createApplication({
    dataDir: lowStorageDir,
    jwtSecret: 'secureplan-low-storage-test-secret-at-least-32-characters',
    cookieSecure: false,
    minFreeStorageBytes: Number.MAX_SAFE_INTEGER,
    staticDir: path.join(lowStorageDir, 'no-static-build'),
  });
  try {
    const readiness = await request(lowStorageRuntime.app).get('/api/health').expect(503);
    assert.equal(readiness.body.error.code, 'NOT_READY');
    await request(lowStorageRuntime.app).get('/api/health/live').expect(200);
  } finally {
    await lowStorageRuntime.close();
    fs.rmSync(lowStorageDir, { recursive: true, force: true });
  }
});

test('production proxy/origin handling emits HSTS and rejects an unexpected browser origin', async () => {
  const originDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-origin-test-'));
  const originRuntime = createApplication({
    dataDir: originDataDir,
    nodeEnv: 'production',
    jwtSecret: 'secureplan-origin-test-secret-at-least-thirty-two-characters',
    setupCode: 'ORIGIN-TEST-SETUP-CODE',
    frontendOrigin: 'https://survey.example.com/',
    trustProxy: 1,
    cookieSecure: true,
    staticDir: path.join(originDataDir, 'no-static-build'),
  });
  try {
    const allowed = await request(originRuntime.app)
      .get('/api/health/live')
      .set('Origin', 'https://survey.example.com')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://survey.example.com');
    assert.match(allowed.headers['strict-transport-security'], /max-age=31536000/);
    const setup = await request(originRuntime.app)
      .post('/api/auth/setup')
      .set('Origin', 'https://survey.example.com')
      .set('X-Forwarded-Proto', 'https')
      .send({
        name: 'Origin Owner',
        email: 'origin-owner@example.com',
        password: 'OriginOwner123',
        setupCode: 'ORIGIN-TEST-SETUP-CODE',
      })
      .expect(201);
    const sessionCookie = setup.headers['set-cookie'].join('; ');
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /Secure/);
    assert.match(sessionCookie, /SameSite=Strict/);
    const rejected = await request(originRuntime.app)
      .get('/api/health/live')
      .set('Origin', 'https://unexpected.example.net')
      .expect(403);
    assert.equal(rejected.body.error.code, 'ORIGIN_NOT_ALLOWED');
  } finally {
    await originRuntime.close();
    fs.rmSync(originDataDir, { recursive: true, force: true });
  }
});

function once(emitter, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeout);
    function cleanup() {
      clearTimeout(timer);
      emitter.off(event, handler);
      emitter.off('connect_error', onError);
    }
    function handler(value) {
      cleanup();
      resolve(value);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    emitter.once(event, handler);
    emitter.once('connect_error', onError);
  });
}
