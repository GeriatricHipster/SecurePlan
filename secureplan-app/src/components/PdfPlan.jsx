import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api.js';
import { cameraFieldsFor, doorOutlineColorFor, elementColor, elementSymbol, isCameraType, itemFor, workflowStatusFor } from './deviceLibrary.js';
import DeviceGlyph from './DeviceGlyph.jsx';
import { clampPlanZoom, pointerDistance, pointerMidpoint, zoomFromPinch } from './planGestures.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export function toDisplay(point, orientation) {
  const rotation = ((Number(orientation) % 360) + 360) % 360;
  if (rotation === 90) return { x: 1 - point.y, y: point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: point.y, y: 1 - point.x };
  return point;
}

export function fromDisplay(point, orientation) {
  const rotation = ((Number(orientation) % 360) + 360) % 360;
  if (rotation === 90) return { x: point.y, y: 1 - point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: 1 - point.y, y: point.x };
  return point;
}

function getField(element, camel, snake, fallback) {
  return element[camel] ?? element[snake] ?? fallback;
}

function hasPdf(survey) {
  return Boolean(
    survey?.hasPdf ?? survey?.has_pdf ?? survey?.pdfFileName ?? survey?.pdf_file_name
    ?? survey?.fileName ?? survey?.file_name ?? survey?.pdfStorageKey ?? survey?.pdf_storage_key,
  );
}

function drawPlaceholder(canvas, orientation) {
  const portrait = orientation === 90 || orientation === 270;
  const width = portrait ? 840 : 1180;
  const height = portrait ? 1180 : 840;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f9faf9';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#d7dde0';
  context.lineWidth = 1;
  for (let x = 0; x < width; x += 35) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  for (let y = 0; y < height; y += 35) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
  context.strokeStyle = '#aab4ba';
  context.lineWidth = 3;
  context.strokeRect(width * 0.09, height * 0.11, width * 0.82, height * 0.73);
  context.strokeRect(width * 0.09, height * 0.11, width * 0.34, height * 0.31);
  context.strokeRect(width * 0.43, height * 0.11, width * 0.48, height * 0.18);
  context.strokeRect(width * 0.43, height * 0.29, width * 0.22, height * 0.27);
  context.strokeRect(width * 0.65, height * 0.29, width * 0.26, height * 0.27);
  context.strokeRect(width * 0.09, height * 0.42, width * 0.34, height * 0.42);
  context.fillStyle = '#66737c';
  context.font = '600 25px system-ui';
  context.textAlign = 'center';
  context.fillText('Blank survey canvas', width / 2, height * 0.92);
  return { width, height };
}

function MarkupElement({ element, orientation, selected, onPointerDown, onSelect, onEdit }) {
  const x = Number(getField(element, 'x', 'x', 0.5));
  const y = Number(getField(element, 'y', 'y', 0.5));
  const width = Number(getField(element, 'width', 'width', 0.12));
  const height = Number(getField(element, 'height', 'height', 0.08));
  const start = toDisplay({ x, y }, orientation);
  const end = toDisplay({ x: x + width, y: y + height }, orientation);
  const color = elementColor(element);
  const strokeWidth = Math.max(1, Math.min(20, Number(element.metadata?.strokeWidth || 3)));
  if (element.type === 'line' || element.type === 'arrow') {
    const markerId = `arrow-${String(element.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return (
      <svg className={`markup-line ${selected ? 'selected' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="button" tabIndex="0" aria-pressed={selected} aria-label={element.label} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onDoubleClick={(event) => { event.stopPropagation(); onEdit(element.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); } }}>
        {element.type === 'arrow' && <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill={color} /></marker></defs>}
        <line className="markup-line__hit-area" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} vectorEffect="non-scaling-stroke" />
        <line className="markup-line__visible" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" markerEnd={element.type === 'arrow' ? `url(#${markerId})` : undefined} />
      </svg>
    );
  }
  const left = Math.min(start.x, end.x) * 100;
  const top = Math.min(start.y, end.y) * 100;
  const boxWidth = Math.abs(end.x - start.x) * 100;
  const boxHeight = Math.abs(end.y - start.y) * 100;
  if (element.type === 'text') {
    return <button type="button" className={`markup-text ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, minHeight: `${Math.max(3, boxHeight)}%`, color, fontSize: `${Math.max(10, Number(element.metadata?.fontSize || 18))}px` }} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onDoubleClick={(event) => { event.stopPropagation(); onEdit(element.id); }}>{element.label || 'Callout'}</button>;
  }
  return <button type="button" aria-label={`${element.label} markup`} className={`markup-shape markup-shape--${element.type} ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, height: `${boxHeight}%`, borderColor: color, borderWidth: `${strokeWidth}px`, backgroundColor: `${color}18` }} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onDoubleClick={(event) => { event.stopPropagation(); onEdit(element.id); }} />;
}

function DeviceElement({ element, orientation, selected, onPointerDown, onSelect }) {
  const point = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const size = Number(element.metadata?.size || element.size || 42);
  const rotation = Number(element.rotation || 0) + Number(orientation || 0);
  const color = elementColor(element);
  const outlineColor = doorOutlineColorFor(element.metadata?.doorFunction || element.type);
  const components = Array.isArray(element.metadata?.components) ? element.metadata.components : [];
  const workflow = workflowStatusFor(element);

  return (
    <button
      type="button"
      data-element-id={element.id}
      className={`plan-element ${selected ? 'selected' : ''}`}
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        width: `${size}px`,
        height: `${size}px`,
        '--element-color': color,
        '--outline-color': outlineColor,
        transform: 'translate(-50%, -50%)',
        border: `2.5px solid ${outlineColor}`,
        boxShadow: selected
          ? `0 0 0 4px color-mix(in srgb, ${outlineColor} 22%, transparent), 0 10px 22px rgb(15 23 42 / 24%)`
          : `0 8px 18px rgb(15 23 42 / 18%)`,
        background: 'rgba(255,255,255,.95)',
        borderRadius: '999px',
      }}
      onPointerDown={(event) => onPointerDown(event, element)}
      onClick={(event) => { event.stopPropagation(); onSelect(element.id); }}
      aria-label={`${element.label || element.type}${selected ? ', selected' : ''}`}
      aria-pressed={selected}
    >
      <span className="plan-element__glyph" style={{ transform: `rotate(${rotation}deg)` }}>
        <DeviceGlyph
          type={element.type}
          symbol={elementSymbol(element)}
          label={element.label}
          iconSrc={itemFor(element.category, element.type)?.reportIcon}
          color={color}
        />
      </span>

      {components.length > 0 && (
        <span className="plan-element__components" aria-label={`Components: ${components.map((component) => component.label).join(', ')}`}>
          {components.map((component, index) => (
            <i key={`${component.type}-${index}`} title={component.label}>
              {component.symbol || itemFor(component.category, component.type)?.symbol || '?'}
            </i>
          ))}
        </span>
      )}

      <span className="plan-element__label">{element.label}</span>
      <span
        className="plan-element__status"
        style={{ '--status-color': workflow.color }}
        title={`Installation status: ${workflow.label}`}
        aria-label={`Installation status: ${workflow.label}`}
      />
      {(Number(element.noteCount ?? element.note_count ?? 0) + Number(element.photoCount ?? element.photo_count ?? 0)) > 0 && (
        <small aria-hidden="true">
          {Number(element.noteCount ?? element.note_count ?? 0) + Number(element.photoCount ?? element.photo_count ?? 0)}
        </small>
      )}
    </button>
  );
}

function CameraFieldOfView({ element, orientation }) {
  if (!isCameraType(element.type)) return null;
  const metadata = element.metadata || {};
  const origin = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const fovs = cameraFieldsFor(element);
  return (
    <svg className="camera-fov" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {fovs.map((fov, index) => {
        const length = Math.max(0.03, Math.min(0.75, Number(fov.length ?? 0.22)));
        const spread = Math.max(5, Math.min(180, Number(fov.spread ?? 60)));
        const direction = (Number(fov.rotation || 0) + Number(orientation || 0) - 90) * Math.PI / 180;
        const halfSpread = spread * Math.PI / 360;
        const left = { x: origin.x + Math.cos(direction - halfSpread) * length, y: origin.y + Math.sin(direction - halfSpread) * length };
        const right = { x: origin.x + Math.cos(direction + halfSpread) * length, y: origin.y + Math.sin(direction + halfSpread) * length };
        const color = /^#[0-9a-f]{6}$/i.test(fov.color || '') ? fov.color : elementColor(element);
        return <polygon key={fov.id || index} points={`${origin.x * 100},${origin.y * 100} ${left.x * 100},${left.y * 100} ${right.x * 100},${right.y * 100}`} fill={color} stroke={color} />;
      })}
    </svg>
  );
}

function MarkupPopup({ element, orientation, onPreview, onCommit, onClose }) {
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (!element) { setDraft(null); return; }
    setDraft({
      label: element.label || '', color: elementColor(element), x: Number(element.x), y: Number(element.y),
      width: Number(element.width), height: Number(element.height), metadata: element.metadata || {},
    });
  }, [element?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!element || element.category !== 'markup') return null;
  if (!draft) return null;
  const metadata = draft.metadata || {};
  const length = Math.max(0.01, Math.min(0.8, Math.hypot(Number(draft.width), Number(draft.height))));
  const start = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const end = toDisplay({ x: Number(element.x) + Number(element.width), y: Number(element.y) + Number(element.height) }, orientation);
  const anchor = {
    x: Math.max(0.18, Math.min(0.82, (start.x + end.x) / 2)),
    y: Math.max(0.08, Math.min(0.88, Math.max(start.y, end.y) + 0.045)),
  };
  const patchLength = (next) => {
    const angle = Math.atan2(Number(draft.height), Number(draft.width));
    const values = { width: Math.cos(angle) * next, height: Math.sin(angle) * next };
    setDraft((current) => ({ ...current, ...values }));
    onPreview(element.id, values);
  };
  const preview = (values) => { setDraft((current) => ({ ...current, ...values })); onPreview(element.id, values); };
  const previewMetadata = (values) => { const next = { ...metadata, ...values }; setDraft((current) => ({ ...current, metadata: next })); onPreview(element.id, { metadata: next }); };
  return <div className="markup-popup" role="dialog" aria-label={`${element.type} formatting`} style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} onPointerDown={(event) => event.stopPropagation()}>
    <header className="markup-popup__header"><div><strong>{element.type === 'text' ? 'Edit text' : `Edit ${element.type}`}</strong><small>Changes save when you finish a field</small></div><button type="button" className="markup-popup__close" onClick={onClose} aria-label="Close formatting controls">×</button></header>
    <div className="markup-popup__grid">
      {element.type === 'text' && <label className="markup-control markup-control--wide"><span>Text</span><input autoFocus value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} onBlur={() => draft.label !== element.label && onCommit(element.id, { label: draft.label })} /></label>}
      <label className="markup-control"><span>Color</span><input type="color" value={draft.color} onChange={(event) => preview({ color: event.target.value })} onBlur={() => onCommit(element.id, { color: draft.color })} /></label>
      {element.type === 'text' ? <label className="markup-control markup-control--wide"><span>Font size <output>{Number(metadata.fontSize || 18)} px</output></span><input type="range" min="10" max="72" value={Number(metadata.fontSize || 18)} onChange={(event) => previewMetadata({ fontSize: Number(event.target.value) })} onPointerUp={() => onCommit(element.id, { metadata: draft.metadata })} onKeyUp={() => onCommit(element.id, { metadata: draft.metadata })} /></label> : <>
        <label className="markup-control"><span>Thickness <output>{Number(metadata.strokeWidth || 3)} px</output></span><input type="range" min="1" max="20" value={Number(metadata.strokeWidth || 3)} onChange={(event) => previewMetadata({ strokeWidth: Number(event.target.value) })} onPointerUp={() => onCommit(element.id, { metadata: draft.metadata })} onKeyUp={() => onCommit(element.id, { metadata: draft.metadata })} /></label>
        <label className="markup-control markup-control--wide"><span>Length <output>{Math.round(length * 100)}%</output></span><input type="range" min="0.01" max="0.8" step="0.01" value={length} onChange={(event) => patchLength(Number(event.target.value))} onPointerUp={() => onCommit(element.id, { width: draft.width, height: draft.height })} onKeyUp={() => onCommit(element.id, { width: draft.width, height: draft.height })} /></label>
      </>}
      <fieldset className="markup-position"><legend>Position</legend><label className="markup-control"><span>Left / right <output>{Math.round(draft.x * 100)}%</output></span><input type="range" min="0" max="1" step="0.005" value={draft.x} onChange={(event) => preview({ x: Number(event.target.value) })} onPointerUp={() => onCommit(element.id, { x: draft.x })} onKeyUp={() => onCommit(element.id, { x: draft.x })} /></label><label className="markup-control"><span>Up / down <output>{Math.round(draft.y * 100)}%</output></span><input type="range" min="0" max="1" step="0.005" value={draft.y} onChange={(event) => preview({ y: Number(event.target.value) })} onPointerUp={() => onCommit(element.id, { y: draft.y })} onKeyUp={() => onCommit(element.id, { y: draft.y })} /></label></fieldset>
    </div>
  </div>;
}

function SelectionHandles({ element, orientation, dimensions, onStart }) {
  if (!element) return null;
  if (element.category !== 'markup') {
    const center = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
    const halfX = (Number(element.metadata?.size || 42) / dimensions.width) / 2;
    const halfY = (Number(element.metadata?.size || 42) / dimensions.height) / 2;
    return <div className="resize-handles" aria-label={`Resize ${element.label}`}>{[['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]].map(([handle, x, y]) => <button key={handle} type="button" className={`resize-handle resize-handle--${handle}`} style={{ left: `${(center.x + halfX * x) * 100}%`, top: `${(center.y + halfY * y) * 100}%` }} onPointerDown={(event) => onStart(event, element, handle)} aria-label={`Resize ${element.label} from ${handle}`} />)}</div>;
  }
  const start = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const end = toDisplay({ x: Number(element.x) + Number(element.width), y: Number(element.y) + Number(element.height) }, orientation);
  const points = ['line', 'arrow'].includes(element.type)
    ? [['start', start.x, start.y], ['end', end.x, end.y]]
    : [['nw', Math.min(start.x, end.x), Math.min(start.y, end.y)], ['ne', Math.max(start.x, end.x), Math.min(start.y, end.y)], ['sw', Math.min(start.x, end.x), Math.max(start.y, end.y)], ['se', Math.max(start.x, end.x), Math.max(start.y, end.y)]];
  return <div className="resize-handles" aria-label={`Resize ${element.label}`}>{points.map(([handle, x, y]) => <button key={handle} type="button" className={`resize-handle resize-handle--${handle}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onPointerDown={(event) => onStart(event, element, handle)} aria-label={`Resize ${element.label} from ${handle}`} />)}</div>;
}

export default function PdfPlan({ survey, orientation, pageNumber, onPageInfo, zoom, onZoom, elements, visibleLayers, selectedId, activeTool, canEdit, onPlace, onDropComponent, onDraw, onPreviewElement, onPatchElement, onResizeElement, onSelect, onMove, onDeleteSelected, notify }) {
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  const drawRef = useRef(null);
  const scrollRef = useRef(null);
  const resizeRef = useRef(null);
  const draftFrameRef = useRef(null);
  const draftPointRef = useRef(null);
  const lastTapRef = useRef({ id: null, at: 0 });
  const panRef = useRef(null);
  const tapActionRef = useRef(null);
  const touchPointersRef = useRef(new Map());
  const consumedTouchRef = useRef(new Set());
  const pinchRef = useRef(null);
  const pinchFrameRef = useRef(null);
  const pinchAnchorFrameRef = useRef(null);
  const pinchUpdateRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1180, height: 840 });
  const [rendering, setRendering] = useState(true);
  const [draftShape, setDraftShape] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [panning, setPanning] = useState(false);
  const [pinching, setPinching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task;
    const render = async () => {
      setRendering(true);
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!hasPdf(survey)) {
        const next = drawPlaceholder(canvas, orientation);
        if (!cancelled) { setDimensions(next); setRendering(false); onPageInfo?.({ page: 1, pages: 1 }); }
        return;
      }
      try {
        task = pdfjs.getDocument(api.surveyFileRequest(survey.id));
        const document = await task.promise;
        const safePage = Math.min(Math.max(1, pageNumber), document.numPages);
        const page = await document.getPage(safePage);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.75, Math.max(1.1, 1500 / Math.max(base.width, base.height)));
        const viewport = page.getViewport({ scale, rotation: orientation });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (!cancelled) {
          setDimensions({ width: canvas.width, height: canvas.height });
          setRendering(false);
          onPageInfo?.({ page: safePage, pages: document.numPages });
        }
      } catch (error) {
        if (cancelled) return;
        const next = drawPlaceholder(canvas, orientation);
        setDimensions(next);
        setRendering(false);
        notify?.('The PDF could not be rendered. Showing a blank survey canvas instead.');
      }
    };
    render();
    return () => { cancelled = true; task?.destroy?.(); };
  }, [survey?.id, orientation, pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const surfacePoint = (event) => {
    const bounds = surfaceRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const stopPinchFrames = () => {
    if (pinchFrameRef.current) cancelAnimationFrame(pinchFrameRef.current);
    if (pinchAnchorFrameRef.current) cancelAnimationFrame(pinchAnchorFrameRef.current);
    pinchFrameRef.current = null;
    pinchAnchorFrameRef.current = null;
    pinchUpdateRef.current = null;
  };

  const cancelSinglePointerAction = () => {
    if (dragRef.current?.moved) onMove(dragRef.current.id, dragRef.current.originX, dragRef.current.originY, false);
    if (resizeRef.current?.values) {
      const original = resizeRef.current.element;
      onResizeElement(resizeRef.current.id, {
        x: Number(original.x), y: Number(original.y), width: Number(original.width), height: Number(original.height), metadata: original.metadata || {},
      }, false);
    }
    if (draftFrameRef.current) cancelAnimationFrame(draftFrameRef.current);
    draftFrameRef.current = null;
    draftPointRef.current = null;
    panRef.current = null;
    tapActionRef.current = null;
    dragRef.current = null;
    drawRef.current = null;
    resizeRef.current = null;
    setPanning(false);
    setDraftShape(null);
  };

  const pointerDownCapture = (event) => {
    if (event.pointerType !== 'touch') return;
    const pointers = touchPointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current) {
      consumedTouchRef.current.add(event.pointerId);
      surfaceRef.current?.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (pointers.size < 2) return;
    const pair = [...pointers.entries()].slice(0, 2);
    const first = pair[0][1];
    const second = pair[1][1];
    const distance = pointerDistance(first, second);
    if (distance <= 0) return;
    const midpoint = pointerMidpoint(first, second);
    const bounds = surfaceRef.current.getBoundingClientRect();
    cancelSinglePointerAction();
    const pointerIds = pair.map(([pointerId]) => pointerId);
    pointerIds.forEach((pointerId) => {
      consumedTouchRef.current.add(pointerId);
      surfaceRef.current?.setPointerCapture?.(pointerId);
    });
    pinchRef.current = {
      pointerIds,
      startDistance: distance,
      startZoom: zoom,
      anchorX: bounds.width ? (midpoint.x - bounds.left) / bounds.width : 0.5,
      anchorY: bounds.height ? (midpoint.y - bounds.top) / bounds.height : 0.5,
    };
    setPinching(true);
    event.preventDefault();
  };

  const pointerDownSurface = (event) => {
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) return;
    if (activeTool.type === 'select' && event.button === 0) {
      const scroll = scrollRef.current;
      const selectionCleared = event.pointerType !== 'touch';
      if (selectionCleared) { onSelect(null); setEditingId(null); }
      panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: scroll.scrollLeft, scrollTop: scroll.scrollTop, selectionCleared };
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanning(true);
      return;
    }
    if (!canEdit) { onSelect(null); return; }
    if (activeTool.kind === 'device' || activeTool.kind === 'profile') {
      if (event.pointerType === 'touch') {
        tapActionRef.current = { pointerId: event.pointerId, kind: 'place', startX: event.clientX, startY: event.clientY, cancelled: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      onPlace(fromDisplay(surfacePoint(event), orientation));
      return;
    }
    if (['line', 'arrow', 'rectangle', 'ellipse'].includes(activeTool.type)) {
      const startDisplay = surfacePoint(event);
      drawRef.current = { pointerId: event.pointerId, startDisplay, type: activeTool.type };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftShape({ type: activeTool.type, start: startDisplay, end: startDisplay });
      return;
    }
    if (activeTool.type === 'text') {
      if (event.pointerType === 'touch') {
        tapActionRef.current = { pointerId: event.pointerId, kind: 'text', startX: event.clientX, startY: event.clientY, cancelled: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      onDraw({ type: 'text', start: fromDisplay(surfacePoint(event), orientation), end: fromDisplay({ x: Math.min(1, surfacePoint(event).x + 0.12), y: Math.min(1, surfacePoint(event).y + 0.05) }, orientation) });
      return;
    }
    onSelect(null);
    setEditingId(null);
  };

  const dropComponent = (event) => {
    event.preventDefault();
    if (!canEdit) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-secureplan-component'));
      const targetId = event.target.closest?.('[data-element-id]')?.dataset.elementId || null;
      onDropComponent(payload, fromDisplay(surfacePoint(event), orientation), targetId);
    } catch { notify?.('That component could not be added. Please drag it from the SecurePlan library.'); }
  };

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const wheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = scroll.getBoundingClientRect();
      const anchorX = event.clientX - bounds.left + scroll.scrollLeft;
      const anchorY = event.clientY - bounds.top + scroll.scrollTop;
      const next = clampPlanZoom(zoom * (event.deltaY < 0 ? 1.12 : 0.89));
      if (next === zoom) return;
      const ratio = next / zoom;
      onZoom(next);
      requestAnimationFrame(() => { scroll.scrollLeft = anchorX * ratio - (event.clientX - bounds.left); scroll.scrollTop = anchorY * ratio - (event.clientY - bounds.top); });
    };
    scroll.addEventListener('wheel', wheel, { passive: false });
    return () => scroll.removeEventListener('wheel', wheel);
  }, [zoom, onZoom]);

  useEffect(() => () => {
    if (draftFrameRef.current) cancelAnimationFrame(draftFrameRef.current);
    if (pinchFrameRef.current) cancelAnimationFrame(pinchFrameRef.current);
    if (pinchAnchorFrameRef.current) cancelAnimationFrame(pinchAnchorFrameRef.current);
    touchPointersRef.current.clear();
    consumedTouchRef.current.clear();
  }, []);

  const pointerDownElement = (event, element) => {
    event.stopPropagation();
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) { event.preventDefault(); return; }
    const now = Date.now();
    const touchDoubleTap = event.pointerType === 'touch' && lastTapRef.current.id === element.id && now - lastTapRef.current.at < 450;
    lastTapRef.current = { id: element.id, at: now };
    if ((event.detail >= 2 || touchDoubleTap) && element.category === 'markup') {
      event.preventDefault();
      dragRef.current = null;
      onSelect(element.id);
      setEditingId(element.id);
      return;
    }
    setEditingId(null);
    onSelect(element.id);
    if (!canEdit || activeTool.type !== 'select') return;
    const point = fromDisplay(surfacePoint(event), orientation);
    dragRef.current = { id: element.id, pointerId: event.pointerId, dx: point.x - Number(element.x), dy: point.y - Number(element.y), originX: Number(element.x), originY: Number(element.y), startClientX: event.clientX, startClientY: event.clientY, moved: false };
    surfaceRef.current.setPointerCapture(event.pointerId);
  };

  const startResize = (event, element, handle) => {
    event.preventDefault();
    event.stopPropagation();
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) return;
    onSelect(element.id);
    resizeRef.current = { id: element.id, pointerId: event.pointerId, handle, element };
    surfaceRef.current.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event) => {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinchRef.current?.pointerIds.includes(event.pointerId)) {
      const [firstId, secondId] = pinchRef.current.pointerIds;
      const first = touchPointersRef.current.get(firstId);
      const second = touchPointersRef.current.get(secondId);
      if (!first || !second) return;
      const midpoint = pointerMidpoint(first, second);
      pinchUpdateRef.current = {
        zoom: zoomFromPinch(pinchRef.current.startZoom, pinchRef.current.startDistance, pointerDistance(first, second)),
        midpoint,
      };
      if (!pinchFrameRef.current) {
        pinchFrameRef.current = requestAnimationFrame(() => {
          pinchFrameRef.current = null;
          const update = pinchUpdateRef.current;
          if (!update || !pinchRef.current) return;
          onZoom(update.zoom);
          if (pinchAnchorFrameRef.current) cancelAnimationFrame(pinchAnchorFrameRef.current);
          pinchAnchorFrameRef.current = requestAnimationFrame(() => {
            pinchAnchorFrameRef.current = null;
            const session = pinchRef.current;
            const latest = pinchUpdateRef.current;
            const surface = surfaceRef.current;
            const scroll = scrollRef.current;
            if (!session || !latest || !surface || !scroll) return;
            const bounds = surface.getBoundingClientRect();
            const renderedAnchorX = bounds.left + session.anchorX * bounds.width;
            const renderedAnchorY = bounds.top + session.anchorY * bounds.height;
            scroll.scrollLeft += renderedAnchorX - latest.midpoint.x;
            scroll.scrollTop += renderedAnchorY - latest.midpoint.y;
          });
        });
      }
      event.preventDefault();
      return;
    }
    if (consumedTouchRef.current.has(event.pointerId)) return;
    if (tapActionRef.current?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - tapActionRef.current.startX, event.clientY - tapActionRef.current.startY) > 8) tapActionRef.current.cancelled = true;
      return;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      const scroll = scrollRef.current;
      if (!panRef.current.selectionCleared && Math.hypot(event.clientX - panRef.current.startX, event.clientY - panRef.current.startY) > 3) {
        onSelect(null);
        setEditingId(null);
        panRef.current.selectionCleared = true;
      }
      scroll.scrollLeft = panRef.current.scrollLeft - (event.clientX - panRef.current.startX);
      scroll.scrollTop = panRef.current.scrollTop - (event.clientY - panRef.current.startY);
      return;
    }
    if (drawRef.current?.pointerId === event.pointerId) {
      const end = surfacePoint(event);
      draftPointRef.current = end;
      if (!draftFrameRef.current) draftFrameRef.current = requestAnimationFrame(() => {
        draftFrameRef.current = null;
        const nextEnd = draftPointRef.current;
        setDraftShape((current) => current ? { ...current, end: nextEnd } : current);
      });
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      if (!dragRef.current.moved && Math.hypot(event.clientX - dragRef.current.startClientX, event.clientY - dragRef.current.startClientY) < 3) return;
      const point = fromDisplay(surfacePoint(event), orientation);
      dragRef.current.moved = true;
      onMove(dragRef.current.id, Math.max(0, Math.min(1, point.x - dragRef.current.dx)), Math.max(0, Math.min(1, point.y - dragRef.current.dy)), false);
    }
    if (resizeRef.current?.pointerId === event.pointerId) {
      const { element, handle } = resizeRef.current;
      const displayPoint = surfacePoint(event);
      if (element.category !== 'markup') {
        const center = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
        const size = Math.max(20, Math.min(180, Math.max(Math.abs(displayPoint.x - center.x) * dimensions.width, Math.abs(displayPoint.y - center.y) * dimensions.height) * 2));
        const values = { metadata: { ...(element.metadata || {}), size: Math.round(size) } };
        resizeRef.current.values = values;
        onResizeElement(element.id, values, false);
      } else {
        const originalStart = { x: Number(element.x), y: Number(element.y) };
        const originalEnd = { x: originalStart.x + Number(element.width), y: originalStart.y + Number(element.height) };
        const point = fromDisplay(displayPoint, orientation);
        let start = originalStart; let end = originalEnd;
        if (handle === 'start') start = point;
        else if (handle === 'end' || handle === 'se') end = point;
        else if (handle === 'nw') start = point;
        else if (handle === 'ne') { start = { x: originalStart.x, y: point.y }; end = { x: point.x, y: originalEnd.y }; }
        else if (handle === 'sw') { start = { x: point.x, y: originalStart.y }; end = { x: originalEnd.x, y: point.y }; }
        const values = { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
        resizeRef.current.values = values;
        onResizeElement(element.id, values, false);
      }
    }
  };

  const pointerUp = (event) => {
    const cancelled = event.type === 'pointercancel';
    const consumed = consumedTouchRef.current.has(event.pointerId);
    if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId);
    if (pinchRef.current?.pointerIds.includes(event.pointerId)) {
      pinchRef.current = null;
      stopPinchFrames();
      setPinching(false);
    }
    if (consumed) {
      panRef.current = null;
      tapActionRef.current = null;
      setPanning(false);
      if (touchPointersRef.current.size === 0) consumedTouchRef.current.clear();
      return;
    }
    if (tapActionRef.current?.pointerId === event.pointerId) {
      const action = tapActionRef.current;
      tapActionRef.current = null;
      if (!cancelled && !action.cancelled && canEdit) {
        const point = fromDisplay(surfacePoint(event), orientation);
        if (action.kind === 'place') onPlace(point);
        else onDraw({ type: 'text', start: point, end: fromDisplay({ x: Math.min(1, surfacePoint(event).x + 0.12), y: Math.min(1, surfacePoint(event).y + 0.05) }, orientation) });
      }
      return;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      if (!panRef.current.selectionCleared) { onSelect(null); setEditingId(null); }
      panRef.current = null;
      setPanning(false);
      return;
    }
    if (drawRef.current?.pointerId === event.pointerId) {
      const start = fromDisplay(drawRef.current.startDisplay, orientation);
      const end = fromDisplay(surfacePoint(event), orientation);
      if (draftFrameRef.current) cancelAnimationFrame(draftFrameRef.current);
      draftFrameRef.current = null;
      if (!cancelled) onDraw({ type: drawRef.current.type, start, end });
      drawRef.current = null;
      setDraftShape(null);
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      if (dragRef.current.moved) {
        if (cancelled) onMove(dragRef.current.id, dragRef.current.originX, dragRef.current.originY, false);
        else {
          const point = fromDisplay(surfacePoint(event), orientation);
          onMove(dragRef.current.id, Math.max(0, Math.min(1, point.x - dragRef.current.dx)), Math.max(0, Math.min(1, point.y - dragRef.current.dy)), true);
        }
      }
      dragRef.current = null;
    }
    if (resizeRef.current?.pointerId === event.pointerId) {
      const { id, values, element } = resizeRef.current;
      if (values && cancelled) onResizeElement(id, { x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height), metadata: element.metadata || {} }, false);
      else if (values) onResizeElement(id, values, true);
      resizeRef.current = null;
    }
  };

  const keyDown = (event) => {
    if (!selectedId || !canEdit) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDeleteSelected();
      return;
    }
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!offsets[event.key]) return;
    event.preventDefault();
    const element = elements.find((item) => item.id === selectedId);
    if (!element || element.category === 'markup') return;
    const step = event.shiftKey ? 0.02 : 0.004;
    const display = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
    const canonical = fromDisplay({
      x: Math.max(0, Math.min(1, display.x + offsets[event.key][0] * step)),
      y: Math.max(0, Math.min(1, display.y + offsets[event.key][1] * step)),
    }, orientation);
    onMove(selectedId, canonical.x, canonical.y, true);
  };

  const draftBounds = draftShape ? {
    left: Math.min(draftShape.start.x, draftShape.end.x) * 100,
    top: Math.min(draftShape.start.y, draftShape.end.y) * 100,
    width: Math.abs(draftShape.end.x - draftShape.start.x) * 100,
    height: Math.abs(draftShape.end.y - draftShape.start.y) * 100,
  } : null;

  return (
    <div ref={scrollRef} className="plan-scroll" aria-label="Blueprint workspace">
      <div className="plan-zoom-space" style={{ width: dimensions.width * zoom, height: dimensions.height * zoom }}>
        <div className={`plan-stage tool-${['device', 'profile'].includes(activeTool.kind) ? activeTool.kind : activeTool.type} ${panning ? 'is-panning' : ''} ${pinching ? 'is-pinching' : ''}`} style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${zoom})` }}>
          <canvas ref={canvasRef} aria-label={`Floor plan page ${pageNumber}`} />
          <div
            ref={surfaceRef}
            className="plan-surface"
            tabIndex="0"
            role="region"
            aria-label="Interactive floor plan. On mobile, use two fingers to zoom and one finger in Select mode to move the blueprint. Choose a component then click to place it. Selected elements can be moved with arrow keys."
            onPointerDownCapture={pointerDownCapture}
            onPointerDown={pointerDownSurface}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onKeyDown={keyDown}
            onDragOver={(event) => { if (canEdit) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={dropComponent}
          >
            {elements.filter((element) => visibleLayers.has(element.category)).map((element) => element.category === 'markup'
              ? <MarkupElement key={element.id} element={element} orientation={orientation} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} onEdit={setEditingId} />
              : <React.Fragment key={element.id}>
                  <CameraFieldOfView element={element} orientation={orientation} />
                  <DeviceElement element={element} orientation={orientation} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} />
                </React.Fragment>)}
            {draftBounds && draftShape.type !== 'line' && draftShape.type !== 'arrow' && <span className={`draft-shape draft-shape--${draftShape.type}`} style={{ left: `${draftBounds.left}%`, top: `${draftBounds.top}%`, width: `${draftBounds.width}%`, height: `${draftBounds.height}%` }} />}
            {draftShape && (draftShape.type === 'line' || draftShape.type === 'arrow') && <svg className="draft-line" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={draftShape.start.x * 100} y1={draftShape.start.y * 100} x2={draftShape.end.x * 100} y2={draftShape.end.y * 100} /></svg>}
            {canEdit && <SelectionHandles element={elements.find((element) => element.id === selectedId)} orientation={orientation} dimensions={dimensions} onStart={startResize} />}
            {canEdit && <MarkupPopup element={elements.find((element) => element.id === editingId)} orientation={orientation} onPreview={onPreviewElement} onCommit={onPatchElement} onClose={() => setEditingId(null)} />}
          </div>
          {rendering && <div className="plan-rendering" role="status">Rendering floor plan…</div>}
        </div>
      </div>
    </div>
  );
}
