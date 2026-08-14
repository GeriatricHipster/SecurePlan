import React, { useEffect, useRef, useState } from 'react';
import { api, nativeTransport, normalizeList } from '../api.js';
import { ConfirmDialog, EmptyState, Spinner, formatWhen, initials } from './Common.jsx';
import { MessageSquare, Paperclip, Send, Trash2, X } from 'lucide-react';

function MessageAttachment({ attachment }) {
  const [source, setSource] = useState(() => nativeTransport.isNative ? '' : api.messageAttachmentUrl(attachment.id));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!nativeTransport.isNative) return undefined;
    let active = true;
    let objectUrl = '';
    api.messageAttachmentBlob(attachment.id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  if (failed) return <span className="message-attachment message-attachment--error">Attachment unavailable</span>;
  if (!source) return <span className="message-attachment message-attachment--loading" role="status">Loading…</span>;
  if (attachment.kind === 'video') {
    return <video className="message-attachment message-attachment--video" src={source} controls preload="metadata" />;
  }
  return (
    <a href={source} target="_blank" rel="noreferrer" className="message-attachment message-attachment--photo">
      <img src={source} alt="" />
    </a>
  );
}

export default function MessagesPage({ user, notify }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bodyText, setBodyText] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const fileInputRef = useRef(null);
  const feedEndRef = useRef(null);
  const pollRef = useRef(null);

  const load = async (scrollToEnd) => {
    try {
      const result = await api.messages();
      const list = normalizeList(result?.messages ?? result).slice().reverse();
      setMessages(list);
      if (scrollToEnd) window.setTimeout(() => feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    pollRef.current = window.setInterval(() => load(false), 15000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).slice(0, 10 - pendingFiles.length);
    const next = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      isVideo: file.type.startsWith('video/'),
    }));
    setPendingFiles((current) => [...current, ...next].slice(0, 10));
  };

  const removePendingFile = (index) => {
    setPendingFiles((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const send = async () => {
    if (!bodyText.trim() && !pendingFiles.length) return;
    setSending(true);
    try {
      const form = new FormData();
      if (bodyText.trim()) form.append('bodyText', bodyText.trim());
      pendingFiles.forEach((item) => form.append('attachments', item.file));
      await api.createMessage(form);
      pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setBodyText('');
      setPendingFiles([]);
      await load(true);
    } catch (error) {
      notify(error.message);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const removeMessage = async (id) => {
    try {
      await api.deleteMessage(id);
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch (error) {
      notify(error.message);
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <main id="main-content" className="messages-page">
      <header className="messages-page__header">
        <h1><MessageSquare aria-hidden="true" size={20} /> Team messages</h1>
        <p>A shared channel for the whole workspace.</p>
      </header>

      {loading ? (
        <div className="loading-panel"><Spinner label="Loading messages…" /></div>
      ) : !messages.length ? (
        <EmptyState icon={MessageSquare} title="No messages yet">Start the conversation below.</EmptyState>
      ) : (
        <div className="messages-feed">
          {messages.map((message) => {
            const isOwn = message.senderId === user.id;
            const canDelete = isOwn || ['owner', 'admin'].includes(user.role);
            return (
              <div key={message.id} className={`message-row ${isOwn ? 'message-row--own' : ''}`}>
                <span className="mini-avatar" aria-hidden="true">{initials(message.senderName || '?')}</span>
                <div className="message-row__body">
                  <div className="message-row__meta">
                    <strong>{message.senderName || 'Someone'}</strong>
                    <time>{formatWhen(message.createdAt)}</time>
                    {canDelete && <button type="button" className="message-row__delete" onClick={() => setConfirmDeleteId(message.id)} aria-label="Delete message"><Trash2 size={13} /></button>}
                  </div>
                  {message.bodyText && <div className="message-row__text">{message.bodyText.split('\n').filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div>}
                  {message.attachments.length > 0 && (
                    <div className="message-row__attachments">
                      {message.attachments.map((attachment) => <MessageAttachment key={attachment.id} attachment={attachment} />)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={feedEndRef} />
        </div>
      )}

      <div className="messages-composer">
        {pendingFiles.length > 0 && (
          <div className="messages-composer__previews">
            {pendingFiles.map((item, index) => (
              <div key={item.previewUrl} className="messages-composer__preview">
                {item.isVideo ? <video src={item.previewUrl} muted /> : <img src={item.previewUrl} alt="" />}
                <button type="button" onClick={() => removePendingFile(index)} aria-label="Remove attachment"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="messages-composer__row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
          />
          <button type="button" className="icon-button" disabled={pendingFiles.length >= 10} onClick={() => fileInputRef.current?.click()} aria-label="Attach photo or video">
            <Paperclip size={18} aria-hidden="true" />
          </button>
          <textarea
            rows="1"
            placeholder="Message the team… (Shift+Enter for a new line)"
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="button button--primary" disabled={sending || (!bodyText.trim() && !pendingFiles.length)} onClick={send} aria-label="Send message">
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <ConfirmDialog open={Boolean(confirmDeleteId)} title="Delete this message?" onClose={() => setConfirmDeleteId(null)} onConfirm={() => removeMessage(confirmDeleteId)}>
        <p>This can't be undone.</p>
      </ConfirmDialog>
    </main>
  );
}
