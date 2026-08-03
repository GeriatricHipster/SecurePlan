import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, nativeTransport, normalizeList } from '../api.js';
import { ConfirmDialog, Field, Modal, Spinner, formatWhen, initials, roleCanAnnotate, roleCanEdit } from './Common.jsx';
import PdfPlan from './PdfPlan.jsx';
import { DEFAULT_PROFILE, DEVICE_CATEGORIES, MARKUP_TOOLS, categoryFor, defaultMetadataForDevice, elementColor, elementSymbol, isCameraType, itemFor } from './deviceLibrary.js';
import DeviceGlyph from './DeviceGlyph.jsx';

const LAYER_IDS = [...DEVICE_CATEGORIES.map((category) => category.id), 'custom', 'markup'];

function metadataOf(element) {
  if (element?.metadata && typeof element.metadata === 'object') return element.metadata;
  try { return JSON.parse(element?.metadata || '{}'); } catch { return {}; }
}

function componentsOf(profile) {
  if (Array.isArray(profile.components)) return profile.components;
  if (Array.isArray(profile.definition?.components)) return profile.definition.components;
  if (typeof profile.components === 'string') {
    try { return JSON.parse(profile.components); } catch { return []; }
  }
  return [];
}

function normalizeElement(element) {
  return {
    ...element,
    category: element.category || element.system || 'custom',
    type: element.type || element.elementType || element.element_type || 'custom',
    label: element.label || element.name || 'Element',
    x: Number(element.x ?? 0.5),
    y: Number(element.y ?? 0.5),
    width: Number(element.width ?? 0.1),
    height: Number(element.height ?? 0.08),
    rotation: Number(element.rotation ?? 0),
    metadata: metadataOf(element),
  };
}

function CloudPhoto({ photo, elementLabel }) {
  const [source, setSource] = useState(() => nativeTransport.isNative ? '' : api.photoUrl(photo.id));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!nativeTransport.isNative) return undefined;
    let active = true;
    let objectUrl = '';
    api.photoBlob(photo.id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id]);

  if (failed) return <span className="photo-grid__status">Photo unavailable</span>;
  if (!source) return <span className="photo-grid__status" role="status">Loading photo…</span>;
  return <a href={source} target="_blank" rel="noreferrer"><img src={source} alt={photo.caption || `Photo attached to ${elementLabel}`} /><span>{photo.caption || 'View photo'}</span></a>;
}

function LibraryPanel({ activeTool, profiles, visibleLayers, canEdit, onTool, onLayer, onBuildProfile, onClose }) {
  return (
    <aside className="editor-panel library-panel" aria-label="Component library">
      <div className="editor-panel__heading"><div><p className="eyebrow">Plotting</p><h2>Components</h2></div><button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close component library">×</button></div>
      <div className="markup-tools" role="toolbar" aria-label="Drawing tools">
        {MARKUP_TOOLS.map((tool) => <button key={tool.type} type="button" aria-label={tool.label} title={tool.label} aria-pressed={activeTool.type === tool.type} className={activeTool.type === tool.type ? 'active' : ''} onClick={() => onTool({ kind: 'markup', ...tool })} disabled={!canEdit && tool.type !== 'select'}><span aria-hidden="true">{tool.symbol}</span><small>{tool.label}</small></button>)}
      </div>
      <div className="library-scroll">
        {DEVICE_CATEGORIES.map((category) => (
          <details className="component-group" key={category.id} open>
            <summary><span className="category-dot" style={{ backgroundColor: category.color }} /><strong>{category.name}</strong><span>{category.items.length}</span></summary>
            <div className="component-grid">
              {category.items.map((item) => {
                const active = activeTool.kind === 'device' && activeTool.category === category.id && activeTool.type === item.type;
                return <button type="button" key={item.type} className={active ? 'active' : ''} aria-pressed={active} disabled={!canEdit} onClick={() => onTool({ kind: 'device', category: category.id, color: category.color, ...item })}><span className="library-symbol" style={{ '--symbol-color': category.color }}><DeviceGlyph type={item.type} symbol={item.symbol} label={item.label} iconSrc={item.reportIcon} /></span><span>{item.label}</span></button>;
              })}
            </div>
          </details>
        ))}
        <details className="component-group" open>
          <summary><span className="category-dot" style={{ backgroundColor: '#13795b' }} /><strong>Custom</strong><span>{profiles.length}</span></summary>
          <div className="profile-list">
            {profiles.map((profile) => {
              const active = activeTool.kind === 'profile' && activeTool.id === profile.id;
              const components = componentsOf(profile);
              return <button type="button" key={profile.id} className={active ? 'active' : ''} aria-pressed={active} disabled={!canEdit} onClick={() => onTool({ kind: 'profile', ...profile, components })}><span className="profile-stack" aria-hidden="true">{components.slice(0, 4).map((component, index) => <i key={`${component.type}-${index}`}>{component.symbol || itemFor(component.category, component.type)?.symbol || '?'}</i>)}</span><span><strong>{profile.name}</strong><small>{components.map((component) => component.symbol || itemFor(component.category, component.type)?.symbol).filter(Boolean).join(' · ') || profile.description}</small></span></button>;
            })}
            {canEdit && <button type="button" className="new-profile-button" onClick={onBuildProfile}><span aria-hidden="true">＋</span>Create icon profile</button>}
          </div>
        </details>
        <details className="component-group layer-group">
          <summary><span aria-hidden="true">◫</span><strong>Layers</strong><span>{visibleLayers.size}/{LAYER_IDS.length}</span></summary>
          <div className="layer-list">
            {LAYER_IDS.map((layer) => <label key={layer}><input type="checkbox" checked={visibleLayers.has(layer)} onChange={() => onLayer(layer)} /><span className="category-dot" style={{ backgroundColor: categoryFor(layer)?.color || (layer === 'markup' ? '#46545f' : '#13795b') }} /><span>{categoryFor(layer)?.name || (layer === 'markup' ? 'Markup' : 'Custom')}</span></label>)}
          </div>
        </details>
      </div>
      {activeTool.kind !== 'markup' && <div className="placement-hint" role="status"><strong>{activeTool.name || activeTool.label}</strong><span>Click the floor plan to place</span></div>}
    </aside>
  );
}

function InspectorPanel({ element, notes, notesLoading, canEdit, canAnnotate, onPatch, onDuplicate, onDelete, onAddNote, onAddPhoto, photoBusy, onClose }) {
  const [form, setForm] = useState({
    label: '', color: '#46545f', size: 42, rotation: 0, fovColor: '#1769aa', fovLength: 0.22, fovSpread: 60,
  });
  const [noteText, setNoteText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');

  useEffect(() => {
    if (!element) return;
    const metadata = metadataOf(element);
    setForm({
      label: element.label || '',
      color: elementColor(element),
      size: Number(metadata.size || 42),
      rotation: Number(element.rotation || 0),
      fovColor: metadata.fovColor || elementColor(element),
      fovLength: Number(metadata.fovLength ?? 0.22),
      fovSpread: Number(metadata.fovSpread ?? 60),
    });
    setNoteText('');
    setNoteError('');
    setPhotoCaption('');
  }, [element?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!element) {
    return (
      <aside className="editor-panel inspector-panel" aria-label="Element properties">
        <div className="editor-panel__heading"><div><p className="eyebrow">Details</p><h2>Properties</h2></div><button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close properties">×</button></div>
        <div className="inspector-empty"><span aria-hidden="true">↖</span><h3>Select an element</h3><p>Choose a plotted device or markup to edit its details, notes, and photos.</p></div>
      </aside>
    );
  }

  const metadata = metadataOf(element);
  const photos = element.photos || metadata.photos || [];
  const saveNote = async (event) => {
    event.preventDefault();
    if (!noteText.trim()) return;
    setNoteBusy(true);
    setNoteError('');
    try {
      await onAddNote(noteText.trim());
      setNoteText('');
    } catch (error) {
      setNoteError(error.message || 'The note could not be added.');
    } finally { setNoteBusy(false); }
  };

  return (
    <aside className="editor-panel inspector-panel" aria-label={`Properties for ${element.label}`}>
      <div className="editor-panel__heading"><div><p className="eyebrow">Selected element</p><h2>{element.label}</h2></div><button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close properties">×</button></div>
      <div className="inspector-scroll">
        <section className="inspector-section">
          <div className="element-identity"><span className="library-symbol" style={{ '--symbol-color': form.color }}><DeviceGlyph type={element.type} symbol={elementSymbol(element)} label={element.label} iconSrc={itemFor(element.category, element.type)?.reportIcon} /></span><div><strong>{categoryFor(element.category)?.name || (element.category === 'markup' ? 'Markup' : 'Custom')}</strong><span>{itemFor(element.category, element.type)?.label || element.type.replaceAll('_', ' ')}</span></div></div>
          <Field label="Element label"><input value={form.label} disabled={!canEdit} onChange={(e) => setForm({ ...form, label: e.target.value })} onBlur={() => form.label !== element.label && onPatch({ label: form.label })} /></Field>
          <div className="form-grid form-grid--two">
            <fieldset className="field color-field"><legend className="field__label">Icon color</legend><div className="color-control"><input type="color" aria-label="Choose icon color" value={form.color} disabled={!canEdit} onChange={(e) => setForm({ ...form, color: e.target.value })} onBlur={() => form.color !== elementColor(element) && onPatch({ color: form.color })} /><input aria-label="Icon color hex value" value={form.color} disabled={!canEdit} pattern="#[0-9a-fA-F]{6}" onChange={(e) => setForm({ ...form, color: e.target.value })} onBlur={() => /^#[0-9a-f]{6}$/i.test(form.color) && onPatch({ color: form.color })} /></div></fieldset>
            <Field label="Rotation"><div className="range-control"><input type="range" min="0" max="355" step="5" value={form.rotation} disabled={!canEdit} onChange={(e) => setForm({ ...form, rotation: Number(e.target.value) })} onPointerUp={() => onPatch({ rotation: form.rotation })} onKeyUp={() => onPatch({ rotation: form.rotation })} /><output>{form.rotation}°</output></div></Field>
          </div>
          {element.category !== 'markup' && <Field label="Icon size"><div className="range-control"><input type="range" min="28" max="100" step="2" value={form.size} disabled={!canEdit} onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} onPointerUp={() => onPatch({ metadata: { ...metadata, size: form.size } })} onKeyUp={() => onPatch({ metadata: { ...metadata, size: form.size } })} /><output>{form.size}px</output></div></Field>}
          {isCameraType(element.type) && (
            <fieldset className="camera-fov-controls">
              <legend>Camera field of view</legend>
              <fieldset className="field color-field">
                <legend className="field__label">Cone color</legend>
                <div className="color-control">
                  <input type="color" aria-label="Choose camera cone color" value={form.fovColor} disabled={!canEdit} onChange={(e) => setForm({ ...form, fovColor: e.target.value })} onBlur={() => onPatch({ metadata: { ...metadata, fovColor: form.fovColor } })} />
                  <input aria-label="Camera cone color hex value" value={form.fovColor} disabled={!canEdit} pattern="#[0-9a-fA-F]{6}" onChange={(e) => setForm({ ...form, fovColor: e.target.value })} onBlur={() => /^#[0-9a-f]{6}$/i.test(form.fovColor) && onPatch({ metadata: { ...metadata, fovColor: form.fovColor } })} />
                </div>
              </fieldset>
              <Field label="Cone length">
                <div className="range-control"><input type="range" min="0.05" max="0.75" step="0.01" value={form.fovLength} disabled={!canEdit} onChange={(e) => setForm({ ...form, fovLength: Number(e.target.value) })} onPointerUp={() => onPatch({ metadata: { ...metadata, fovLength: form.fovLength } })} onKeyUp={() => onPatch({ metadata: { ...metadata, fovLength: form.fovLength } })} /><output>{Math.round(form.fovLength * 100)}%</output></div>
              </Field>
              <Field label="Cone spread">
                <div className="range-control"><input type="range" min="5" max="180" step="5" value={form.fovSpread} disabled={!canEdit} onChange={(e) => setForm({ ...form, fovSpread: Number(e.target.value) })} onPointerUp={() => onPatch({ metadata: { ...metadata, fovSpread: form.fovSpread } })} onKeyUp={() => onPatch({ metadata: { ...metadata, fovSpread: form.fovSpread } })} /><output>{form.fovSpread}°</output></div>
              </Field>
              <p>Use Rotation above to aim the camera and its cone.</p>
            </fieldset>
          )}
          <p className="edit-attribution">Last edited by {element.updatedBy?.name || element.updated_by_name || 'a team member'} · {formatWhen(element.updatedAt || element.updated_at)}</p>
          {canEdit && <div className="button-group button-group--wide"><button type="button" className="button button--secondary" onClick={onDuplicate}>Duplicate</button><button type="button" className="button button--ghost danger-text" onClick={onDelete}>Delete</button></div>}
        </section>

        <section className="inspector-section">
          <div className="section-title"><h3>Notes</h3><span>{notes.length}</span></div>
          {notesLoading ? <Spinner label="Loading notes…" /> : notes.length ? <div className="note-thread">{notes.map((note) => <article key={note.id}><span className="mini-avatar" aria-hidden="true">{initials(note.author?.name || note.author_name)}</span><div><strong>{note.author?.name || note.author_name || 'Team member'}</strong><small>{formatWhen(note.createdAt || note.created_at)}</small><p>{note.text || note.body}</p></div></article>)}</div> : <p className="muted">No notes on this element yet.</p>}
          {canAnnotate && <form className="note-form" onSubmit={saveNote}>{noteError && <div className="notice notice--error" role="alert">{noteError}</div>}<Field label="Add a note"><textarea rows="3" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Record a field condition or instruction…" /></Field><button className="button button--secondary" disabled={noteBusy || !noteText.trim()}>{noteBusy ? 'Adding…' : 'Add note'}</button></form>}
        </section>

        <section className="inspector-section">
          <div className="section-title"><h3>Cloud photos</h3><span>{photos.length}</span></div>
          {photos.length > 0 && <div className="photo-grid">{photos.map((photo) => <CloudPhoto key={photo.id} photo={photo} elementLabel={element.label} />)}</div>}
          {canAnnotate && <div className="photo-upload"><Field label="Photo caption"><input value={photoCaption} onChange={(e) => setPhotoCaption(e.target.value)} placeholder="Optional field note" /></Field><label className={`button button--secondary upload-button ${photoBusy ? 'disabled' : ''}`}><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" disabled={photoBusy} onChange={(e) => { const file = e.target.files?.[0]; if (file) onAddPhoto(file, photoCaption).then(() => setPhotoCaption('')); e.target.value = ''; }} /><span>{photoBusy ? 'Uploading to cloud…' : 'Take or upload photo'}</span></label><p className="cloud-note"><span aria-hidden="true">☁</span> Photos are uploaded to the workspace and are not stored in this app on your device.</p></div>}
        </section>
      </div>
    </aside>
  );
}

function Presence({ users, status }) {
  return (
    <div className="presence" aria-label={`${users.length} collaborator${users.length === 1 ? '' : 's'} viewing`}>
      <div className="presence__avatars">{users.slice(0, 4).map((person, index) => <span key={person.id || index} className="avatar" style={{ zIndex: 5 - index }} title={person.name}>{initials(person.name)}</span>)}{users.length > 4 && <span className="avatar">+{users.length - 4}</span>}</div>
      <span className={`sync-state sync-state--${status}`}><i aria-hidden="true" />{status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'}</span>
    </div>
  );
}

function Schedule({ elements, onSelect, onClose }) {
  const devices = elements.filter((element) => element.category !== 'markup');
  const download = () => {
    const rows = [['Label', 'System', 'Type', 'Notes', 'Photos', 'Last edited']];
    devices.forEach((element) => rows.push([element.label, categoryFor(element.category)?.name || 'Custom', itemFor(element.category, element.type)?.label || element.type, element.noteCount ?? element.note_count ?? 0, element.photoCount ?? element.photo_count ?? element.photos?.length ?? 0, element.updatedAt || element.updated_at || '']));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'secureplan-device-schedule.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div className="schedule-summary">{DEVICE_CATEGORIES.map((category) => <div key={category.id}><span className="category-dot" style={{ backgroundColor: category.color }} /><strong>{devices.filter((item) => item.category === category.id).length}</strong><small>{category.name}</small></div>)}</div>
      <div className="table-scroll"><table><thead><tr><th>Element</th><th>System</th><th>Type</th><th>Notes</th><th>Photos</th><th>Last edit</th></tr></thead><tbody>{devices.map((element) => <tr key={element.id}><td><button type="button" onClick={() => { onSelect(element.id); onClose(); }}><span className="schedule-symbol" style={{ '--element-color': elementColor(element) }}>{elementSymbol(element)}</span>{element.label}</button></td><td>{categoryFor(element.category)?.name || 'Custom'}</td><td>{itemFor(element.category, element.type)?.label || element.type}</td><td>{element.noteCount ?? element.note_count ?? 0}</td><td>{element.photoCount ?? element.photo_count ?? element.photos?.length ?? 0}</td><td>{formatWhen(element.updatedAt || element.updated_at)}</td></tr>)}</tbody></table></div>
      {!devices.length && <p className="inline-empty">Place components on the floor plan to build the device schedule.</p>}
      <div className="modal__actions"><button type="button" className="button button--secondary" onClick={download} disabled={!devices.length}>Export CSV</button><button type="button" className="button button--primary" onClick={onClose}>Done</button></div>
    </div>
  );
}

function ProfileBuilder({ open, onClose, onCreate }) {
  const allItems = DEVICE_CATEGORIES.flatMap((category) => category.items.map((item) => ({ ...item, category: category.id, categoryName: category.name })));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(''); setDescription(''); setSelected([]); setError(''); } }, [open]);
  const submit = async (event) => {
    event.preventDefault();
    if (!selected.length) { setError('Choose at least one component.'); return; }
    setBusy(true);
    try {
      const radius = 0.035;
      const components = selected.map((key, index) => {
        const item = allItems.find((candidate) => `${candidate.category}:${candidate.type}` === key);
        const angle = selected.length === 1 ? 0 : (Math.PI * 2 * index) / selected.length - Math.PI / 2;
        return { category: item.category, type: item.type, label: item.label, symbol: item.symbol, offsetX: selected.length === 1 ? 0 : Math.cos(angle) * radius, offsetY: selected.length === 1 ? 0 : Math.sin(angle) * radius };
      });
      await onCreate({ name, description, components });
      onClose();
    } catch (createError) { setError(createError.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Create an icon profile" description="A profile places all selected components together as one reusable assembly." onClose={onClose} wide>
      <form className="profile-builder" onSubmit={submit}>
        {error && <div className="notice notice--error" role="alert">{error}</div>}
        <div className="form-grid form-grid--two"><Field label="Profile name"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Example: Full Door" /></Field><Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this assembly includes" /></Field></div>
        <fieldset><legend>Components in this profile</legend><div className="profile-component-picker">{allItems.map((item) => { const key = `${item.category}:${item.type}`; return <label key={key} className={selected.includes(key) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(key)} onChange={() => setSelected((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])} /><span className="library-symbol" style={{ '--symbol-color': categoryFor(item.category)?.color }}>{item.symbol}</span><span><strong>{item.label}</strong><small>{item.categoryName}</small></span></label>; })}</div></fieldset>
        <div className="profile-preview"><strong>Profile preview</strong>{selected.length ? <div className="profile-preview__icons">{selected.map((key) => { const item = allItems.find((candidate) => `${candidate.category}:${candidate.type}` === key); return <span key={key} className="library-symbol" style={{ '--symbol-color': categoryFor(item.category)?.color }}>{item.symbol}</span>; })}</div> : <span>Choose components above</span>}</div>
        <div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? 'Creating…' : 'Create profile'}</button></div>
      </form>
    </Modal>
  );
}

export default function SurveyEditor({ user, surveyId, siteId, navigate, notify }) {
  const [survey, setSurvey] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [elements, setElements] = useState([]);
  const [profiles, setProfiles] = useState([DEFAULT_PROFILE]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTool, setActiveTool] = useState({ kind: 'markup', type: 'select', label: 'Select' });
  const [visibleLayers, setVisibleLayers] = useState(new Set(LAYER_IDS));
  const [zoom, setZoom] = useState(0.85);
  const [pageInfo, setPageInfo] = useState({ page: 1, pages: 1 });
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [presence, setPresence] = useState([]);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [mobilePanel, setMobilePanel] = useState(null);
  const [modal, setModal] = useState(null);
  const remoteTimer = useRef(null);
  const selectedIdRef = useRef(null);
  const canEdit = roleCanEdit(user.role);
  const canAnnotate = roleCanAnnotate(user.role);
  const selected = elements.find((element) => element.id === selectedId) || null;
  const orientation = Number(survey?.rotation ?? survey?.orientation ?? 0);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const reloadElements = async () => {
    const result = await api.elements(surveyId);
    const refreshed = normalizeList(result).map(normalizeElement);
    setElements((current) => {
      const photosById = new Map(
        current.filter((element) => Array.isArray(element.photos)).map((element) => [element.id, element.photos]),
      );
      return refreshed.map((element) => photosById.has(element.id) ? { ...element, photos: photosById.get(element.id) } : element);
    });
    return refreshed;
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const [surveyResult, elementResult, profileResult] = await Promise.all([api.survey(surveyId), api.elements(surveyId), api.profiles()]);
        if (!active) return;
        setSurvey(surveyResult?.survey || surveyResult);
        setElements(normalizeList(elementResult).map(normalizeElement));
        const fetchedProfiles = normalizeList(profileResult);
        setProfiles([DEFAULT_PROFILE, ...fetchedProfiles.filter((profile) => !profile.isBuiltin && !profile.is_builtin && profile.name?.toLowerCase() !== 'full door')]);
      } catch (error) {
        setLoadError(error.message || 'The survey could not be opened.');
        notify(error.message);
      }
      finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [surveyId, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socketOptions = {
      withCredentials: !nativeTransport.isNative,
      ...(nativeTransport.isNative ? { auth: { token: nativeTransport.sessionToken() } } : {}),
    };
    const socket = nativeTransport.isNative ? io(nativeTransport.apiOrigin, socketOptions) : io(socketOptions);
    const joinPayload = { surveyId };
    socket.on('connect', () => {
      setSyncStatus('connecting');
      socket.emit('survey:join', joinPayload, (result) => {
        if (result?.ok) {
          setSyncStatus('connected');
          if (Array.isArray(result.presence)) setPresence(result.presence.map((entry) => entry.user || entry));
        } else setSyncStatus('offline');
      });
    });
    socket.on('disconnect', () => setSyncStatus('offline'));
    socket.on('connect_error', () => setSyncStatus('offline'));
    socket.on('survey:presence', (payload) => {
      if (payload?.surveyId && payload.surveyId !== surveyId) return;
      setPresence(Array.isArray(payload) ? payload : payload?.users || payload?.members || []);
    });
    socket.on('survey:updated', (payload = {}) => {
      if (payload.surveyId && payload.surveyId !== surveyId) return;
      if (payload.action === 'survey.deleted') {
        setLoadError('This survey was deleted by another collaborator.');
        return;
      }
      if (payload.user?.id === user.id || payload.userId === user.id) return;
      setSurvey((current) => current ? {
        ...current,
        ...(payload.payload?.survey || {}),
        updatedAt: payload.updatedAt || payload.payload?.survey?.updatedAt || new Date().toISOString(),
        lastEditor: payload.user || payload.payload?.survey?.lastEditor || current.lastEditor,
        lastEditedBy: payload.user || payload.payload?.survey?.lastEditedBy || current.lastEditedBy,
      } : current);
      window.clearTimeout(remoteTimer.current);
      remoteTimer.current = window.setTimeout(() => {
        reloadElements().catch(() => setSyncStatus('offline'));
        const activeElementId = selectedIdRef.current;
        if (activeElementId && (payload.elementId === activeElementId || payload.type === 'note' || payload.type === 'photo')) {
          api.notes(activeElementId).then((result) => setNotes(normalizeList(result))).catch(() => {});
          api.photos(activeElementId).then((result) => {
            const remotePhotos = normalizeList(result);
            setElements((current) => current.map((element) => element.id === activeElementId ? { ...element, photos: remotePhotos, photoCount: remotePhotos.length } : element));
          }).catch(() => {});
        }
      }, 150);
    });
    return () => { window.clearTimeout(remoteTimer.current); socket.emit('survey:leave', joinPayload); socket.disconnect(); };
  }, [surveyId, user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    if (!selectedId) { setNotes([]); return undefined; }
    setNotesLoading(true);
    Promise.all([api.notes(selectedId), api.photos(selectedId)]).then(([noteResult, photoResult]) => {
      if (!active) return;
      setNotes(normalizeList(noteResult));
      const photos = normalizeList(photoResult);
      setElements((current) => current.map((element) => element.id === selectedId ? { ...element, photos } : element));
    }).catch((error) => notify(error.message)).finally(() => { if (active) setNotesLoading(false); });
    return () => { active = false; };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = () => setSurvey((current) => ({ ...current, updatedAt: new Date().toISOString(), lastEditor: user, lastEditedBy: user }));

  const createOne = async (values) => {
    const created = normalizeElement(await api.createElement(surveyId, values));
    setElements((current) => [...current, created]);
    setSelectedId(created.id);
    touch();
    return created;
  };

  const place = async (point) => {
    if (activeTool.kind === 'device') {
      try {
        await createOne({ category: activeTool.category, type: activeTool.type, label: activeTool.label, x: point.x, y: point.y, width: 0.04, height: 0.04, rotation: 0, color: activeTool.color, metadata: defaultMetadataForDevice(activeTool.type, activeTool.symbol, activeTool.color) });
        setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
      } catch (error) { notify(error.message); }
      return;
    }
    if (activeTool.kind === 'profile') {
      try {
        const assemblyId = crypto.randomUUID();
        const created = await Promise.all(componentsOf(activeTool).map((component) => api.createElement(surveyId, {
          category: component.category || 'custom', type: component.type || 'custom', label: component.label || activeTool.name,
          x: Math.max(0, Math.min(1, point.x + Number(component.offsetX || component.offset_x || 0))), y: Math.max(0, Math.min(1, point.y + Number(component.offsetY || component.offset_y || 0))),
          width: 0.04, height: 0.04, rotation: 0, color: categoryFor(component.category)?.color || '#13795b',
          profileId: activeTool.builtIn ? null : activeTool.id, metadata: { symbol: component.symbol || itemFor(component.category, component.type)?.symbol, size: 42, assemblyId, profileName: activeTool.name },
        })));
        const normalized = created.map(normalizeElement);
        setElements((current) => [...current, ...normalized]);
        setSelectedId(normalized[0]?.id || null);
        setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
        touch();
        notify(`${activeTool.name} placed with ${normalized.length} components.`);
      } catch (error) { notify(error.message); }
    }
  };

  const draw = async ({ type, start, end }) => {
    let x = start.x; let y = start.y; let width = end.x - start.x; let height = end.y - start.y;
    if (!['line', 'arrow'].includes(type)) { x = Math.min(start.x, end.x); y = Math.min(start.y, end.y); width = Math.abs(end.x - start.x); height = Math.abs(end.y - start.y); }
    if (Math.abs(width) < 0.005 && Math.abs(height) < 0.005 && type !== 'text') return;
    try {
      await createOne({ category: 'markup', type, label: type === 'text' ? 'Callout' : type[0].toUpperCase() + type.slice(1), x, y, width: type === 'text' ? 0.14 : width, height: type === 'text' ? 0.05 : height, rotation: 0, color: '#b4232d', metadata: type === 'text' ? { fontSize: 18 } : {} });
      setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
    } catch (error) { notify(error.message); }
  };

  const move = (id, x, y, commit) => {
    setElements((current) => current.map((element) => element.id === id ? { ...element, x, y } : element));
    if (commit) api.updateElement(id, { x, y }).then(touch).catch((error) => { notify(error.message); reloadElements(); });
  };

  const patchSelected = async (values) => {
    if (!selected) return;
    const previous = selected;
    setElements((current) => current.map((element) => element.id === selected.id ? normalizeElement({ ...element, ...values }) : element));
    try {
      const updated = await api.updateElement(selected.id, values);
      setElements((current) => current.map((element) => element.id === selected.id ? normalizeElement({ ...element, ...updated }) : element));
      touch();
    } catch (error) {
      setElements((current) => current.map((element) => element.id === previous.id ? previous : element));
      notify(error.message);
    }
  };

  const duplicateSelected = async () => {
    if (!selected) return;
    try {
      const { id, createdAt, created_at, updatedAt, updated_at, ...copy } = selected;
      await createOne({ ...copy, label: `${selected.label} copy`, x: Math.min(1, selected.x + 0.025), y: Math.min(1, selected.y + 0.025) });
      notify('Element duplicated.');
    } catch (error) { notify(error.message); }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    try {
      await api.deleteElement(selected.id);
      setElements((current) => current.filter((element) => element.id !== selected.id));
      setSelectedId(null);
      setModal(null);
      touch();
      notify('Element deleted.');
    } catch (error) { notify(error.message); }
  };

  const addNote = async (text) => {
    const created = await api.addNote(selected.id, text);
    setNotes((current) => [...current, created]);
    setElements((current) => current.map((element) => element.id === selected.id ? { ...element, noteCount: Number(element.noteCount ?? element.note_count ?? 0) + 1 } : element));
    touch();
  };

  const addPhoto = async (file, caption) => {
    setPhotoBusy(true);
    try {
      const created = await api.addPhoto(selected.id, file, caption);
      setElements((current) => current.map((element) => element.id === selected.id ? { ...element, photos: [...(element.photos || []), created], photoCount: Number(element.photoCount ?? element.photo_count ?? 0) + 1 } : element));
      touch();
      notify('Photo uploaded to the workspace.');
    } catch (error) { notify(error.message); }
    finally { setPhotoBusy(false); }
  };

  const rotate = async () => {
    const next = (orientation + 90) % 360;
    setSurvey((current) => ({ ...current, rotation: next, orientation: next }));
    try {
      const updated = await api.rotateSurvey(surveyId, next);
      setSurvey((current) => ({ ...current, ...updated, rotation: next, orientation: next }));
      touch();
    } catch (error) { setSurvey((current) => ({ ...current, rotation: orientation, orientation })); notify(error.message); }
  };

  const createProfile = async (values) => {
    const created = await api.createProfile(values);
    setProfiles((current) => [...current, created]);
    notify(`${created.name || values.name} profile created.`);
  };

  const lastEditor = survey?.lastEditor?.name || survey?.lastEditedBy?.name || survey?.last_editor_name || survey?.updatedBy?.name || 'No editor yet';
  if (loading) return <main id="main-content" className="editor-loading"><Spinner label="Opening survey editor…" /></main>;
  if (loadError || !survey) return <main id="main-content" className="boot-screen"><h1>Survey unavailable</h1><p>{loadError || 'The survey could not be opened.'}</p><div className="button-group"><button type="button" className="button button--secondary" onClick={() => navigate(siteId ? `sites/${siteId}` : 'sites')}>Back to site</button><button type="button" className="button button--primary" onClick={() => setReloadToken((value) => value + 1)}>Try again</button></div></main>;

  return (
    <main id="main-content" className="survey-editor">
      <header className="editor-header">
        <button type="button" className="icon-button" onClick={() => navigate(siteId ? `sites/${siteId}` : 'sites')} aria-label="Back to site"><span aria-hidden="true">←</span></button>
        <div className="editor-title"><h1>{survey.name}</h1><span>Last edited by {lastEditor} · {formatWhen(survey.updatedAt || survey.updated_at)}</span></div>
        <div className="editor-header__spacer" />
        <Presence users={presence.length ? presence : [user]} status={syncStatus} />
        <div className="editor-actions">
          <button type="button" className="button button--ghost" onClick={rotate} disabled={!canEdit} title="Rotate survey clockwise"><span aria-hidden="true">↻</span><span className="button-label">Rotate {orientation}°</span></button>
          <button type="button" className="button button--secondary" onClick={() => setModal({ type: 'schedule' })}><span aria-hidden="true">☷</span><span className="button-label">Schedule</span></button>
        </div>
      </header>

      <div className="editor-layout">
        <div className={`mobile-editor-drawer mobile-editor-drawer--left ${mobilePanel === 'library' ? 'open' : ''}`}><LibraryPanel activeTool={activeTool} profiles={profiles} visibleLayers={visibleLayers} canEdit={canEdit} onTool={(tool) => { setActiveTool(tool); if (tool.type !== 'select') setSelectedId(null); setMobilePanel(null); }} onLayer={(layer) => setVisibleLayers((current) => { const next = new Set(current); if (next.has(layer)) next.delete(layer); else next.add(layer); return next; })} onBuildProfile={() => setModal({ type: 'profile' })} onClose={() => setMobilePanel(null)} /></div>

        <section className="canvas-panel">
          <div className="canvas-toolbar" aria-label="Plan view controls">
            <div className="page-controls"><button type="button" className="icon-button" aria-label="Previous PDF page" disabled={pageInfo.page <= 1} onClick={() => setPageInfo((current) => ({ ...current, page: current.page - 1 }))}>‹</button><span>Page {pageInfo.page} of {pageInfo.pages}</span><button type="button" className="icon-button" aria-label="Next PDF page" disabled={pageInfo.page >= pageInfo.pages} onClick={() => setPageInfo((current) => ({ ...current, page: current.page + 1 }))}>›</button></div>
            <div className="zoom-controls"><button type="button" className="icon-button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}>−</button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" className="icon-button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, Number((value + 0.1).toFixed(2))))}>＋</button><button type="button" className="button button--ghost fit-button" onClick={() => setZoom(0.85)}>Fit</button></div>
          </div>
          <PdfPlan survey={survey} orientation={orientation} pageNumber={pageInfo.page} onPageInfo={setPageInfo} zoom={zoom} elements={elements} visibleLayers={visibleLayers} selectedId={selectedId} activeTool={activeTool} canEdit={canEdit} onPlace={place} onDraw={draw} onSelect={(id) => { setSelectedId(id); if (id && window.innerWidth < 900) setMobilePanel('inspector'); }} onMove={move} onDeleteSelected={() => selected && setModal({ type: 'delete-element' })} notify={notify} />
        </section>

        <div className={`mobile-editor-drawer mobile-editor-drawer--right ${mobilePanel === 'inspector' ? 'open' : ''}`}><InspectorPanel element={selected} notes={notes} notesLoading={notesLoading} canEdit={canEdit} canAnnotate={canAnnotate} onPatch={patchSelected} onDuplicate={duplicateSelected} onDelete={() => setModal({ type: 'delete-element' })} onAddNote={addNote} onAddPhoto={addPhoto} photoBusy={photoBusy} onClose={() => setMobilePanel(null)} /></div>
      </div>

      <nav className="editor-mobile-nav" aria-label="Survey editor panels"><button type="button" className={mobilePanel === 'library' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'library' ? null : 'library')}><span aria-hidden="true">▦</span>Components</button><button type="button" className={activeTool.type === 'select' ? 'active' : ''} onClick={() => { setActiveTool({ kind: 'markup', type: 'select', label: 'Select' }); setMobilePanel(null); }}><span aria-hidden="true">↖</span>Select</button><button type="button" className={mobilePanel === 'inspector' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector')} disabled={!selected}><span aria-hidden="true">☷</span>Properties</button></nav>

      <Modal open={modal?.type === 'schedule'} title="Device schedule" description={`${elements.filter((element) => element.category !== 'markup').length} plotted security components`} onClose={() => setModal(null)} wide><Schedule elements={elements} onSelect={setSelectedId} onClose={() => setModal(null)} /></Modal>
      <ProfileBuilder open={modal?.type === 'profile'} onClose={() => setModal(null)} onCreate={createProfile} />
      <ConfirmDialog open={modal?.type === 'delete-element'} title="Delete this element?" onClose={() => setModal(null)} onConfirm={deleteSelected}><p><strong>{selected?.label}</strong> and its notes and cloud photos will be permanently deleted.</p></ConfirmDialog>
    </main>
  );
}
