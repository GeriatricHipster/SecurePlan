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

function InlineTextEditor({ element, left, top, boxWidth, boxHeight, color, onPreview, onCommit, onDone }) {
  const [value, setValue] = useState(element.label || '');
  const saveTimer = useRef(null);
  const flush = (nextValue) => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (nextValue !== (element.label || '')) onCommit(element.id, { label: nextValue });
  };
  return (
    <textarea
      autoFocus
      className="markup-text markup-text--editing"
      style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, minHeight: `${Math.max(3, boxHeight)}%`, color, fontSize: `${Math.max(10, Number(element.metadata?.fontSize || 18))}px` }}
      value={value}
      placeholder="Callout"
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        onPreview(element.id, { label: next });
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => onCommit(element.id, { label: next }), 500);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
        else if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); }
      }}
      onBlur={(event) => { flush(event.target.value); onDone(); }}
    />
  );
}

function MarkupElementBase({ element, orientation, selected, onPointerDown, onSelect, onEdit, editingId, onPreview, onCommit, dimensions, pointsPerPixel, scalePaperInches, scaleRealFeet }) {
  const x = Number(getField(element, 'x', 'x', 0.5));
  const y = Number(getField(element, 'y', 'y', 0.5));
  const width = Number(getField(element, 'width', 'width', 0.12));
  const height = Number(getField(element, 'height', 'height', 0.08));
  const start = toDisplay({ x, y }, orientation);
  const end = toDisplay({ x: x + width, y: y + height }, orientation);
  const color = elementColor(element);
  const strokeWidth = Math.max(1, Math.min(20, Number(element.metadata?.strokeWidth || 3)));
  if (element.type === 'measure') {
    const pixelDistance = Math.hypot((end.x - start.x) * dimensions.width, (end.y - start.y) * dimensions.height);
    const paperInches = pixelDistance * (pointsPerPixel / 72);
    const paperRatio = Number(scalePaperInches) > 0 ? Number(scalePaperInches) : 1;
    const realFeet = paperInches * ((Number(scaleRealFeet) || 0) / paperRatio);
    const feet = Math.floor(realFeet);
    let inches = Math.round((realFeet - feet) * 12);
    let wholeFeet = feet;
    if (inches >= 12) { wholeFeet += 1; inches = 0; }
    return (
      <>
        <svg className={`markup-line measure-line ${selected ? 'selected' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="button" tabIndex="0" aria-pressed={selected} aria-label={element.label} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); } }}>
          <line className="markup-line__hit-area" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} vectorEffect="non-scaling-stroke" />
          <line className="markup-line__visible" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} stroke={color} strokeWidth={strokeWidth} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="measure-label" style={{ left: `${((start.x + end.x) / 2) * 100}%`, top: `${((start.y + end.y) / 2) * 100}%`, background: color }}>{`${wholeFeet}'-${inches}"`}</span>
      </>
    );
  }
  if (element.type === 'line' || element.type === 'arrow') {
    const markerId = `arrow-${String(element.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return (
      <svg className={`markup-line ${selected ? 'selected' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="button" tabIndex="0" aria-pressed={selected} aria-label={element.label} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); } }}>
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
    if (editingId === element.id) {
      return <InlineTextEditor element={element} left={left} top={top} boxWidth={boxWidth} boxHeight={boxHeight} color={color} onPreview={onPreview} onCommit={onCommit} onDone={() => onEdit(null)} />;
    }
    return <button type="button" className={`markup-text ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, minHeight: `${Math.max(3, boxHeight)}%`, color, fontSize: `${Math.max(10, Number(element.metadata?.fontSize || 18))}px` }} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }}>{element.label || 'Callout'}</button>;
  }
  return <button type="button" aria-label={`${element.label} markup`} className={`markup-shape markup-shape--${element.type} ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, height: `${boxHeight}%`, borderColor: color, borderWidth: `${strokeWidth}px`, backgroundColor: `${color}18` }} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} />;
}

const MarkupElement = React.memo(MarkupElementBase, (prev, next) => (
  prev.element === next.element
  && prev.orientation === next.orientation
  && prev.selected === next.selected
  && prev.editingId === next.editingId
  && prev.dimensions === next.dimensions
  && prev.pointsPerPixel === next.pointsPerPixel
  && prev.scalePaperInches === next.scalePaperInches
  && prev.scaleRealFeet === next.scaleRealFeet
));

function DeviceElementBase({ element, orientation, selected, isNestTarget, onPointerDown, onSelect }) {
  const point = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const size = Number(element.metadata?.size || element.size || 42);
  const rotation = Number(element.rotation || 0) + Number(orientation || 0);
  const color = elementColor(element);
  const outlineColor = doorOutlineColorFor(element.metadata?.doorFunction || element.type);
  const nestedComponents = Array.isArray(element.metadata?.components) ? element.metadata.components : [];
  const doorComponents = Array.isArray(element.metadata?.doorComponents) ? element.metadata.doorComponents : [];
  const componentCount = nestedComponents.length + doorComponents.length;
  const workflow = workflowStatusFor(element);

  return (
    <button
      type="button"
      data-element-id={element.id}
      className={`plan-element ${selected ? 'selected' : ''} ${isNestTarget ? 'nest-target' : ''}`}
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

      {componentCount > 0 && (
        <span className="plan-element__components" aria-label={`${componentCount} component${componentCount === 1 ? '' : 's'}`} title={[...nestedComponents.map((c) => c.label), ...doorComponents].join(', ')}>
          {componentCount}
        </span>
      )}

      <span className="plan-element__label" style={element.metadata?.labelWidth ? { maxWidth: `${element.metadata.labelWidth}px` } : undefined}>{element.label}</span>
      <span
        className="plan-element__status"
        style={{ '--status-color': workflow.color }}
        title={`Installation status: ${workflow.label}`}
        aria-label={`Installation status: ${workflow.label}`}
      />
    </button>
  );
}

const DeviceElement = React.memo(DeviceElementBase, (prev, next) => (
  prev.element === next.element
  && prev.orientation === next.orientation
  && prev.selected === next.selected
  && prev.isNestTarget === next.isNestTarget
));

function CameraFieldOfView({ element, orientation, selectedFov, onSelectFov, onFovHandleDown, canEdit }) {
  if (!isCameraType(element.type)) return null;
  const origin = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const fovs = cameraFieldsFor(element);
  return (
    <>
      <svg className="camera-fov" viewBox="0 0 100 100" preserveAspectRatio="none">
        {fovs.map((fov, index) => {
          const length = Math.max(0.03, Math.min(0.75, Number(fov.length ?? 0.22)));
          const spread = Math.max(5, Math.min(180, Number(fov.spread ?? 60)));
          const direction = (Number(fov.rotation || 0) + Number(orientation || 0) - 90) * Math.PI / 180;
          const halfSpread = spread * Math.PI / 360;
          const left = { x: origin.x + Math.cos(direction - halfSpread) * length, y: origin.y + Math.sin(direction - halfSpread) * length };
          const right = { x: origin.x + Math.cos(direction + halfSpread) * length, y: origin.y + Math.sin(direction + halfSpread) * length };
          const color = /^#[0-9a-f]{6}$/i.test(fov.color || '') ? fov.color : elementColor(element);
          const isSelected = selectedFov?.elementId === element.id && selectedFov?.fovIndex === index;
          return (
            <polygon
              key={fov.id || index}
              points={`${origin.x * 100},${origin.y * 100} ${left.x * 100},${left.y * 100} ${right.x * 100},${right.y * 100}`}
              fill={color}
              stroke={isSelected ? 'white' : color}
              strokeWidth={isSelected ? 0.6 : 0}
              className={`camera-fov__cone ${isSelected ? 'selected' : ''}`}
              onPointerDown={(event) => { if (!canEdit) return; event.stopPropagation(); onSelectFov(element.id, index); }}
            />
          );
        })}
      </svg>
      {selectedFov?.elementId === element.id && fovs[selectedFov.fovIndex] && canEdit && (() => {
        const index = selectedFov.fovIndex;
        const fov = fovs[index];
        const length = Math.max(0.03, Math.min(0.75, Number(fov.length ?? 0.22)));
        const spread = Math.max(5, Math.min(180, Number(fov.spread ?? 60)));
        const direction = (Number(fov.rotation || 0) + Number(orientation || 0) - 90) * Math.PI / 180;
        const halfSpread = spread * Math.PI / 360;
        const left = { x: origin.x + Math.cos(direction - halfSpread) * length, y: origin.y + Math.sin(direction - halfSpread) * length };
        const right = { x: origin.x + Math.cos(direction + halfSpread) * length, y: origin.y + Math.sin(direction + halfSpread) * length };
        const tip = { x: origin.x + Math.cos(direction) * length, y: origin.y + Math.sin(direction) * length };
        return (
          <div className="fov-handles" aria-label={`Adjust ${element.label} field of view`}>
            <button type="button" className="fov-handle fov-handle--spread fov-handle--left" style={{ left: `${left.x * 100}%`, top: `${left.y * 100}%` }} onPointerDown={(event) => onFovHandleDown(event, element, index, 'left')} aria-label="Adjust field of view spread" />
            <button type="button" className="fov-handle fov-handle--spread fov-handle--right" style={{ left: `${right.x * 100}%`, top: `${right.y * 100}%` }} onPointerDown={(event) => onFovHandleDown(event, element, index, 'right')} aria-label="Adjust field of view spread" />
            <button type="button" className="fov-handle fov-handle--tip" style={{ left: `${tip.x * 100}%`, top: `${tip.y * 100}%` }} onPointerDown={(event) => onFovHandleDown(event, element, index, 'tip')} aria-label="Adjust field of view direction and length" />
          </div>
        );
      })()}
    </>
  );
}

function MarkupPopup({ element, orientation, onPreview, onCommit, onClose }) {
  const [draft, setDraft] = useState(null);
  const [anchor, setAnchor] = useState(null);
  useEffect(() => {
    if (!element) { setDraft(null); setAnchor(null); return; }
    setDraft({
      label: element.label || '', color: elementColor(element), x: Number(element.x), y: Number(element.y),
      width: Number(element.width), height: Number(element.height), metadata: element.metadata || {},
    });
    const start = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
    const end = toDisplay({ x: Number(element.x) + Number(element.width), y: Number(element.y) + Number(element.height) }, orientation);
    setAnchor({
      x: Math.max(0.18, Math.min(0.82, (start.x + end.x) / 2)),
      y: Math.max(0.08, Math.min(0.88, Math.max(start.y, end.y) + 0.045)),
    });
  }, [element?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!element || element.category !== 'markup') return null;
  if (!draft || !anchor) return null;
  const metadata = draft.metadata || {};
  const length = Math.max(0.01, Math.min(0.8, Math.hypot(Number(draft.width), Number(draft.height))));
  const patchLength = (next) => {
    const angle = Math.atan2(Number(draft.height), Number(draft.width));
    const values = { width: Math.cos(angle) * next, height: Math.sin(angle) * next };
    setDraft((current) => ({ ...current, ...values }));
    onPreview(element.id, values);
  };
  const preview = (values) => { setDraft((current) => ({ ...current, ...values })); onPreview(element.id, values); };
  const previewMetadata = (values) => { const next = { ...metadata, ...values }; setDraft((current) => ({ ...current, metadata: next })); onPreview(element.id, { metadata: next }); };
  return <div className="markup-popup" role="dialog" aria-label={`${element.type} formatting`} style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} onPointerDown={(event) => event.stopPropagation()}>
    <header className="markup-popup__header"><div><strong>Edit {element.type}</strong><small>{element.type === 'text' ? 'Type directly in the text box on the plan' : 'Changes save when you finish a field'}</small></div><button type="button" className="markup-popup__close" onClick={onClose} aria-label="Close formatting controls">×</button></header>
    <div className="markup-popup__grid">
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
  const points = ['line', 'arrow', 'measure'].includes(element.type)
    ? [['start', start.x, start.y], ['end', end.x, end.y]]
    : [['nw', Math.min(start.x, end.x), Math.min(start.y, end.y)], ['ne', Math.max(start.x, end.x), Math.min(start.y, end.y)], ['sw', Math.min(start.x, end.x), Math.max(start.y, end.y)], ['se', Math.max(start.x, end.x), Math.max(start.y, end.y)]];
  return <div className="resize-handles" aria-label={`Resize ${element.label}`}>{points.map(([handle, x, y]) => <button key={handle} type="button" className={`resize-handle resize-handle--${handle}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onPointerDown={(event) => onStart(event, element, handle)} aria-label={`Resize ${element.label} from ${handle}`} />)}</div>;
}

function LabelResizeHandles({ element, orientation, dimensions, onStart }) {
  if (!element || element.category === 'markup') return null;
  const center = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const size = Number(element.metadata?.size || 42);
  const labelWidth = Number(element.metadata?.labelWidth || 150);
  const labelHalfWidthPct = (labelWidth / 2) / dimensions.width;
  const labelY = center.y + ((size / 2 + 16) / dimensions.height);
  const leftX = center.x - labelHalfWidthPct;
  const rightX = center.x + labelHalfWidthPct;
  return (
    <div className="label-resize-handles" aria-label={`Resize ${element.label || 'device'} name box`}>
      <button type="button" className="label-resize-handle label-resize-handle--left" style={{ left: `${leftX * 100}%`, top: `${labelY * 100}%` }} onPointerDown={(event) => onStart(event, element, 'left')} aria-label="Resize name box width" />
      <button type="button" className="label-resize-handle label-resize-handle--right" style={{ left: `${rightX * 100}%`, top: `${labelY * 100}%` }} onPointerDown={(event) => onStart(event, element, 'right')} aria-label="Resize name box width" />
    </div>
  );
}

export default function PdfPlan({ survey, orientation, pageNumber, onPageInfo, zoom, onZoom, elements, visibleLayers, selectedId, activeTool, canEdit, onPlace, onDropComponent, onNestOnto, onDraw, onPreviewElement, onPatchElement, onResizeElement, onSelect, onMove, onDeleteSelected, notify, stageRef, scalePaperInches, scaleRealFeet }) {
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  const drawRef = useRef(null);
  const scrollRef = useRef(null);
  const resizeRef = useRef(null);
  const labelResizeRef = useRef(null);
  const fovDragRef = useRef(null);
  const [selectedFov, setSelectedFov] = useState(null);
  const draftFrameRef = useRef(null);
  const draftPointRef = useRef(null);
  const lastTapRef = useRef({ id: null, at: 0, x: 0, y: 0 });
  const panRef = useRef(null);
  const tapActionRef = useRef(null);
  const touchPointersRef = useRef(new Map());
  const consumedTouchRef = useRef(new Set());
  const pinchRef = useRef(null);
  const pinchFrameRef = useRef(null);
  const pinchAnchorFrameRef = useRef(null);
  const pinchUpdateRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1180, height: 840 });
  const [pointsPerPixel, setPointsPerPixel] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [draftShape, setDraftShape] = useState(null);
  const [nestTargetId, setNestTargetId] = useState(null);
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
          setPointsPerPixel(Math.max(base.width, base.height) / Math.max(viewport.width, viewport.height));
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

  const measureLabel = (start, end) => {
    const pixelDx = (end.x - start.x) * dimensions.width;
    const pixelDy = (end.y - start.y) * dimensions.height;
    const pixelDistance = Math.hypot(pixelDx, pixelDy);
    const paperInches = pixelDistance * (pointsPerPixel / 72);
    const paperRatio = Number(scalePaperInches) > 0 ? Number(scalePaperInches) : 1;
    const realFeetPerPaperInch = (Number(scaleRealFeet) || 0) / paperRatio;
    const realFeet = paperInches * realFeetPerPaperInch;
    const feet = Math.floor(realFeet);
    let inches = Math.round((realFeet - feet) * 12);
    let wholeFeet = feet;
    if (inches >= 12) { wholeFeet += 1; inches = 0; }
    return { distanceFeet: realFeet, label: `${wholeFeet}'-${inches}"` };
  };

  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  const captureFloorPlanImage = async () => {
    const background = canvasRef.current;
    if (!background || !background.width || !background.height) return null;
    const output = document.createElement('canvas');
    output.width = background.width;
    output.height = background.height;
    const ctx = output.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(background, 0, 0);

    const W = output.width;
    const H = output.height;
    const visible = elements.filter((element) => visibleLayers.has(element.category === 'markup' ? 'markup' : element.category));

    // Camera fields of view drawn first, underneath devices, matching on-screen layering.
    for (const element of visible) {
      if (element.category === 'markup' || !isCameraType(element.type)) continue;
      const origin = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
      const fovs = cameraFieldsFor(element);
      for (const fov of fovs) {
        const length = Math.max(0.03, Math.min(0.75, Number(fov.length ?? 0.22)));
        const spread = Math.max(5, Math.min(180, Number(fov.spread ?? 60)));
        const direction = (Number(fov.rotation || 0) + Number(orientation || 0) - 90) * Math.PI / 180;
        const halfSpread = (spread * Math.PI) / 360;
        const color = /^#[0-9a-f]{6}$/i.test(fov.color || '') ? fov.color : elementColor(element);
        const ox = origin.x * W; const oy = origin.y * H;
        const lx = (origin.x + Math.cos(direction - halfSpread) * length) * W;
        const ly = (origin.y + Math.sin(direction - halfSpread) * length) * H;
        const rx = (origin.x + Math.cos(direction + halfSpread) * length) * W;
        const ry = (origin.y + Math.sin(direction + halfSpread) * length) * H;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.closePath();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Markup: lines, arrows, measurements, shapes, text.
    for (const element of visible) {
      if (element.category !== 'markup') continue;
      const x = Number(element.x ?? 0.5); const y = Number(element.y ?? 0.5);
      const width = Number(element.width ?? 0.12); const height = Number(element.height ?? 0.08);
      const start = toDisplay({ x, y }, orientation);
      const end = toDisplay({ x: x + width, y: y + height }, orientation);
      const color = elementColor(element);
      const strokeWidth = Math.max(1, Math.min(20, Number(element.metadata?.strokeWidth || 3)));

      if (element.type === 'line' || element.type === 'arrow' || element.type === 'measure') {
        const sx = start.x * W; const sy = start.y * H; const ex = end.x * W; const ey = end.y * H;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        if (element.type === 'measure') ctx.setLineDash([8, 6]);
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        if (element.type === 'arrow') {
          const angle = Math.atan2(ey - sy, ex - sx);
          const headLength = 8 + strokeWidth * 2;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - headLength * Math.cos(angle - Math.PI / 6), ey - headLength * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(ex - headLength * Math.cos(angle + Math.PI / 6), ey - headLength * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }
        if (element.type === 'measure') {
          const label = measureLabel(start, end).label;
          const midX = (sx + ex) / 2; const midY = (sy + ey) / 2;
          ctx.font = '600 13px Inter, sans-serif';
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = color;
          const pillX = midX - textWidth / 2 - 8; const pillY = midY - 12; const pillW = textWidth + 16; const pillH = 24; const pillR = 12;
          ctx.beginPath();
          ctx.moveTo(pillX + pillR, pillY);
          ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, pillR);
          ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, pillR);
          ctx.arcTo(pillX, pillY + pillH, pillX, pillY, pillR);
          ctx.arcTo(pillX, pillY, pillX + pillW, pillY, pillR);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, midX, midY + 1);
        }
        continue;
      }

      const left = Math.min(start.x, end.x) * W; const top = Math.min(start.y, end.y) * H;
      const boxW = Math.abs(end.x - start.x) * W; const boxH = Math.abs(end.y - start.y) * H;

      const wrapText = (text, x, startY, maxWidth, lineHeight) => {
        let lineY = startY;
        for (const paragraph of text.split('\n')) {
          const words = paragraph.split(/\s+/).filter(Boolean);
          if (!words.length) { lineY += lineHeight; continue; }
          let line = '';
          for (const word of words) {
            const testLine = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(testLine).width > maxWidth) {
              ctx.fillText(line, x, lineY);
              line = word;
              lineY += lineHeight;
            } else {
              line = testLine;
            }
          }
          if (line) { ctx.fillText(line, x, lineY); lineY += lineHeight; }
        }
        return lineY;
      };

      if (element.type === 'text') {
        const fontSize = Math.max(10, Number(element.metadata?.fontSize || 18));
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        wrapText(element.label || 'Callout', left, top, Math.max(30, boxW), fontSize * 1.3);
        continue;
      }

      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = color;
      ctx.fillStyle = `${color}18`;
      if (element.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(left + boxW / 2, top + boxH / 2, Math.max(1, boxW / 2), Math.max(1, boxH / 2), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (element.type === 'cloud') {
        const radius = Math.max(4, Math.min(boxW, boxH) * 0.3);
        ctx.beginPath();
        ctx.moveTo(left + radius, top);
        ctx.arcTo(left + boxW, top, left + boxW, top + boxH, radius);
        ctx.arcTo(left + boxW, top + boxH, left, top + boxH, radius);
        ctx.arcTo(left, top + boxH, left, top, radius);
        ctx.arcTo(left, top, left + boxW, top, radius);
        ctx.closePath();
        ctx.setLineDash([strokeWidth * 2.2, strokeWidth * 1.6]);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath();
        ctx.rect(left, top, boxW, boxH);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Devices drawn on top, matching on-screen layering.
    for (const element of visible) {
      if (element.category === 'markup') continue;
      const point = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
      const size = Number(element.metadata?.size || element.size || 42);
      const rotation = (Number(element.rotation || 0) + Number(orientation || 0)) * Math.PI / 180;
      const color = elementColor(element);
      const outlineColor = doorOutlineColorFor(element.metadata?.doorFunction || element.type);
      const cx = point.x * W; const cy = point.y * H; const radius = size / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = outlineColor;
      ctx.stroke();

      const iconSrc = itemFor(element.category, element.type)?.reportIcon;
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      if (iconSrc) {
        const img = await loadImage(iconSrc);
        if (img) {
          const iconSize = radius * 1.3;
          ctx.drawImage(img, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
        }
      } else {
        ctx.fillStyle = color;
        ctx.font = `700 ${Math.max(9, radius * 0.55)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(elementSymbol(element), 0, 0);
      }
      ctx.restore();

      const workflow = workflowStatusFor(element);
      ctx.beginPath();
      ctx.arc(cx + radius * 0.72, cy + radius * 0.72, radius * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = workflow.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      if (element.label) {
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillStyle = '#1c272e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const maxLabelWidth = 150;
        const words = element.label.split(/\s+/).filter(Boolean);
        const lines = [];
        let currentLine = '';
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (currentLine && ctx.measureText(testLine).width > maxLabelWidth) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) lines.push(currentLine);
        lines.forEach((line, index) => ctx.fillText(line, cx, cy + radius + 6 + index * 13));
      }
    }

    return output.toDataURL('image/png');
  };

  useEffect(() => {
    if (stageRef?.current) stageRef.current.captureFloorPlanImage = captureFloorPlanImage;
  });

  const findNestTarget = (draggedElement, x, y) => {
    if (!draggedElement || draggedElement.category === 'markup') return null;
    return elements.find((item) => {
      if (item.id === draggedElement.id || item.category === 'markup') return false;
      const targetSize = Number(item.metadata?.size || item.size || 42);
      const dxPx = (Number(item.x) - x) * dimensions.width;
      const dyPx = (Number(item.y) - y) * dimensions.height;
      return Math.hypot(dxPx, dyPx) < targetSize / 2 + 8;
    }) || null;
  };

  const pointerDownSurface = (event) => {
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) return;
    if (activeTool.type === 'select' && event.button === 0) {
      const scroll = scrollRef.current;
      const selectionCleared = event.pointerType !== 'touch';
      if (selectionCleared) { onSelect(null); setEditingId(null); setSelectedFov(null); }
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
    if (['line', 'arrow', 'rectangle', 'ellipse', 'measure', 'cloud'].includes(activeTool.type)) {
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
    const previousTap = lastTapRef.current;
    const isRepeatTap = previousTap.id === element.id
      && now - previousTap.at < 450
      && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < 12;
    lastTapRef.current = { id: element.id, at: now, x: event.clientX, y: event.clientY };
    if (isRepeatTap && element.category === 'markup') {
      event.preventDefault();
      dragRef.current = null;
      onSelect(element.id);
      setEditingId(element.id);
      return;
    }
    setEditingId(null);
    onSelect(element.id);
    setSelectedFov((current) => current?.elementId === element.id ? current : null);
    if (!canEdit || activeTool.type !== 'select') return;
    const point = fromDisplay(surfacePoint(event), orientation);
    dragRef.current = { id: element.id, pointerId: event.pointerId, dx: point.x - Number(element.x), dy: point.y - Number(element.y), originX: Number(element.x), originY: Number(element.y), startClientX: event.clientX, startClientY: event.clientY, moved: false };
    surfaceRef.current.setPointerCapture(event.pointerId);
  };

  const startFovDrag = (event, element, fovIndex, handle) => {
    event.preventDefault();
    event.stopPropagation();
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) return;
    onSelect(element.id);
    setSelectedFov({ elementId: element.id, fovIndex });
    const fovs = cameraFieldsFor(element);
    const fov = fovs[fovIndex];
    if (!fov) return;
    const direction = (Number(fov.rotation || 0) + Number(orientation || 0) - 90) * Math.PI / 180;
    fovDragRef.current = { elementId: element.id, fovIndex, handle, pointerId: event.pointerId, direction, isMultisensor: element.type === 'multisensor_camera' };
    surfaceRef.current.setPointerCapture(event.pointerId);
  };

  const commitFov = (elementId, fovIndex, patch, isMultisensor, live) => {
    const element = elements.find((item) => item.id === elementId);
    if (!element) return;
    const metadata = element.metadata || {};
    const apply = live ? onPreviewElement : onPatchElement;
    if (isMultisensor) {
      const fovs = cameraFieldsFor(element);
      const nextFovs = fovs.map((item, index) => index === fovIndex ? { ...item, ...patch } : item);
      apply(elementId, { metadata: { ...metadata, fovs: nextFovs } });
    } else {
      const fieldMap = { rotation: 'fovRotation', spread: 'fovSpread', length: 'fovLength' };
      const metaPatch = {};
      for (const [key, value] of Object.entries(patch)) metaPatch[fieldMap[key]] = value;
      apply(elementId, { metadata: { ...metadata, ...metaPatch } });
    }
  };


  const startResize = (event, element, handle) => {
    event.preventDefault();
    event.stopPropagation();
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) return;
    onSelect(element.id);
    resizeRef.current = { id: element.id, pointerId: event.pointerId, handle, element };
    surfaceRef.current.setPointerCapture(event.pointerId);
  };

  const startLabelResize = (event, element) => {
    event.preventDefault();
    event.stopPropagation();
    if (pinchRef.current || consumedTouchRef.current.has(event.pointerId)) return;
    onSelect(element.id);
    labelResizeRef.current = { id: element.id, pointerId: event.pointerId, element };
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
      const finalX = Math.max(0, Math.min(1, point.x - dragRef.current.dx));
      const finalY = Math.max(0, Math.min(1, point.y - dragRef.current.dy));
      if (onNestOnto) {
        const draggedElement = elements.find((item) => item.id === dragRef.current.id);
        const target = findNestTarget(draggedElement, finalX, finalY);
        setNestTargetId(target?.id || null);
      }
      onMove(dragRef.current.id, finalX, finalY, false);
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
    if (labelResizeRef.current?.pointerId === event.pointerId) {
      const { element } = labelResizeRef.current;
      const center = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
      const displayPoint = surfacePoint(event);
      const centerPx = center.x * dimensions.width;
      const pointPx = displayPoint.x * dimensions.width;
      const newWidth = Math.max(60, Math.min(400, Math.abs(pointPx - centerPx) * 2));
      const values = { metadata: { ...(element.metadata || {}), labelWidth: Math.round(newWidth) } };
      labelResizeRef.current.values = values;
      onResizeElement(element.id, values, false);
    }
    if (fovDragRef.current?.pointerId === event.pointerId) {
      const { elementId, fovIndex, handle, direction, isMultisensor } = fovDragRef.current;
      const element = elements.find((item) => item.id === elementId);
      if (element) {
        const origin = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
        const point = surfacePoint(event);
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        if (handle === 'tip') {
          const length = Math.max(0.05, Math.min(0.75, Math.hypot(dx, dy)));
          const angle = Math.atan2(dy, dx);
          let rotation = (angle * 180 / Math.PI) - Number(orientation || 0) + 90;
          rotation = ((rotation % 360) + 360) % 360;
          commitFov(elementId, fovIndex, { rotation: Math.round(rotation), length: Number(length.toFixed(3)) }, isMultisensor, true);
        } else {
          const angleToHandle = Math.atan2(dy, dx);
          let delta = angleToHandle - direction;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          const spread = Math.max(5, Math.min(180, Math.abs(delta) * 2 * 180 / Math.PI));
          commitFov(elementId, fovIndex, { spread: Math.round(spread) }, isMultisensor, true);
        }
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
        if (cancelled) {
          onMove(dragRef.current.id, dragRef.current.originX, dragRef.current.originY, false);
        } else {
          const point = fromDisplay(surfacePoint(event), orientation);
          const finalX = Math.max(0, Math.min(1, point.x - dragRef.current.dx));
          const finalY = Math.max(0, Math.min(1, point.y - dragRef.current.dy));
          const draggedElement = elements.find((item) => item.id === dragRef.current.id);
          const target = onNestOnto ? findNestTarget(draggedElement, finalX, finalY) : null;
          if (target) onNestOnto(draggedElement.id, target.id);
          else onMove(dragRef.current.id, finalX, finalY, true);
        }
      }
      dragRef.current = null;
      setNestTargetId(null);
    }
    if (resizeRef.current?.pointerId === event.pointerId) {
      const { id, values, element } = resizeRef.current;
      if (values && cancelled) onResizeElement(id, { x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height), metadata: element.metadata || {} }, false);
      else if (values) onResizeElement(id, values, true);
      resizeRef.current = null;
    }
    if (labelResizeRef.current?.pointerId === event.pointerId) {
      const { id, values, element } = labelResizeRef.current;
      if (values && cancelled) onResizeElement(id, { metadata: element.metadata || {} }, false);
      else if (values) onResizeElement(id, values, true);
      labelResizeRef.current = null;
    }
    if (fovDragRef.current?.pointerId === event.pointerId) {
      const { elementId, fovIndex, isMultisensor } = fovDragRef.current;
      const element = elements.find((item) => item.id === elementId);
      fovDragRef.current = null;
      if (element && !cancelled) {
        const fov = cameraFieldsFor(element)[fovIndex];
        if (fov) commitFov(elementId, fovIndex, { rotation: Number(fov.rotation || 0), spread: Number(fov.spread || 60), length: Number(fov.length || 0.22) }, isMultisensor, false);
      }
    }
  };

  const keyDown = (event) => {
    if (!selectedId || !canEdit) return;
    const targetTag = event.target?.tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable) return;
    if (event.key === 'Delete') {
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
        <div ref={stageRef} className={`plan-stage tool-${['device', 'profile'].includes(activeTool.kind) ? activeTool.kind : activeTool.type} ${panning ? 'is-panning' : ''} ${pinching ? 'is-pinching' : ''}`} style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${zoom})` }}>
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
              ? <MarkupElement key={element.id} element={element} orientation={orientation} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} onEdit={setEditingId} editingId={editingId} onPreview={onPreviewElement} onCommit={onPatchElement} dimensions={dimensions} pointsPerPixel={pointsPerPixel} scalePaperInches={scalePaperInches} scaleRealFeet={scaleRealFeet} />
              : <React.Fragment key={element.id}>
                  <CameraFieldOfView element={element} orientation={orientation} selectedFov={selectedFov} onSelectFov={(elementId, fovIndex) => { onSelect(elementId); setSelectedFov({ elementId, fovIndex }); }} onFovHandleDown={startFovDrag} canEdit={canEdit} />
                  <DeviceElement element={element} orientation={orientation} selected={selectedId === element.id} isNestTarget={nestTargetId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} />
                </React.Fragment>)}
            {draftBounds && !['line', 'arrow', 'measure'].includes(draftShape.type) && <span className={`draft-shape draft-shape--${draftShape.type}`} style={{ left: `${draftBounds.left}%`, top: `${draftBounds.top}%`, width: `${draftBounds.width}%`, height: `${draftBounds.height}%` }} />}
            {draftShape && ['line', 'arrow', 'measure'].includes(draftShape.type) && <svg className="draft-line" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={draftShape.start.x * 100} y1={draftShape.start.y * 100} x2={draftShape.end.x * 100} y2={draftShape.end.y * 100} /></svg>}
            {draftShape && draftShape.type === 'measure' && <span className="measure-label" style={{ left: `${((draftShape.start.x + draftShape.end.x) / 2) * 100}%`, top: `${((draftShape.start.y + draftShape.end.y) / 2) * 100}%` }}>{measureLabel(draftShape.start, draftShape.end).label}</span>}
            {canEdit && <SelectionHandles element={elements.find((element) => element.id === selectedId)} orientation={orientation} dimensions={dimensions} onStart={startResize} />}
            {canEdit && <LabelResizeHandles element={elements.find((element) => element.id === selectedId)} orientation={orientation} dimensions={dimensions} onStart={startLabelResize} />}
            {canEdit && <MarkupPopup element={elements.find((element) => element.id === editingId)} orientation={orientation} onPreview={onPreviewElement} onCommit={onPatchElement} onClose={() => setEditingId(null)} />}
          </div>
          {rendering && <div className="plan-rendering" role="status">Rendering floor plan…</div>}
        </div>
      </div>
    </div>
  );
}
