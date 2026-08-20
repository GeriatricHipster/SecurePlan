import React, { useEffect, useRef, useState } from 'react';
import { api, nativeTransport, normalizeList } from '../api.js';
import { ConfirmDialog, EmptyState, Spinner, formatWhen, initials } from './Common.jsx';
import { ArrowLeft, MessageSquare, Paperclip, Plus, Send, Trash2, X } from 'lucide-react';

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

function threadTitle(thread) {
  if (thread.isBroadcast) return 'Everyone';
  return thread.participants.map((p) => p.name).join(', ') || 'Conversation';
}

function ThreadList({ threads, loading, onOpen, onNew }) {
  return (
    <div className="thread-list">
      <div className="thread-list__header">
        <h1><MessageSquare aria-hidden="true" size={20} /> Messages</h1>
        <button type="button" className="button button--primary" onClick={onNew}><Plus size={15} aria-hidden="true" /> New message</button>
      </div>
      {loading ? (
        <div className="loading-panel"><Spinner label="Loading conversations…" /></div>
      ) : !threads.length ? (
        <EmptyState icon={MessageSquare} title="No conversations yet">Start one with "New message."</EmptyState>
      ) : (
        <ul className="thread-list__items">
          {threads.map((thread) => (
            <li key={thread.threadKey}>
              <button type="button" onClick={() => onOpen(thread)}>
                <span className="mini-avatar" aria-hidden="true">{thread.isBroadcast ? <MessageSquare size={15} /> : initials(threadTitle(thread))}</span>
                <span className="thread-list__body">
                  <span className="thread-list__title">{threadTitle(thread)}</span>
                  <span className="thread-list__preview">
                    {thread.lastMessage.senderName ? `${thread.lastMessage.senderName}: ` : ''}
                    {thread.lastMessage.bodyText || 'Sent an attachment'}
                  </span>
                </span>
                <time>{formatWhen(thread.lastMessage.createdAt)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecipientPicker({ recipients, selected, onToggle, onSelectEveryone, everyoneSelected }) {
  return (
    <div className="recipient-picker">
      <label className="recipient-picker__everyone">
        <input type="checkbox" checked={everyoneSelected} onChange={onSelectEveryone} />
        <span>Everyone</span>
      </label>
      {!everyoneSelected && (
        <div className="recipient-picker__list">
          {recipients.map((recipient) => (
            <label key={recipient.id}>
              <input type="checkbox" checked={selected.has(recipient.id)} onChange={() => onToggle(recipient.id)} />
              <span>{recipient.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({ onSend, sending }) {
  const [bodyText, setBodyText] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => () => { pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).slice(0, 10 - pendingFiles.length);
    const next = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file), isVideo: file.type.startsWith('video/') }));
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
    await onSend(bodyText.trim(), pendingFiles.map((item) => item.file));
    pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setBodyText('');
    setPendingFiles([]);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
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
        <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
        <button type="button" className="icon-button" disabled={pendingFiles.length >= 10} onClick={() => fileInputRef.current?.click()} aria-label="Attach photo or video">
          <Paperclip size={18} aria-hidden="true" />
        </button>
        <textarea rows="1" placeholder="Message… (Shift+Enter for a new line)" value={bodyText} onChange={(event) => setBodyText(event.target.value)} onKeyDown={handleKeyDown} />
        <button type="button" className="button button--primary" disabled={sending || (!bodyText.trim() && !pendingFiles.length)} onClick={send} aria-label="Send message">
          <Send size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ThreadView({ user, thread, onBack, notify }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const feedEndRef = useRef(null);
  const pollRef = useRef(null);

  const load = async (scrollToEnd) => {
    try {
      const result = await api.messages({ thread: thread.threadKey });
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
  }, [thread.threadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (bodyText, files) => {
    setSending(true);
    try {
      const form = new FormData();
      if (bodyText) form.append('bodyText', bodyText);
      files.forEach((file) => form.append('attachments', file));
      if (!thread.isBroadcast) {
        const recipientIds = thread.participants.map((p) => p.id).filter(Boolean);
        form.append('recipientIds', JSON.stringify(recipientIds));
      }
      await api.createMessage(form);
      await load(true);
    } catch (error) {
      notify(error.message);
    } finally {
      setSending(false);
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
    <div className="thread-view">
      <div className="thread-view__header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} aria-hidden="true" /></button>
        <strong>{threadTitle(thread)}</strong>
      </div>

      {loading ? (
        <div className="loading-panel"><Spinner label="Loading messages…" /></div>
      ) : !messages.length ? (
        <EmptyState icon={MessageSquare} title="No messages yet">Say hello below.</EmptyState>
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

      <Composer onSend={send} sending={sending} />

      <ConfirmDialog open={Boolean(confirmDeleteId)} title="Delete this message?" onClose={() => setConfirmDeleteId(null)} onConfirm={() => removeMessage(confirmDeleteId)}>
        <p>This can't be undone.</p>
      </ConfirmDialog>
    </div>
  );
}

function NewMessageView({ onBack, onStarted, notify }) {
  const [recipients, setRecipients] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [everyoneSelected, setEveryoneSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    api.messageRecipients().then((result) => {
      if (active) setRecipients(normalizeList(result?.recipients ?? result));
    }).catch((error) => notify(error.message)).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notify]);

  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = async (bodyText, files) => {
    if (!everyoneSelected && !selected.size) { notify('Pick at least one person, or choose Everyone.'); return; }
    setSending(true);
    try {
      const form = new FormData();
      if (bodyText) form.append('bodyText', bodyText);
      files.forEach((file) => form.append('attachments', file));
      if (!everyoneSelected) form.append('recipientIds', JSON.stringify([...selected]));
      const result = await api.createMessage(form);
      const created = result?.data ?? result;
      onStarted(created);
    } catch (error) {
      notify(error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="thread-view">
      <div className="thread-view__header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} aria-hidden="true" /></button>
        <strong>New message</strong>
      </div>
      {loading ? (
        <div className="loading-panel"><Spinner label="Loading people…" /></div>
      ) : (
        <RecipientPicker
          recipients={recipients}
          selected={selected}
          onToggle={toggle}
          everyoneSelected={everyoneSelected}
          onSelectEveryone={() => { setEveryoneSelected((current) => !current); setSelected(new Set()); }}
        />
      )}
      <Composer onSend={send} sending={sending} />
    </div>
  );
}

export default function MessagesPage({ user, notify }) {
  const [view, setView] = useState('list');
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [activeThread, setActiveThread] = useState(null);

  const loadThreads = async () => {
    try {
      const result = await api.messageThreads();
      setThreads(normalizeList(result?.threads ?? result));
    } catch (error) {
      notify(error.message);
    } finally {
      setThreadsLoading(false);
    }
  };

  useEffect(() => { loadThreads(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = (thread) => {
    setActiveThread(thread);
    setView('thread');
  };

  const backToList = () => {
    setView('list');
    setActiveThread(null);
    loadThreads();
  };

  const startedNewThread = (createdMessage) => {
    const thread = {
      threadKey: createdMessage.threadKey,
      isBroadcast: !createdMessage.isTargeted,
      participants: createdMessage.isTargeted ? createdMessage.recipients : [],
    };
    openThread(thread);
  };

  return (
    <main id="main-content" className="messages-page">
      {view === 'list' && <ThreadList threads={threads} loading={threadsLoading} onOpen={openThread} onNew={() => setView('new')} />}
      {view === 'thread' && activeThread && <ThreadView user={user} thread={activeThread} onBack={backToList} notify={notify} />}
      {view === 'new' && <NewMessageView onBack={backToList} onStarted={startedNewThread} notify={notify} />}
    </main>
  );
}
