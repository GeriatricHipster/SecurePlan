import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api.js';
import { elementColor, elementSymbol } from './deviceLibrary.js';

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

function MarkupElement({ element, orientation, selected, onPointerDown, onSelect }) {
  const x = Number(getField(element, 'x', 'x', 0.5));
  const y = Number(getField(element, 'y', 'y', 0.5));
  const width = Number(getField(element, 'width', 'width', 0.12));
  const height = Number(getField(element, 'height', 'height', 0.08));
  const start = toDisplay({ x, y }, orientation);
  const end = toDisplay({ x: x + width, y: y + height }, orientation);
  const color = elementColor(element);
  if (element.type === 'line' || element.type === 'arrow') {
    const markerId = `arrow-${String(element.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return (
      <svg className={`markup-line ${selected ? 'selected' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="button" tabIndex="0" aria-pressed={selected} aria-label={element.label} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); } }}>
        {element.type === 'arrow' && <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill={color} /></marker></defs>}
        <line className="markup-line__hit-area" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} vectorEffect="non-scaling-stroke" />
        <line className="markup-line__visible" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} stroke={color} strokeWidth={selected ? 1.2 : 0.7} vectorEffect="non-scaling-stroke" markerEnd={element.type === 'arrow' ? `url(#${markerId})` : undefined} />
      </svg>
    );
  }
  const left = Math.min(start.x, end.x) * 100;
  const top = Math.min(start.y, end.y) * 100;
  const boxWidth = Math.abs(end.x - start.x) * 100;
  const boxHeight = Math.abs(end.y - start.y) * 100;
  if (element.type === 'text') {
    return <button type="button" className={`markup-text ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, color, fontSize: `${Math.max(12, Number(element.metadata?.fontSize || 18))}px` }} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }}>{element.label || 'Callout'}</button>;
  }
  return <button type="button" aria-label={`${element.label} markup`} className={`markup-shape markup-shape--${element.type} ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, height: `${boxHeight}%`, borderColor: color, backgroundColor: `${color}18` }} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} />;
}

function DeviceElement({ element, orientation, selected, onPointerDown, onSelect }) {
  const point = toDisplay({ x: Number(element.x), y: Number(element.y) }, orientation);
  const size = Number(element.metadata?.size || element.size || 42);
  const rotation = Number(element.rotation || 0) + Number(orientation || 0);
  const color = elementColor(element);
  return (
    <button
      type="button"
      className={`plan-element ${selected ? 'selected' : ''}`}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, width: `${size}px`, height: `${size}px`, '--element-color': color, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
      onPointerDown={(event) => onPointerDown(event, element)}
      onClick={(event) => { event.stopPropagation(); onSelect(element.id); }}
      aria-label={`${element.label || element.type}${selected ? ', selected' : ''}`}
      aria-pressed={selected}
    >
      <span>{elementSymbol(element)}</span>
      {(Number(element.noteCount ?? element.note_count ?? 0) + Number(element.photoCount ?? element.photo_count ?? 0)) > 0 && <small aria-hidden="true">{Number(element.noteCount ?? element.note_count ?? 0) + Number(element.photoCount ?? element.photo_count ?? 0)}</small>}
    </button>
  );
}

export default function PdfPlan({ survey, orientation, pageNumber, onPageInfo, zoom, elements, visibleLayers, selectedId, activeTool, canEdit, onPlace, onDraw, onSelect, onMove, onDeleteSelected, notify }) {
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  const drawRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1180, height: 840 });
  const [rendering, setRendering] = useState(true);
  const [draftShape, setDraftShape] = useState(null);

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

  const pointerDownSurface = (event) => {
    if (!canEdit) { onSelect(null); return; }
    if (activeTool.kind === 'device' || activeTool.kind === 'profile') {
      onPlace(fromDisplay(surfacePoint(event), orientation));
      return;
    }
    if (['line', 'arrow', 'rectangle', 'ellipse'].includes(activeTool.type)) {
      const startDisplay = surfacePoint(event);
      drawRef.current = { pointerId: event.pointerId, startDisplay };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftShape({ type: activeTool.type, start: startDisplay, end: startDisplay });
      return;
    }
    if (activeTool.type === 'text') {
      onDraw({ type: 'text', start: fromDisplay(surfacePoint(event), orientation), end: fromDisplay({ x: Math.min(1, surfacePoint(event).x + 0.12), y: Math.min(1, surfacePoint(event).y + 0.05) }, orientation) });
      return;
    }
    onSelect(null);
  };

  const pointerDownElement = (event, element) => {
    event.stopPropagation();
    onSelect(element.id);
    if (!canEdit || activeTool.type !== 'select') return;
    const point = fromDisplay(surfacePoint(event), orientation);
    dragRef.current = { id: element.id, pointerId: event.pointerId, dx: point.x - Number(element.x), dy: point.y - Number(element.y), startClientX: event.clientX, startClientY: event.clientY, moved: false };
    surfaceRef.current.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event) => {
    if (drawRef.current?.pointerId === event.pointerId) {
      const end = surfacePoint(event);
      setDraftShape((current) => ({ ...current, end }));
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      if (!dragRef.current.moved && Math.hypot(event.clientX - dragRef.current.startClientX, event.clientY - dragRef.current.startClientY) < 3) return;
      const point = fromDisplay(surfacePoint(event), orientation);
      dragRef.current.moved = true;
      onMove(dragRef.current.id, Math.max(0, Math.min(1, point.x - dragRef.current.dx)), Math.max(0, Math.min(1, point.y - dragRef.current.dy)), false);
    }
  };

  const pointerUp = (event) => {
    if (drawRef.current?.pointerId === event.pointerId) {
      const start = fromDisplay(drawRef.current.startDisplay, orientation);
      const end = fromDisplay(surfacePoint(event), orientation);
      onDraw({ type: draftShape.type, start, end });
      drawRef.current = null;
      setDraftShape(null);
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      if (dragRef.current.moved) {
        const point = fromDisplay(surfacePoint(event), orientation);
        onMove(dragRef.current.id, Math.max(0, Math.min(1, point.x - dragRef.current.dx)), Math.max(0, Math.min(1, point.y - dragRef.current.dy)), true);
      }
      dragRef.current = null;
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
    <div className="plan-scroll" aria-label="Blueprint workspace">
      <div className="plan-zoom-space" style={{ width: dimensions.width * zoom, height: dimensions.height * zoom }}>
        <div className={`plan-stage tool-${['device', 'profile'].includes(activeTool.kind) ? activeTool.kind : activeTool.type}`} style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${zoom})` }}>
          <canvas ref={canvasRef} aria-label={`Floor plan page ${pageNumber}`} />
          <div
            ref={surfaceRef}
            className="plan-surface"
            tabIndex="0"
            role="region"
            aria-label="Interactive floor plan. Choose a component then click to place it. Selected elements can be moved with arrow keys."
            onPointerDown={pointerDownSurface}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onKeyDown={keyDown}
          >
            {elements.filter((element) => visibleLayers.has(element.category)).map((element) => element.category === 'markup'
              ? <MarkupElement key={element.id} element={element} orientation={orientation} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} />
              : <DeviceElement key={element.id} element={element} orientation={orientation} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} />)}
            {draftBounds && draftShape.type !== 'line' && draftShape.type !== 'arrow' && <span className={`draft-shape draft-shape--${draftShape.type}`} style={{ left: `${draftBounds.left}%`, top: `${draftBounds.top}%`, width: `${draftBounds.width}%`, height: `${draftBounds.height}%` }} />}
            {draftShape && (draftShape.type === 'line' || draftShape.type === 'arrow') && <svg className="draft-line" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={draftShape.start.x * 100} y1={draftShape.start.y * 100} x2={draftShape.end.x * 100} y2={draftShape.end.y * 100} /></svg>}
          </div>
          {rendering && <div className="plan-rendering" role="status">Rendering floor plan…</div>}
        </div>
      </div>
    </div>
  );
}
