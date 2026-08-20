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
import { idValue, jsonArray, stringValue, safeFilename } from '../lib/validation.js';
import { createUserNotification } from '../db.js';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const VIDEO_MIME_TYPES = new Set(['video/webm', 'video/mp4', 'video/quicktime']);

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

function computeThreadKey(senderId, recipientIds) {
  if (!recipientIds.length) return 'everyone';
  const participants = [...new Set([senderId, ...recipientIds])].sort();
  return participants.join(',');
}

function serializeMessage(row, attachments, recipients) {
  const recipientIds = recipients.map((r) => r.user_id || r.id);
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name || null,
    bodyText: row.body_text,
    attachments: attachments.map(serializeAttachment),
    recipients: recipients.map((r) => ({ id: r.user_id || r.id, name: r.name })),
    isTargeted: recipients.length > 0,
    threadKey: computeThreadKey(row.sender_id, recipientIds),
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

  router.get('/message-recipients', async (req, res) => {
    const rows = await db
      .prepare('SELECT id, name FROM users WHERE disabled_at IS NULL AND id != ? ORDER BY name COLLATE NOCASE')
      .all(req.user.id);
    res.json({ data: rows, recipients: rows });
  });

  router.get('/messages', async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const threadFilter = req.query.thread ? String(req.query.thread) : null;
    const messageRows = await db
      .prepare(
        `SELECT m.*, u.name AS sender_name
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
          WHERE NOT EXISTS (SELECT 1 FROM message_recipients mr WHERE mr.message_id = m.id)
             OR m.sender_id = ?
             OR EXISTS (SELECT 1 FROM message_recipients mr WHERE mr.message_id = m.id AND mr.user_id = ?)
          ORDER BY m.created_at DESC
          LIMIT ?`,
      )
      .all(req.user.id, req.user.id, limit);
    let messages = [];
    for (const messageRow of messageRows) {
      const attachmentRows = await db.prepare('SELECT * FROM message_attachments WHERE message_id = ? ORDER BY created_at').all(messageRow.id);
      const recipientRows = await db
        .prepare(
          `SELECT mr.user_id, u.name
             FROM message_recipients mr
             LEFT JOIN users u ON u.id = mr.user_id
            WHERE mr.message_id = ?`,
        )
        .all(messageRow.id);
      messages.push(serializeMessage(messageRow, attachmentRows, recipientRows));
    }
    if (threadFilter) messages = messages.filter((message) => message.threadKey === threadFilter);
    res.json({ data: messages, messages });
  });

  router.get('/message-threads', async (req, res) => {
    const messageRows = await db
      .prepare(
        `SELECT m.*, u.name AS sender_name
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
          WHERE NOT EXISTS (SELECT 1 FROM message_recipients mr WHERE mr.message_id = m.id)
             OR m.sender_id = ?
             OR EXISTS (SELECT 1 FROM message_recipients mr WHERE mr.message_id = m.id AND mr.user_id = ?)
          ORDER BY m.created_at DESC`,
      )
      .all(req.user.id, req.user.id);

    const threads = new Map();
    for (const messageRow of messageRows) {
      const recipientRows = await db
        .prepare(
          `SELECT mr.user_id, u.name
             FROM message_recipients mr
             LEFT JOIN users u ON u.id = mr.user_id
            WHERE mr.message_id = ?`,
        )
        .all(messageRow.id);
      const recipientIds = recipientRows.map((r) => r.user_id);
      const threadKey = computeThreadKey(messageRow.sender_id, recipientIds);
      if (threads.has(threadKey)) continue; // messages are already ordered newest-first, so the first hit per key is the most recent

      let participants;
      if (threadKey === 'everyone') {
        participants = [{ id: null, name: 'Everyone' }];
      } else {
        const participantIds = [...new Set([messageRow.sender_id, ...recipientIds])].filter((id) => id !== req.user.id);
        if (!participantIds.length) {
          // A message to yourself only (edge case) - still needs a label.
          participants = [{ id: req.user.id, name: 'You' }];
        } else {
          const placeholders = participantIds.map(() => '?').join(',');
          const participantRows = await db.prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`).all(...participantIds);
          participants = participantRows;
        }
      }

      threads.set(threadKey, {
        threadKey,
        isBroadcast: threadKey === 'everyone',
        participants,
        lastMessage: {
          senderName: messageRow.sender_name,
          bodyText: messageRow.body_text,
          createdAt: messageRow.created_at,
        },
      });
    }

    const list = [...threads.values()];
    res.json({ data: list, threads: list });
  });

  router.post('/messages', attachmentUpload.array('attachments', 10), async (req, res) => {
    const files = req.files || [];
    try {
      const bodyText = req.body?.bodyText ? stringValue(req.body.bodyText, 'bodyText', { max: 10000 }) : '';
      if (!bodyText.trim() && !files.length) throw badRequest('A message needs text or at least one attachment.');

      const requestedRecipientIds = jsonArray(req.body?.recipientIds ?? [], 'recipientIds')
        .filter((value) => typeof value === 'string')
        .slice(0, 100);

      const classified = files.map((file) => {
        if (IMAGE_MIME_TYPES.has(file.mimetype)) return { file, kind: 'photo' };
        if (VIDEO_MIME_TYPES.has(file.mimetype)) return { file, kind: 'video' };
        throw badRequest(`Unsupported attachment type: ${file.mimetype}`, { field: 'attachments' });
      });
      classified.forEach(({ file, kind }) => (kind === 'photo' ? validatePhotoUpload(file) : validateVideoUpload(file)));

      let targetRecipients = [];
      if (requestedRecipientIds.length) {
        const placeholders = requestedRecipientIds.map(() => '?').join(',');
        targetRecipients = await db
          .prepare(`SELECT id, name FROM users WHERE disabled_at IS NULL AND id != ? AND id IN (${placeholders})`)
          .all(req.user.id, ...requestedRecipientIds);
        if (!targetRecipients.length) throw badRequest('None of the selected recipients are valid.', { field: 'recipientIds' });
      }
      const isTargeted = targetRecipients.length > 0;

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO messages (id, sender_id, body_text, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, bodyText.trim() || null, now);

      if (isTargeted) {
        for (const recipient of targetRecipients) {
          await db.prepare('INSERT INTO message_recipients (id, message_id, user_id) VALUES (?, ?, ?)').run(crypto.randomUUID(), id, recipient.id);
        }
      }

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

      const notifyRecipients = isTargeted
        ? targetRecipients
        : await db.prepare('SELECT id FROM users WHERE disabled_at IS NULL AND id != ?').all(req.user.id);
      const title = isTargeted ? `${req.user.name || 'A teammate'} sent you a message` : `${req.user.name || 'A teammate'} sent a message`;
      const notifyBody = bodyText.trim() ? bodyText.trim().slice(0, 140) : `${attachmentRows.length} attachment${attachmentRows.length === 1 ? '' : 's'}`;
      for (const recipient of notifyRecipients) {
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
      const recipientRowsForResponse = isTargeted
        ? targetRecipients.map((r) => ({ user_id: r.id, name: r.name }))
        : [];
      res.status(201).json({ data: serializeMessage(messageRow, attachmentRows, recipientRowsForResponse) });
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

