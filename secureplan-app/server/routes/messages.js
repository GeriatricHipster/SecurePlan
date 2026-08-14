import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import {
  cleanTemporaryUpload,
  storePhoto,
  storeVideo,
  storedFileDelivery,
  deleteStoredFile,
  validatePhotoUpload,
  validateVideoUpload,
} from '../lib/storage.js';
import { idValue, stringValue, safeFilename } from '../lib/validation.js';
import { createUserNotification } from '../db.js';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const VIDEO_MIME_TYPES = new Set(['video/webm', 'video/mp4']);

function serializeAttachment(row) {
  return {
    id: row.id,
    kind: row.kind,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    url: `/api/message-attachments/${row.id}/file`,
  };
}

function serializeMessage(row, attachments) {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name || null,
    bodyText: row.body_text,
    attachments: attachments.map(serializeAttachment),
    createdAt: row.created_at,
  };
}

export function createMessagesRouter({ db, config, auth, notifyUser }) {
  const router = Router();
  const attachmentUpload = multer({
    dest: config.temporaryFilesDir,
    limits: { fileSize: config.maxMessageVideoBytes, files: 10, fields: 10 },
  });
  router.use(auth.requireAuth);

  router.get('/messages', async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const messageRows = await db
      .prepare(
        `SELECT m.*, u.name AS sender_name
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
          ORDER BY m.created_at DESC
          LIMIT ?`,
      )
      .all(limit);
    const messages = [];
    for (const messageRow of messageRows) {
      const attachmentRows = await db.prepare('SELECT * FROM message_attachments WHERE message_id = ? ORDER BY created_at').all(messageRow.id);
      messages.push(serializeMessage(messageRow, attachmentRows));
    }
    res.json({ data: messages, messages });
  });

  router.post('/messages', attachmentUpload.array('attachments', 10), async (req, res) => {
    const files = req.files || [];
    try {
      const bodyText = req.body?.bodyText ? stringValue(req.body.bodyText, 'bodyText', { max: 10000 }) : '';
      if (!bodyText.trim() && !files.length) throw badRequest('A message needs text or at least one attachment.');

      const classified = files.map((file) => {
        if (IMAGE_MIME_TYPES.has(file.mimetype)) return { file, kind: 'photo' };
        if (VIDEO_MIME_TYPES.has(file.mimetype)) return { file, kind: 'video' };
        throw badRequest(`Unsupported attachment type: ${file.mimetype}`, { field: 'attachments' });
      });
      classified.forEach(({ file, kind }) => (kind === 'photo' ? validatePhotoUpload(file) : validateVideoUpload(file)));

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO messages (id, sender_id, body_text, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, bodyText.trim() || null, now);

      const attachmentRows = [];
      for (const { file, kind } of classified) {
        const storageKey = kind === 'photo' ? await storePhoto(file, config) : await storeVideo(file, config);
        const attachmentId = crypto.randomUUID();
        await db.prepare(
          `INSERT INTO message_attachments (id, message_id, kind, storage_key, original_filename, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(attachmentId, id, kind, storageKey, file.originalname, file.mimetype, file.size, now);
        attachmentRows.push({ id: attachmentId, kind, storage_key: storageKey, original_filename: file.originalname, mime_type: file.mimetype, size_bytes: file.size });
      }

      const recipients = await db.prepare('SELECT id FROM users WHERE disabled_at IS NULL AND id != ?').all(req.user.id);
      const title = `${req.user.name || 'A teammate'} sent a message`;
      const notifyBody = bodyText.trim() ? bodyText.trim().slice(0, 140) : `${attachmentRows.length} attachment${attachmentRows.length === 1 ? '' : 's'}`;
      for (const recipient of recipients) {
        notifyUser?.(recipient.id, { type: 'message.posted', title, body: notifyBody, senderName: req.user.name });
        try {
          await createUserNotification(db, {
            userId: recipient.id,
            type: 'message.posted',
            title,
            body: notifyBody,
            senderName: req.user.name,
            linkPath: 'messages',
          });
        } catch (error) {
          console.error('Failed to record persistent notification for message (continuing anyway):', error.message);
        }
      }

      const messageRow = await db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
      messageRow.sender_name = req.user.name;
      res.status(201).json({ data: serializeMessage(messageRow, attachmentRows) });
    } catch (error) {
      files.forEach(cleanTemporaryUpload);
      throw error;
    }
  });

  router.get('/message-attachments/:attachmentId/file', async (req, res) => {
    const attachment = await db.prepare('SELECT * FROM message_attachments WHERE id = ?').get(idValue(req.params.attachmentId, 'attachmentId'));
    if (!attachment) throw notFound('Attachment');
    res.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': attachment.mime_type,
      'Content-Disposition': `inline; filename="${safeFilename(attachment.original_filename || 'attachment')}"`,
    });
    const delivery = await storedFileDelivery(attachment.storage_key, attachment.kind === 'video' ? 'video' : 'photo', config);
    if (delivery.contents) return res.send(delivery.contents);
    res.sendFile(delivery.path);
  });

  router.delete('/messages/:messageId', async (req, res) => {
    const message = await db.prepare('SELECT * FROM messages WHERE id = ?').get(idValue(req.params.messageId, 'messageId'));
    if (!message) throw notFound('Message');
    const isOwnMessage = message.sender_id === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnMessage && !isAdmin) throw forbidden('You can only delete your own messages.');
    const attachmentRows = await db.prepare('SELECT * FROM message_attachments WHERE message_id = ?').all(message.id);
    for (const attachment of attachmentRows) {
      await deleteStoredFile(attachment.storage_key, attachment.kind === 'video' ? 'video' : 'photo', config).catch(() => {});
    }
    await db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
    res.json({ data: { deletedId: message.id } });
  });

  return router;
}
