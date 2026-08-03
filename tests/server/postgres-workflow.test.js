import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { createApplication } from '../../server/app.js';
import { createPostgresDatabase } from '../../server/lib/postgres.js';

test('complete survey workflow succeeds on PostgreSQL and rejects invalid or unauthorized changes', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = createPostgresDatabase({ databaseUrl: 'postgresql://test', databaseSsl: false }, new Pool());
  await db.ready;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-postgres-workflow-'));
  const cloudFiles = new Map();
  const storageClient = {
    async upload(key, bytes) {
      if (cloudFiles.has(key)) return { data: null, error: new Error('duplicate') };
      cloudFiles.set(key, Buffer.from(bytes));
      return { data: { path: key }, error: null };
    },
    async copy(source, target) {
      if (!cloudFiles.has(source)) return { data: null, error: new Error('missing') };
      cloudFiles.set(target, Buffer.from(cloudFiles.get(source)));
      return { data: { path: target }, error: null };
    },
    async remove(keys) {
      keys.forEach((key) => cloudFiles.delete(key));
      return { data: keys, error: null };
    },
    async download(key) {
      return cloudFiles.has(key)
        ? { data: new Blob([cloudFiles.get(key)]), error: null }
        : { data: null, error: new Error('missing') };
    },
    async list() { return { data: [...cloudFiles.keys()], error: null }; },
  };
  const runtime = createApplication({
    db,
    dataDir,
    databaseUrl: 'postgresql://injected-test-pool',
    supabaseUrl: 'https://test-project.supabase.co',
    supabaseSecretKey: 'sb_secret_test-only',
    supabaseStorageBucket: 'secureplan-files',
    storageClient,
    jwtSecret: 'secureplan-postgres-workflow-secret-at-least-32-characters',
    cookieSecure: false,
    staticDir: path.join(dataDir, 'no-static-build'),
  });
  const owner = request.agent(runtime.app);

  try {
    await owner.post('/api/auth/setup').send({
      name: 'Postgres Owner', email: 'postgres-owner@example.com', password: 'PostgresOwner123',
    }).expect(201);

    // Opening the seeded survey exercises the activity query used by SurveyEditor.
    const seededSite = await db.prepare("SELECT * FROM sites WHERE name = 'Demo Campus'").get();
    const seededSurvey = await db.prepare('SELECT * FROM surveys WHERE site_id = ?').get(seededSite.id);
    await owner.get(`/api/surveys/${seededSurvey.id}`).expect(200);

    const site = (await owner.post('/api/sites').send({ name: 'Workflow Site' }).expect(201)).body.data;
    await owner.patch(`/api/sites/${site.id}`).send({ name: 'Workflow Site Updated', address: '100 Test Way' }).expect(200);
    const folder = (await owner.post('/api/folders').send({ siteId: site.id, name: 'Building A' }).expect(201)).body.data;
    const destinationFolder = (await owner.post('/api/folders').send({ siteId: site.id, name: 'Building B' }).expect(201)).body.data;
    await owner.patch(`/api/folders/${folder.id}`).send({ name: 'Building A Updated' }).expect(200);
    await owner.post('/api/folders').send({ siteId: site.id, parentId: 'missing', name: 'Invalid' }).expect(404);

    const invalidPdf = Buffer.from('this is not a pdf');
    await owner.post('/api/surveys').field('siteId', site.id).field('name', 'Bad PDF')
      .attach('pdf', invalidPdf, { filename: 'bad.pdf', contentType: 'application/pdf' }).expect(400);

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    await owner.post('/api/surveys/batch').field('siteId', site.id).field('surveys', '[]').expect(400);
    await owner.post('/api/surveys/batch')
      .field('siteId', site.id).field('surveys', '[]')
      .attach('pdfs', pdf, { filename: 'unmatched.pdf', contentType: 'application/pdf' }).expect(400);
    const batch = (await owner.post('/api/surveys/batch')
      .field('siteId', site.id)
      .field('folderId', folder.id)
      .field('surveys', JSON.stringify([
        { name: 'North Wing', description: 'North-wing access control plan.' },
        { name: 'South Wing', description: '' },
      ]))
      .attach('pdfs', pdf, { filename: 'north.pdf', contentType: 'application/pdf' })
      .attach('pdfs', pdf, { filename: 'south.pdf', contentType: 'application/pdf' })
      .expect(201)).body.data;
    assert.equal(batch.length, 2);
    assert.equal(batch[0].description, 'North-wing access control plan.');
    assert.equal(batch[1].description, '');
    const batchElement = (await owner.post(`/api/surveys/${batch[0].id}/elements`).send({
      category: 'intrusion', type: 'motion', label: 'PIR-1', x: 0.1, y: 0.1,
      width: 0.04, height: 0.04, color: '#DC2626',
    }).expect(201)).body.data;
    assert.equal((await owner.get(`/api/surveys/${batch[0].id}/elements`).expect(200)).body.data.length, 1);
    assert.equal((await owner.get(`/api/surveys/${batch[1].id}/elements`).expect(200)).body.data.length, 0);
    await owner.delete(`/api/elements/${batchElement.id}`).expect(200);

    const survey = (await owner.post('/api/surveys')
      .field('siteId', site.id).field('folderId', folder.id).field('name', 'Floor 1')
      .attach('pdf', pdf, { filename: 'floor-1.pdf', contentType: 'application/pdf' }).expect(201)).body.data;
    assert.equal(survey.hasPdf, true);
    await owner.get(`/api/surveys/${survey.id}`).expect(200);
    await owner.get(`/api/surveys/${survey.id}/file`).expect(200).expect('Content-Type', /application\/pdf/);
    await request(runtime.app).get(`/api/surveys/${survey.id}/file`).expect(401);

    const element = (await owner.post(`/api/surveys/${survey.id}/elements`).send({
      category: 'cctv', type: 'camera', label: 'CAM-1', x: 0.25, y: 0.3,
      width: 0.05, height: 0.05, color: '#2563EB', metadata: { model: 'Test' },
    }).expect(201)).body.data;
    await owner.get(`/api/surveys/${survey.id}/elements`).expect(200);
    await owner.get(`/api/elements/${element.id}`).expect(200);
    await owner.patch(`/api/elements/${element.id}`).send({ color: 'blue' }).expect(400);
    await owner.patch(`/api/elements/${element.id}`).send({ rotation: 45, label: 'CAM-1A' }).expect(200);
    await owner.patch(`/api/surveys/${survey.id}/elements/bulk`).send({
      changes: [{ id: element.id, x: 0.4, y: 0.45, rotation: 90 }],
    }).expect(200);
    const duplicateElement = (await owner.post(`/api/elements/${element.id}/copy`).send({ offsetX: 0.05, offsetY: 0.05 }).expect(201)).body.data;
    await owner.post(`/api/elements/${element.id}/notes`).send({ text: '' }).expect(400);
    const note = (await owner.post(`/api/elements/${element.id}/notes`).send({ text: 'Check field of view.' }).expect(201)).body.data;
    await owner.get(`/api/elements/${element.id}/notes`).expect(200);
    await owner.patch(`/api/notes/${note.id}`).send({ text: 'Confirm final field of view.' }).expect(200);

    const invalidImage = Buffer.from('not an image');
    await owner.post(`/api/elements/${element.id}/photos`)
      .attach('photo', invalidImage, { filename: 'bad.png', contentType: 'image/png' }).expect(400);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const photo = (await owner.post(`/api/elements/${element.id}/photos`)
      .field('caption', 'Camera location')
      .attach('photo', png, { filename: 'camera.png', contentType: 'image/png' }).expect(201)).body.data;
    await owner.get(`/api/photos/${photo.id}/file`).expect(200).expect('Content-Type', /image\/png/);
    await owner.get(`/api/elements/${element.id}/photos`).expect(200);

    const profile = (await owner.post('/api/profiles').send({
      siteId: site.id, name: 'Custom Camera', category: 'Custom', color: '#7C3AED',
      components: [{ category: 'cctv', type: 'camera', label: 'CAM' }],
    }).expect(201)).body.data;
    await owner.get(`/api/profiles?siteId=${site.id}`).expect(200);
    await owner.patch(`/api/profiles/${profile.id}`).send({ name: 'Custom Camera Updated' }).expect(200);

    await owner.post(`/api/surveys/${survey.id}/rotate`).send({ rotation: 45 }).expect(400);
    await owner.post(`/api/surveys/${survey.id}/rotate`).send({ rotation: 90 }).expect(200);
    const copy = (await owner.post(`/api/surveys/${survey.id}/copy`).send({ name: 'Floor 1 Copy' }).expect(201)).body.data;
    await owner.get(`/api/surveys/${copy.id}`).expect(200);
    await owner.post(`/api/surveys/${copy.id}/move`).send({ siteId: site.id, folderId: destinationFolder.id }).expect(200);

    const invite = (await owner.post('/api/invitations').send({
      siteId: site.id, role: 'viewer', maxUses: 1, expiresInDays: 7,
    }).expect(201)).body.data;
    const revokedInvite = (await owner.post('/api/invitations').send({
      siteId: site.id, role: 'installer', maxUses: 1, expiresInDays: 7,
    }).expect(201)).body.data;
    await owner.get(`/api/invitations?siteId=${site.id}`).expect(200);
    await owner.delete(`/api/invitations/${revokedInvite.id}`).expect(200);
    const viewer = request.agent(runtime.app);
    await viewer.post('/api/auth/register').send({
      name: 'Read Only', email: 'readonly@example.com', password: 'ReadOnlyViewer123', inviteCode: invite.code,
    }).expect(201);
    await viewer.get(`/api/surveys/${survey.id}`).expect(200);
    await viewer.patch(`/api/elements/${element.id}`).send({ x: 0.5 }).expect(403);
    await viewer.delete(`/api/surveys/${survey.id}`).expect(403);
    await owner.get(`/api/members?siteId=${site.id}`).expect(200);
    const viewerRecord = await db.prepare("SELECT * FROM users WHERE email = 'readonly@example.com'").get();
    await owner.patch(`/api/members/${viewerRecord.id}`).send({ siteId: site.id, role: 'installer' }).expect(200);

    await owner.delete(`/api/notes/${note.id}`).expect(200);
    await owner.delete(`/api/photos/${photo.id}`).expect(200);
    await owner.delete(`/api/elements/${duplicateElement.id}`).expect(200);
    await owner.delete(`/api/profiles/${profile.id}`).expect(200);
    await owner.delete(`/api/surveys/${copy.id}`).expect(200);
    await owner.get(`/api/surveys/${copy.id}`).expect(404);
    await owner.delete(`/api/surveys/${batch[0].id}`).expect(200);
    await owner.delete(`/api/surveys/${batch[1].id}`).expect(200);
    await owner.delete(`/api/members/${viewerRecord.id}?siteId=${site.id}`).expect(200);
    await owner.get('/api/auth/me').expect(200);
  } finally {
    await runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
