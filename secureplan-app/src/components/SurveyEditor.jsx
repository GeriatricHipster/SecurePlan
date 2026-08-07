import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, nativeTransport, normalizeList } from '../api.js';
import { ConfirmDialog, Field, Modal, Spinner, formatWhen, initials, roleCanAnnotate, roleCanEdit } from './Common.jsx';
import PdfPlan from './PdfPlan.jsx';
import { DEFAULT_ICON_COLOR, DEFAULT_PROFILE, DEVICE_CATEGORIES, DEVICE_WORKFLOW_STATUSES, DOOR_FUNCTIONS, MARKUP_TOOLS, cameraFieldsFor, categoryFor, devicePlacementDefaults, doorFunctionFor, elementColor, elementSymbol, isCameraType, isDoorType, itemFor, workflowStatusFor } from './deviceLibrary.js';
import { FIT_PLAN_ZOOM, MAX_PLAN_ZOOM, MIN_PLAN_ZOOM } from './planGestures.js';
import DeviceGlyph from './DeviceGlyph.jsx';
import { exportSurveyPdf } from './surveyPdfExport.js';

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

function LibraryPanel({ activeTool, profiles, visibleLayers, canEdit, doorFunction, onDoorFunction, onTool, onLayer, onBuildProfile, onClose, scalePaperInches, scaleRealFeet, onScaleChange }) {
  const startDrag = (event, payload) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-secureplan-component', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', payload.label || payload.name || 'SecurePlan component');
  };
  return (
    <aside className="editor-panel library-panel" aria-label="Component library">
      <div className="editor-panel__heading"><div><p className="eyebrow">Plotting</p><h2>Components</h2></div><button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close component library">×</button></div>
      <div className="markup-tools" role="toolbar" aria-label="Drawing tools">
        {MARKUP_TOOLS.map((tool) => <button key={tool.type} type="button" aria-label={tool.label} title={tool.label} aria-pressed={activeTool.type === tool.type} className={activeTool.type === tool.type ? 'active' : ''} onClick={() => onTool({ kind: 'markup', ...tool })} disabled={!canEdit && tool.type !== 'select'}><span aria-hidden="true">{tool.symbol}</span><small>{tool.label}</small></button>)}
      </div>
      {activeTool.type === 'measure' && (
        <div className="measure-scale-config">
          <p className="measure-scale-config__hint">Set the drawing's print scale to get real-world distances.</p>
          <div className="measure-scale-config__row">
            <label><span>Inches on paper</span><input type="number" min="0.001" step="0.001" value={scalePaperInches} onChange={(event) => onScaleChange({ scalePaperInches: event.target.value })} /></label>
            <span aria-hidden="true">=</span>
            <label><span>Feet in real life</span><input type="number" min="0.001" step="0.001" value={scaleRealFeet} onChange={(event) => onScaleChange({ scaleRealFeet: event.target.value })} /></label>
          </div>
        </div>
      )}
      <div className="library-scroll">
        {DEVICE_CATEGORIES.map((category) => (
          <details className="component-group" key={category.id} defaultOpen={category.id === 'access_control'}>
            <summary><span className="category-dot" style={{ backgroundColor: category.color }} /><strong>{category.name}</strong><span>{category.items.length}</span></summary>
            {category.items.some((item) => isDoorType(item.type)) && (
              <div className="door-function-config">
                <label htmlFor={`door-function-${category.id}`}><span>Door function</span><select id={`door-function-${category.id}`} value={doorFunction} disabled={!canEdit} onChange={(event) => onDoorFunction(event.target.value)}>{DOOR_FUNCTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                <span className="door-function-config__hint"><i style={{ backgroundColor: doorFunctionFor(doorFunction).color }} />New door icons will plot as {doorFunctionFor(doorFunction).label.toLowerCase()}.</span>
              </div>
            )}
            <div className="component-grid">
              {category.items.map((item) => {
                const active = activeTool.kind === 'device' && activeTool.category === category.id && activeTool.type === item.type;
                const doorOption = doorFunctionFor(doorFunction);
                const color = isDoorType(item.type) ? doorOption.color : DEFAULT_ICON_COLOR;
                const payload = { kind: 'device', category: category.id, color, type: item.type, label: item.label, symbol: item.symbol, ...(isDoorType(item.type) ? { doorFunction: doorOption.id } : {}) };
                return <button type="button" draggable={canEdit} onDragStart={(event) => startDrag(event, payload)} key={item.type} className={active ? 'active' : ''} aria-pressed={active} disabled={!canEdit} onClick={() => onTool({ ...item, ...payload })}><span className="library-symbol" style={{ '--symbol-color': color }}><DeviceGlyph type={item.type} symbol={item.symbol} label={item.label} iconSrc={item.reportIcon} color={color} /></span><span>{item.label}</span></button>;
              })}
            </div>
          </details>
        ))}
        <details className="component-group">
          <summary><span className="category-dot" style={{ backgroundColor: '#13795b' }} /><strong>Custom</strong><span>{profiles.length}</span></summary>
          <div className="profile-list">
            {profiles.map((profile) => {
              const active = activeTool.kind === 'profile' && activeTool.id === profile.id;
              const components = componentsOf(profile);
              const payload = { kind: 'profile', ...profile, components };
              return <button type="button" draggable={canEdit} onDragStart={(event) => startDrag(event, payload)} key={profile.id} className={active ? 'active' : ''} aria-pressed={active} disabled={!canEdit} onClick={() => onTool(payload)}><span className="profile-stack" aria-hidden="true">{components.slice(0, 4).map((component, index) => <i key={`${component.type}-${index}`}>{component.symbol || itemFor(component.category, component.type)?.symbol || '?'}</i>)}</span><span><strong>{profile.name}</strong><small>{components.map((component) => component.symbol || itemFor(component.category, component.type)?.symbol).filter(Boolean).join(' · ') || profile.description}</small></span></button>;
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
      <div className="placement-hint" role="status"><strong>Drag components onto the plan</strong><span>Drop one onto an existing icon to add it to that assembly</span></div>
    </aside>
  );
}

function DeviceLifecyclePanel({ element, canEdit, onPatch }) {
  const metadata = metadataOf(element);
  const asset = metadata.asset || {};
  const [form, setForm] = useState({});
  useEffect(() => {
    setForm({
      workflowStatus: metadata.workflowStatus || 'planned', assignee: metadata.assignee || '', dueDate: metadata.dueDate || '',
      manufacturer: asset.manufacturer || '', model: asset.model || '', partNumber: asset.partNumber || '', serialNumber: asset.serialNumber || '',
      ipAddress: asset.ipAddress || '', macAddress: asset.macAddress || '', installDate: asset.installDate || '', warrantyExpiry: asset.warrantyExpiry || '',
    });
  }, [element.id, element.updatedAt, element.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const saveWorkflow = (field) => {
    if (form[field] === (metadata[field] || '')) return;
    onPatch({ metadata: { ...metadata, [field]: form[field] } });
  };
  const saveAsset = (field) => {
    if (form[field] === (asset[field] || '')) return;
    onPatch({ metadata: { ...metadata, asset: { ...asset, [field]: form[field] } } });
  };
  return <section className="device-lifecycle" aria-label="Device lifecycle">
    <div className="section-title"><h3>Lifecycle & field status</h3><span className="workflow-badge" style={{ '--workflow-color': workflowStatusFor({ metadata: { ...metadata, workflowStatus: form.workflowStatus } }).color, '--workflow-text-color': workflowStatusFor({ metadata: { ...metadata, workflowStatus: form.workflowStatus } }).textColor }}>{workflowStatusFor({ metadata: { ...metadata, workflowStatus: form.workflowStatus } }).label}</span></div>
    <div className="form-grid form-grid--two">
      <Field label="Installation status"><select value={form.workflowStatus || 'planned'} disabled={!canEdit} onChange={(event) => { const workflowStatus = event.target.value; update('workflowStatus', workflowStatus); onPatch({ metadata: { ...metadata, workflowStatus } }); }}>{DEVICE_WORKFLOW_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></Field>
      <Field label="Assigned to"><input value={form.assignee || ''} disabled={!canEdit} placeholder="Technician or vendor" onChange={(event) => update('assignee', event.target.value)} onBlur={() => saveWorkflow('assignee')} /></Field>
      <Field label="Target date"><input type="date" value={form.dueDate || ''} disabled={!canEdit} onChange={(event) => update('dueDate', event.target.value)} onBlur={() => saveWorkflow('dueDate')} /></Field>
      <Field label="Progress"><div className="workflow-progress"><span style={{ width: `${workflowStatusFor({ metadata: { workflowStatus: form.workflowStatus } }).progress}%`, backgroundColor: workflowStatusFor({ metadata: { workflowStatus: form.workflowStatus } }).color }} /><output>{workflowStatusFor({ metadata: { workflowStatus: form.workflowStatus } }).progress}%</output></div></Field>
    </div>
    <details className="asset-record"><summary><strong>Asset record</strong><span>Manufacturer, model, serial, network and warranty</span></summary><div className="form-grid form-grid--two">
      <Field label="Manufacturer"><input value={form.manufacturer || ''} disabled={!canEdit} onChange={(event) => update('manufacturer', event.target.value)} onBlur={() => saveAsset('manufacturer')} /></Field>
      <Field label="Model"><input value={form.model || ''} disabled={!canEdit} onChange={(event) => update('model', event.target.value)} onBlur={() => saveAsset('model')} /></Field>
      <Field label="Part number"><input value={form.partNumber || ''} disabled={!canEdit} onChange={(event) => update('partNumber', event.target.value)} onBlur={() => saveAsset('partNumber')} /></Field>
      <Field label="Serial number"><input value={form.serialNumber || ''} disabled={!canEdit} onChange={(event) => update('serialNumber', event.target.value)} onBlur={() => saveAsset('serialNumber')} /></Field>
      <Field label="IP address"><input value={form.ipAddress || ''} disabled={!canEdit} inputMode="decimal" onChange={(event) => update('ipAddress', event.target.value)} onBlur={() => saveAsset('ipAddress')} /></Field>
      <Field label="MAC address"><input value={form.macAddress || ''} disabled={!canEdit} autoCapitalize="characters" onChange={(event) => update('macAddress', event.target.value)} onBlur={() => saveAsset('macAddress')} /></Field>
      <Field label="Installed"><input type="date" value={form.installDate || ''} disabled={!canEdit} onChange={(event) => update('installDate', event.target.value)} onBlur={() => saveAsset('installDate')} /></Field>
      <Field label="Warranty expires"><input type="date" value={form.warrantyExpiry || ''} disabled={!canEdit} onChange={(event) => update('warrantyExpiry', event.target.value)} onBlur={() => saveAsset('warrantyExpiry')} /></Field>
    </div></details>
  </section>;
}

function InspectorPanel({ element, notes, notesLoading, canEdit, canAnnotate, onPatch, onDuplicate, onDelete, onAddNote, onAddPhoto, photoBusy, onClose, onCollapse }) {
  const [form, setForm] = useState({
    label: '', color: '#46545f', size: 42, rotation: 0, doorFunction: 'controlled', fovColor: '#1769aa', fovLength: 0.22, fovSpread: 60, fovRotation: 0,
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
      doorFunction: doorFunctionFor(metadata.doorFunction).id,
      fovColor: metadata.fovColor || elementColor(element),
      fovLength: Number(metadata.fovLength ?? 0.22),
      fovSpread: Number(metadata.fovSpread ?? 60),
      fovRotation: Number(metadata.fovRotation ?? 0),
    });
  }, [element?.id, element?.label, element?.color, element?.rotation, element?.metadata?.doorFunction]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNoteText('');
    setNoteError('');
    setPhotoCaption('');
  }, [element?.id]);

  if (!element) {
    return (
      <aside className="editor-panel inspector-panel" aria-label="Element properties">
        <div className="editor-panel__heading"><div><p className="eyebrow">Details</p><h2>Properties</h2></div><button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close properties">×</button><button type="button" className="icon-button desktop-only" onClick={onCollapse} aria-label="Collapse properties panel" title="Collapse panel">»</button></div>
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
      <div className="editor-panel__heading"><div><p className="eyebrow">Selected element</p><h2>{element.label}</h2></div><button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close properties">×</button><button type="button" className="icon-button desktop-only" onClick={onCollapse} aria-label="Collapse properties panel" title="Collapse panel">»</button></div>
      <div className="inspector-scroll">
        <section className="inspector-section">
          <div className="element-identity"><span className="library-symbol" style={{ '--symbol-color': form.color }}><DeviceGlyph type={element.type} symbol={elementSymbol(element)} label={element.label} iconSrc={itemFor(element.category, element.type)?.reportIcon} color={form.color} /></span><div><strong>{categoryFor(element.category)?.name || (element.category === 'markup' ? 'Markup' : 'Custom')}</strong><span>{itemFor(element.category, element.type)?.label || element.type.replaceAll('_', ' ')}</span></div></div>
          <Field label="Element label"><input value={form.label} disabled={!canEdit} onChange={(e) => setForm({ ...form, label: e.target.value })} onBlur={() => form.label !== element.label && onPatch({ label: form.label })} /></Field>
          {isDoorType(element.type) && <div className="door-function-field"><Field label="Door function"><select value={form.doorFunction} disabled={!canEdit} onChange={(event) => { const option = doorFunctionFor(event.target.value); setForm((current) => ({ ...current, doorFunction: option.id, color: option.color })); onPatch({ color: option.color, metadata: { ...metadata, doorFunction: option.id } }); }}>{DOOR_FUNCTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field><div className="door-function-key" aria-label="Door function colors">{DOOR_FUNCTIONS.map((option) => <span key={option.id}><i style={{ backgroundColor: option.color }} />{option.label}</span>)}</div><p>Changing the door function automatically applies its standard icon color. You can still choose a custom color below.</p></div>}
          <div className="form-grid form-grid--two">
            <fieldset className="field color-field"><legend className="field__label">Icon color</legend><div className="color-control"><input type="color" aria-label="Choose icon color" value={form.color} disabled={!canEdit} onChange={(e) => setForm({ ...form, color: e.target.value })} onBlur={() => form.color !== elementColor(element) && onPatch({ color: form.color })} /><input aria-label="Icon color hex value" value={form.color} disabled={!canEdit} pattern="#[0-9a-fA-F]{6}" onChange={(e) => setForm({ ...form, color: e.target.value })} onBlur={() => /^#[0-9a-f]{6}$/i.test(form.color) && onPatch({ color: form.color })} /></div></fieldset>
            <Field label="Rotation"><div className="range-control"><input type="range" min="0" max="355" step="5" value={form.rotation} disabled={!canEdit} onChange={(e) => setForm({ ...form, rotation: Number(e.target.value) })} onPointerUp={() => onPatch({ rotation: form.rotation })} onKeyUp={() => onPatch({ rotation: form.rotation })} /><output>{form.rotation}°</output></div></Field>
          </div>
          {element.category !== 'markup' && <Field label="Icon size"><div className="range-control"><input type="range" min="28" max="100" step="2" value={form.size} disabled={!canEdit} onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} onPointerUp={() => onPatch({ metadata: { ...metadata, size: form.size } })} onKeyUp={() => onPatch({ metadata: { ...metadata, size: form.size } })} /><output>{form.size}px</output></div></Field>}
          {isCameraType(element.type) && (
            <fieldset className="camera-fov-controls">
              <legend>Camera field of view</legend>
              {element.type === 'multisensor_camera' ? (
                <div className="multisensor-fov-list">
                  {cameraFieldsFor(element).map((fov, index, currentFovs) => <fieldset key={fov.id || index} className="multisensor-fov-control"><legend>View {index + 1}</legend>
                    <label>Color <input type="color" value={fov.color || elementColor(element)} disabled={!canEdit} onChange={(event) => { const fovs = currentFovs.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item); onPatch({ metadata: { ...metadata, fovs } }); }} /></label>
                    <Field label="Direction"><div className="range-control"><input type="range" min="0" max="359" value={Number(fov.rotation || 0)} disabled={!canEdit} onChange={(event) => { const fovs = currentFovs.map((item, itemIndex) => itemIndex === index ? { ...item, rotation: Number(event.target.value) } : item); onPatch({ metadata: { ...metadata, fovs } }); }} /><output>{Number(fov.rotation || 0)}°</output></div></Field>
                    <Field label="Length"><div className="range-control"><input type="range" min="0.05" max="0.75" step="0.01" value={Number(fov.length || 0.22)} disabled={!canEdit} onChange={(event) => { const fovs = currentFovs.map((item, itemIndex) => itemIndex === index ? { ...item, length: Number(event.target.value) } : item); onPatch({ metadata: { ...metadata, fovs } }); }} /><output>{Math.round(Number(fov.length || 0.22) * 100)}%</output></div></Field>
                    <Field label="Spread"><div className="range-control"><input type="range" min="5" max="180" step="5" value={Number(fov.spread || 60)} disabled={!canEdit} onChange={(event) => { const fovs = currentFovs.map((item, itemIndex) => itemIndex === index ? { ...item, spread: Number(event.target.value) } : item); onPatch({ metadata: { ...metadata, fovs } }); }} /><output>{Number(fov.spread || 60)}°</output></div></Field>
                  </fieldset>)}
                </div>
              ) : <>
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
              <Field label="Cone direction"><div className="range-control"><input type="range" min="0" max="359" step="1" value={form.fovRotation} disabled={!canEdit} onChange={(e) => setForm({ ...form, fovRotation: Number(e.target.value) })} onPointerUp={() => onPatch({ metadata: { ...metadata, fovRotation: form.fovRotation } })} onKeyUp={() => onPatch({ metadata: { ...metadata, fovRotation: form.fovRotation } })} /><output>{form.fovRotation}°</output></div></Field>
              </>}
              <p>The cone direction is independent from the camera icon rotation.</p>
            </fieldset>
          )}
          {element.category !== 'markup' && Array.isArray(metadata.components) && metadata.components.length > 0 && <fieldset className="assembly-components"><legend>Attached components</legend>{metadata.components.map((component, index) => <div key={`${component.type}-${index}`}><span><strong>{component.symbol}</strong> {component.label}</span>{canEdit && <button type="button" className="icon-button" aria-label={`Remove ${component.label}`} onClick={() => onPatch({ metadata: { ...metadata, components: metadata.components.filter((_, itemIndex) => itemIndex !== index) } })}>×</button>}</div>)}</fieldset>}
          {element.category !== 'markup' && <DeviceLifecyclePanel element={element} canEdit={canEdit} onPatch={onPatch} />}
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
    const rows = [['Label', 'System', 'Type', 'Door function', 'Status', 'Progress', 'Assignee', 'Target date', 'Manufacturer', 'Model', 'Part number', 'Serial number', 'IP address', 'MAC address', 'Installed', 'Warranty expires', 'Notes', 'Photos', 'Last edited']];
    devices.forEach((element) => { const metadata = metadataOf(element); const asset = metadata.asset || {}; const workflow = workflowStatusFor(element); rows.push([element.label, categoryFor(element.category)?.name || 'Custom', itemFor(element.category, element.type)?.label || element.type, isDoorType(element.type) ? doorFunctionFor(metadata.doorFunction).label : '', workflow.label, `${workflow.progress}%`, metadata.assignee || '', metadata.dueDate || '', asset.manufacturer || '', asset.model || '', asset.partNumber || '', asset.serialNumber || '', asset.ipAddress || '', asset.macAddress || '', asset.installDate || '', asset.warrantyExpiry || '', element.noteCount ?? element.note_count ?? 0, element.photoCount ?? element.photo_count ?? element.photos?.length ?? 0, element.updatedAt || element.updated_at || '']); });
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
      <div className="workflow-summary">{DEVICE_WORKFLOW_STATUSES.map((status) => { const count = devices.filter((element) => workflowStatusFor(element).id === status.id).length; return count ? <div key={status.id}><i style={{ backgroundColor: status.color }} /><strong>{count}</strong><span>{status.label}</span></div> : null; })}</div>
      <div className="table-scroll"><table><thead><tr><th>Element</th><th>Door function</th><th>Status</th><th>Progress</th><th>Assigned</th><th>Target</th><th>System</th><th>Type</th><th>Asset</th><th>Notes</th><th>Photos</th><th>Last edit</th></tr></thead><tbody>{devices.map((element) => { const metadata = metadataOf(element); const asset = metadata.asset || {}; const workflow = workflowStatusFor(element); return <tr key={element.id}><td><button type="button" onClick={() => { onSelect(element.id); onClose(); }}><span className="schedule-symbol" style={{ '--element-color': elementColor(element) }}>{elementSymbol(element)}</span>{element.label}</button></td><td>{isDoorType(element.type) ? doorFunctionFor(metadata.doorFunction).label : '—'}</td><td><span className="schedule-status" style={{ '--workflow-color': workflow.color, '--workflow-text-color': workflow.textColor }}>{workflow.label}</span></td><td>{workflow.progress}%</td><td>{metadata.assignee || '—'}</td><td>{metadata.dueDate || '—'}</td><td>{categoryFor(element.category)?.name || 'Custom'}</td><td>{itemFor(element.category, element.type)?.label || element.type}</td><td>{[asset.manufacturer, asset.model, asset.serialNumber].filter(Boolean).join(' · ') || '—'}</td><td>{element.noteCount ?? element.note_count ?? 0}</td><td>{element.photoCount ?? element.photo_count ?? element.photos?.length ?? 0}</td><td>{formatWhen(element.updatedAt || element.updated_at)}</td></tr>; })}</tbody></table></div>
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

export default function SurveyEditor({ user, surveyId, siteId, navigate, notify, theme, toggleTheme }) {
  const [survey, setSurvey] = useState(null);
  const [scaleDraft, setScaleDraft] = useState({ scalePaperInches: 1, scaleRealFeet: 4 });
  const scaleSaveTimer = useRef(null);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [elements, setElements] = useState([]);
  const [profiles, setProfiles] = useState([DEFAULT_PROFILE]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTool, setActiveTool] = useState({ kind: 'markup', type: 'select', label: 'Select' });
  const [doorFunction, setDoorFunction] = useState('controlled');
  const [visibleLayers, setVisibleLayers] = useState(new Set(LAYER_IDS));
  const [zoom, setZoom] = useState(FIT_PLAN_ZOOM);
  const [pageInfo, setPageInfo] = useState({ page: 1, pages: 1 });
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [presence, setPresence] = useState([]);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [mobilePanel, setMobilePanel] = useState(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [modal, setModal] = useState(null);
  const remoteTimer = useRef(null);
  const selectedIdRef = useRef(null);
  const planStageRef = useRef(null);
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
        const loadedSurvey = surveyResult?.survey || surveyResult;
        setSurvey(loadedSurvey);
        setScaleDraft({
          scalePaperInches: Number(loadedSurvey?.scalePaperInches ?? 1),
          scaleRealFeet: Number(loadedSurvey?.scaleRealFeet ?? 4),
        });
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
        const placement = devicePlacementDefaults(activeTool.type, activeTool.symbol, activeTool.doorFunction || doorFunction);
        await createOne({ category: activeTool.category, type: activeTool.type, label: activeTool.label, x: point.x, y: point.y, width: 0.04, height: 0.04, rotation: 0, ...placement });
        setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
      } catch (error) { notify(error.message); }
      return;
    }
    if (activeTool.kind === 'profile') {
      try {
        const assemblyId = crypto.randomUUID();
        const created = await Promise.all(componentsOf(activeTool).map((component) => {
          const symbol = component.symbol || itemFor(component.category, component.type)?.symbol;
          const placement = devicePlacementDefaults(component.type, symbol, component.doorFunction || doorFunction);
          return api.createElement(surveyId, {
            category: component.category || 'custom', type: component.type || 'custom', label: component.label || activeTool.name,
            x: Math.max(0, Math.min(1, point.x + Number(component.offsetX || component.offset_x || 0))), y: Math.max(0, Math.min(1, point.y + Number(component.offsetY || component.offset_y || 0))),
            width: 0.04, height: 0.04, rotation: 0, color: placement.color,
            profileId: activeTool.builtIn ? null : activeTool.id, metadata: { ...placement.metadata, assemblyId, profileName: activeTool.name },
          });
        }));
        const normalized = created.map(normalizeElement);
        setElements((current) => [...current, ...normalized]);
        setSelectedId(normalized[0]?.id || null);
        setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
        touch();
        notify(`${activeTool.name} placed with ${normalized.length} components.`);
      } catch (error) { notify(error.message); }
    }
  };

  const dropComponent = async (payload, point, targetId) => {
    if (!payload || !canEdit) return;
    if (targetId && payload.kind === 'device') {
      const target = elements.find((element) => element.id === targetId && element.category !== 'markup');
      if (!target) return;
      const targetMetadata = metadataOf(target);
      const components = Array.isArray(targetMetadata.components) ? targetMetadata.components : [];
      const component = { category: payload.category, type: payload.type, label: payload.label, symbol: payload.symbol, color: payload.color, ...(payload.doorFunction ? { doorFunction: payload.doorFunction } : {}) };
      if (components.some((item) => item.category === component.category && item.type === component.type)) { notify(`${payload.label} is already part of ${target.label}.`); return; }
      try {
        const metadata = { ...targetMetadata, components: [...components, component] };
        const updated = await api.updateElement(target.id, { metadata });
        setElements((current) => current.map((element) => element.id === target.id ? normalizeElement({ ...element, ...updated, metadata }) : element));
        setSelectedId(target.id);
        touch();
        notify(`${payload.label} added to ${target.label}.`);
      } catch (error) { notify(error.message); }
      return;
    }
    const previousTool = activeTool;
    setActiveTool(payload);
    try {
      if (payload.kind === 'device') {
        const placement = devicePlacementDefaults(payload.type, payload.symbol, payload.doorFunction || doorFunction);
        await createOne({ category: payload.category, type: payload.type, label: payload.label, x: point.x, y: point.y, width: 0.04, height: 0.04, rotation: 0, ...placement });
      } else if (payload.kind === 'profile') {
        const assemblyId = crypto.randomUUID();
        const created = await Promise.all(componentsOf(payload).map((component) => {
          const placement = devicePlacementDefaults(component.type, component.symbol, component.doorFunction || doorFunction);
          return api.createElement(surveyId, { category: component.category || 'custom', type: component.type || 'custom', label: component.label || payload.name, x: Math.max(0, Math.min(1, point.x + Number(component.offsetX || 0))), y: Math.max(0, Math.min(1, point.y + Number(component.offsetY || 0))), width: 0.04, height: 0.04, rotation: 0, color: placement.color, metadata: { ...placement.metadata, assemblyId, profileName: payload.name } });
        }));
        setElements((current) => [...current, ...created.map(normalizeElement)]);
        touch();
      }
    } catch (error) { notify(error.message); }
    finally { setActiveTool(previousTool.kind === 'markup' ? previousTool : { kind: 'markup', type: 'select', label: 'Select' }); }
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

  const resizeElement = (id, values, commit) => {
    setElements((current) => current.map((element) => element.id === id ? normalizeElement({ ...element, ...values }) : element));
    if (commit) api.updateElement(id, values).then((updated) => { setElements((current) => current.map((element) => element.id === id ? normalizeElement({ ...element, ...updated }) : element)); touch(); }).catch((error) => { notify(error.message); reloadElements(); });
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

  const patchElement = async (id, values) => {
    const previous = elements.find((element) => element.id === id);
    if (!previous) return;
    setElements((current) => current.map((element) => element.id === id ? normalizeElement({ ...element, ...values }) : element));
    try { const updated = await api.updateElement(id, values); setElements((current) => current.map((element) => element.id === id ? normalizeElement({ ...element, ...updated }) : element)); touch(); }
    catch (error) { setElements((current) => current.map((element) => element.id === id ? previous : element)); notify(error.message); }
  };

  const previewElement = (id, values) => {
    setElements((current) => current.map((element) => element.id === id ? normalizeElement({ ...element, ...values }) : element));
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

  const exportPdf = async () => {
    setPdfBusy(true);
    let planImageDataUrl = null;
    try {
      let site = { name: '' };
      try { site = await api.site(siteId); } catch { /* fall back to a blank site name rather than blocking the export */ }

      if (planStageRef.current?.captureFloorPlanImage) {
        try {
          planImageDataUrl = await planStageRef.current.captureFloorPlanImage();
        } catch {
          // If the floor plan image can't be captured for any reason, continue with a text-only export instead of blocking it.
        }
      }

      await exportSurveyPdf({ survey, site, elements, planImageDataUrl });
    } catch (error) {
      notify(error.message);
    } finally {
      setPdfBusy(false);
    }
  };

  const updateScale = (patch) => {
    setScaleDraft((current) => ({ ...current, ...patch }));
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    scaleSaveTimer.current = window.setTimeout(async () => {
      const paperInches = Number(patch.scalePaperInches ?? scaleDraft.scalePaperInches);
      const realFeet = Number(patch.scaleRealFeet ?? scaleDraft.scaleRealFeet);
      if (!(paperInches > 0) || !(realFeet > 0)) return;
      try {
        await api.updateSurvey(surveyId, { scalePaperInches: paperInches, scaleRealFeet: realFeet });
      } catch (error) {
        notify(error.message);
      }
    }, 500);
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
          <button type="button" className="button button--secondary" onClick={toggleTheme} title="Toggle dark mode"><span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span className="button-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
          <button type="button" className="button button--secondary" onClick={exportPdf} disabled={pdfBusy} title="Export a PDF summary of plotted devices"><span aria-hidden="true">⬇</span><span className="button-label">{pdfBusy ? 'Exporting…' : 'Export PDF'}</span></button>
        </div>
      </header>

      <div className={`editor-layout ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
        {mobilePanel && <button type="button" className="mobile-editor-backdrop" aria-label="Close editor panel" onClick={() => setMobilePanel(null)} />}
        <div className={`mobile-editor-drawer mobile-editor-drawer--left ${mobilePanel === 'library' ? 'open' : ''}`}><LibraryPanel activeTool={activeTool} profiles={profiles} visibleLayers={visibleLayers} canEdit={canEdit} doorFunction={doorFunction} onDoorFunction={(value) => { setDoorFunction(value); setActiveTool((current) => isDoorType(current.type) ? { ...current, doorFunction: value, color: doorFunctionFor(value).color } : current); }} onTool={(tool) => { setActiveTool(tool); if (tool.type !== 'select') setSelectedId(null); setMobilePanel(null); }} onLayer={(layer) => setVisibleLayers((current) => { const next = new Set(current); if (next.has(layer)) next.delete(layer); else next.add(layer); return next; })} onBuildProfile={() => setModal({ type: 'profile' })} onClose={() => setMobilePanel(null)} scalePaperInches={scaleDraft.scalePaperInches} scaleRealFeet={scaleDraft.scaleRealFeet} onScaleChange={updateScale} /></div>

        <section className="canvas-panel">
          <div className="canvas-toolbar" aria-label="Plan view controls">
            <div className="page-controls"><button type="button" className="icon-button" aria-label="Previous PDF page" disabled={pageInfo.page <= 1} onClick={() => setPageInfo((current) => ({ ...current, page: current.page - 1 }))}>‹</button><span>Page {pageInfo.page} of {pageInfo.pages}</span><button type="button" className="icon-button" aria-label="Next PDF page" disabled={pageInfo.page >= pageInfo.pages} onClick={() => setPageInfo((current) => ({ ...current, page: current.page + 1 }))}>›</button></div>
            <div className="zoom-controls"><button type="button" className="icon-button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(MIN_PLAN_ZOOM, Number((value - 0.1).toFixed(2))))}>−</button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" className="icon-button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(MAX_PLAN_ZOOM, Number((value + 0.1).toFixed(2))))}>＋</button><button type="button" className="button button--ghost fit-button" onClick={() => setZoom(FIT_PLAN_ZOOM)}>Fit</button></div>
          </div>
          <PdfPlan survey={survey} orientation={orientation} pageNumber={pageInfo.page} onPageInfo={setPageInfo} zoom={zoom} onZoom={setZoom} elements={elements} visibleLayers={visibleLayers} selectedId={selectedId} activeTool={activeTool} canEdit={canEdit} onPlace={place} onDropComponent={dropComponent} onDraw={draw} onPreviewElement={previewElement} onPatchElement={patchElement} onResizeElement={resizeElement} onSelect={setSelectedId} onMove={move} onDeleteSelected={() => selected && setModal({ type: 'delete-element' })} notify={notify} stageRef={planStageRef} scalePaperInches={scaleDraft.scalePaperInches} scaleRealFeet={scaleDraft.scaleRealFeet} />
          <div className="mobile-canvas-hint" aria-hidden="true">1 finger moves · 2 fingers zoom</div>
        </section>

        <div className={`mobile-editor-drawer mobile-editor-drawer--right ${mobilePanel === 'inspector' ? 'open' : ''}`}><InspectorPanel element={selected} notes={notes} notesLoading={notesLoading} canEdit={canEdit} canAnnotate={canAnnotate} onPatch={patchSelected} onDuplicate={duplicateSelected} onDelete={() => setModal({ type: 'delete-element' })} onAddNote={addNote} onAddPhoto={addPhoto} photoBusy={photoBusy} onClose={() => setMobilePanel(null)} onCollapse={() => setInspectorCollapsed(true)} /></div>
        {inspectorCollapsed && <button type="button" className="inspector-reopen-tab desktop-only" onClick={() => setInspectorCollapsed(false)} aria-label="Show properties panel" title="Show properties panel"><span aria-hidden="true">«</span></button>}
      </div>

      <nav className="editor-mobile-nav" aria-label="Survey editor panels"><button type="button" className={mobilePanel === 'library' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'library' ? null : 'library')}><span aria-hidden="true">＋</span>Add</button><button type="button" className={activeTool.type === 'select' && !mobilePanel ? 'active' : ''} onClick={() => { setActiveTool({ kind: 'markup', type: 'select', label: 'Select' }); setMobilePanel(null); }}><span aria-hidden="true">✥</span>Move</button><button type="button" className={mobilePanel === 'inspector' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector')} disabled={!selected}><span aria-hidden="true">☷</span>{selected ? 'Details' : 'Select item'}</button></nav>

      <Modal open={modal?.type === 'schedule'} title="Device schedule" description={`${elements.filter((element) => element.category !== 'markup').length} plotted security components`} onClose={() => setModal(null)} wide><Schedule elements={elements} onSelect={setSelectedId} onClose={() => setModal(null)} /></Modal>
      <ProfileBuilder open={modal?.type === 'profile'} onClose={() => setModal(null)} onCreate={createProfile} />
      <ConfirmDialog open={modal?.type === 'delete-element'} title="Delete this element?" onClose={() => setModal(null)} onConfirm={deleteSelected}><p><strong>{selected?.label}</strong> and its notes and cloud photos will be permanently deleted.</p></ConfirmDialog>
    </main>
  );
}
