import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkStorage, copyStoredFile, deleteStoredFile, storePdf, storePhoto, storedFileDelivery,
} from '../../server/lib/storage.js';

test('private cloud storage uploads, copies, signs, deletes, checks health, and removes temporary files', async () => {
  const calls = [];
  const storageClient = {
    async upload(key, bytes, options) {
      calls.push(['upload', key, bytes.length, options.contentType]);
      return { data: { path: key }, error: null };
    },
    async copy(source, target) {
      calls.push(['copy', source, target]);
      return { data: { path: target }, error: null };
    },
    async remove(keys) {
      calls.push(['remove', keys]);
      return { data: keys, error: null };
    },
    async createSignedUrl(key, seconds) {
      calls.push(['signed', key, seconds]);
      return { data: { signedUrl: `https://storage.example.test/${key}?signed=test` }, error: null };
    },
    async list(prefix, options) {
      calls.push(['list', prefix, options.limit]);
      return { data: [], error: null };
    },
  };
  const config = { cloudMode: true, storageClient };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-cloud-storage-'));
  try {
    const pdfPath = path.join(directory, 'pdf-upload');
    fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF');
    const pdfKey = await storePdf({ path: pdfPath }, config);
    assert.match(pdfKey, /^surveys\/[a-f0-9-]+\.pdf$/);
    assert.equal(fs.existsSync(pdfPath), false);

    const photoPath = path.join(directory, 'photo-upload');
    fs.writeFileSync(photoPath, Buffer.from([137, 80, 78, 71]));
    const photoKey = await storePhoto({ path: photoPath, mimetype: 'image/png' }, config);
    assert.match(photoKey, /^photos\/[a-f0-9-]+\.png$/);
    assert.equal(fs.existsSync(photoPath), false);

    const copiedKey = await copyStoredFile(pdfKey, 'survey', config);
    assert.match(copiedKey, /^surveys\/[a-f0-9-]+\.pdf$/);
    const delivery = await storedFileDelivery(pdfKey, 'survey', config);
    assert.match(delivery.url, /^https:\/\/storage\.example\.test\//);
    await deleteStoredFile(photoKey, 'photo', config);
    await checkStorage(config);
    assert.deepEqual(calls.map((call) => call[0]), ['upload', 'upload', 'copy', 'signed', 'remove', 'list']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cloud storage failures reject safely and still clean temporary uploads', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secureplan-cloud-storage-error-'));
  const temporaryPath = path.join(directory, 'failed-upload');
  fs.writeFileSync(temporaryPath, '%PDF-1.4\n%%EOF');
  const errorClient = {
    async upload() { return { data: null, error: new Error('provider rejected upload') }; },
    async createSignedUrl() { return { data: null, error: new Error('not found') }; },
    async copy() { return { data: null, error: new Error('copy failed') }; },
    async remove() { return { data: null, error: new Error('remove failed') }; },
    async list() { return { data: null, error: new Error('bucket unavailable') }; },
  };
  const config = { cloudMode: true, storageClient: errorClient };
  try {
    await assert.rejects(storePdf({ path: temporaryPath }, config), /Cloud file upload failed/);
    assert.equal(fs.existsSync(temporaryPath), false);
    await assert.rejects(storedFileDelivery('surveys/missing.pdf', 'survey', config), /could not be authorized/);
    await assert.rejects(copyStoredFile('surveys/missing.pdf', 'survey', config), /copy failed/);
    await assert.rejects(deleteStoredFile('photos/missing.png', 'photo', config), /deletion failed/);
    await assert.rejects(checkStorage(config), /readiness check failed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
