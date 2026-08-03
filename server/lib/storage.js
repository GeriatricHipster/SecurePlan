import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { badRequest } from './errors.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
]);

export function validatePdfUpload(file) {
  if (!file) throw badRequest('A PDF file is required.', { field: 'pdf' });
  const descriptor = fs.openSync(file.path, 'r');
  try {
    const header = Buffer.alloc(5);
    fs.readSync(descriptor, header, 0, 5, 0);
    if (header.toString('ascii') !== '%PDF-') throw badRequest('The uploaded file is not a valid PDF.', { field: 'pdf' });
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validatePhotoUpload(file) {
  if (!file) throw badRequest('A photo is required.', { field: 'photo' });
  if (!IMAGE_TYPES.has(file.mimetype)) {
    throw badRequest('Photo must be JPEG, PNG, WebP, GIF, HEIC, or HEIF.', { field: 'photo' });
  }
  const bytes = fs.readFileSync(file.path, { encoding: null, flag: 'r' }).subarray(0, 16);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isGif = bytes.subarray(0, 6).toString('ascii').startsWith('GIF8');
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const brand = bytes.subarray(4, 12).toString('ascii');
  const isHeif = brand.includes('ftyp');
  if (!isJpeg && !isPng && !isGif && !isWebp && !isHeif) {
    throw badRequest('The uploaded photo format could not be verified.', { field: 'photo' });
  }
}

export async function storePdf(file, config) {
  const storageKey = config.cloudMode ? `surveys/${crypto.randomUUID()}.pdf` : `${crypto.randomUUID()}.pdf`;
  if (config.cloudMode) await uploadCloudFile(file, storageKey, 'application/pdf', config);
  else fs.renameSync(file.path, path.join(config.surveyFilesDir, storageKey));
  return storageKey;
}

export async function storePhoto(file, config) {
  const name = `${crypto.randomUUID()}${IMAGE_EXTENSIONS.get(file.mimetype) || '.image'}`;
  const storageKey = config.cloudMode ? `photos/${name}` : name;
  if (config.cloudMode) await uploadCloudFile(file, storageKey, file.mimetype, config);
  else fs.renameSync(file.path, path.join(config.photoFilesDir, storageKey));
  return storageKey;
}

export async function copyStoredFile(sourceKey, kind, config) {
  if (!sourceKey) return null;
  const extension = path.extname(sourceKey).slice(0, 10);
  const name = `${crypto.randomUUID()}${extension}`;
  const targetKey = config.cloudMode ? `${kind === 'survey' ? 'surveys' : 'photos'}/${name}` : name;
  if (config.cloudMode) {
    const { error } = await storage(config).copy(sourceKey, targetKey);
    if (error) throw new Error('Cloud file copy failed.');
  } else {
    const sourceDirectory = kind === 'survey' ? config.surveyFilesDir : config.photoFilesDir;
    fs.copyFileSync(path.join(sourceDirectory, path.basename(sourceKey)), path.join(sourceDirectory, targetKey));
  }
  return targetKey;
}

export async function deleteStoredFile(storageKey, kind, config) {
  if (!storageKey) return;
  if (config.cloudMode) {
    const { error } = await storage(config).remove([storageKey]);
    if (error) throw new Error('Cloud file deletion failed.');
    return;
  }
  const directory = kind === 'survey' ? config.surveyFilesDir : config.photoFilesDir;
  try {
    fs.unlinkSync(path.join(directory, path.basename(storageKey)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function cleanTemporaryUpload(file) {
  if (!file?.path) return;
  try {
    fs.unlinkSync(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function storedFilePath(storageKey, kind, config) {
  const directory = kind === 'survey' ? config.surveyFilesDir : config.photoFilesDir;
  return path.join(directory, path.basename(storageKey));
}

export async function storedFileDelivery(storageKey, kind, config) {
  if (!config.cloudMode) return { path: storedFilePath(storageKey, kind, config) };
  const { data, error } = await storage(config).createSignedUrl(storageKey, 60);
  if (error || !data?.signedUrl) throw new Error('Cloud file download could not be authorized.');
  return { url: data.signedUrl };
}

export async function checkStorage(config) {
  if (!config.cloudMode) return;
  const { error } = await storage(config).list('', { limit: 1 });
  if (error) throw new Error(`Supabase Storage readiness check failed: ${error.message}`);
}

async function uploadCloudFile(file, storageKey, contentType, config) {
  try {
    const contents = fs.readFileSync(file.path);
    const { error } = await storage(config).upload(storageKey, contents, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
  } catch (error) {
    throw new Error('Cloud file upload failed.', { cause: error });
  } finally {
    cleanTemporaryUpload(file);
  }
}

const clients = new Map();
function storage(config) {
  if (config.storageClient) return config.storageClient;
  const key = `${config.supabaseUrl}\n${config.supabaseSecretKey}\n${config.supabaseStorageBucket}`;
  if (!clients.has(key)) {
    const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    clients.set(key, client.storage.from(config.supabaseStorageBucket));
  }
  return clients.get(key);
}
