import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

export function storePdf(file, config) {
  const storageKey = `${crypto.randomUUID()}.pdf`;
  fs.renameSync(file.path, path.join(config.surveyFilesDir, storageKey));
  return storageKey;
}

export function storePhoto(file, config) {
  const storageKey = `${crypto.randomUUID()}${IMAGE_EXTENSIONS.get(file.mimetype) || '.image'}`;
  fs.renameSync(file.path, path.join(config.photoFilesDir, storageKey));
  return storageKey;
}

export function copyStoredFile(sourceKey, kind, config) {
  if (!sourceKey) return null;
  const sourceDirectory = kind === 'survey' ? config.surveyFilesDir : config.photoFilesDir;
  const extension = path.extname(sourceKey).slice(0, 10);
  const targetKey = `${crypto.randomUUID()}${extension}`;
  fs.copyFileSync(path.join(sourceDirectory, path.basename(sourceKey)), path.join(sourceDirectory, targetKey));
  return targetKey;
}

export function deleteStoredFile(storageKey, kind, config) {
  if (!storageKey) return;
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
