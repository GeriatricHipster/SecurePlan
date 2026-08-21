import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { Spinner } from './Common.jsx';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCw } from 'lucide-react';

const DAY_WIDTH_BASE = 60;
const ROW_HEIGHT = 52;
const VISIBLE_DAYS = 30;
const BAR_COLORS = ['#22c55e', '#3b82f6', '#ec4899', '#eab308', '#8b5cf6', '#f97316', '#14b8a6', '#f43f5e'];

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function daysBetween(a, b) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
}

function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
}

export default function GanttChart({ surveyId, notify }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [viewStart, setViewStart] = useState(() => addDays(startOfDay(new Date()), -3));
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.tasks(surveyId).then((result) => {
      if (active) setTasks(normalizeList(result?.tasks ?? result));
    }).catch((error) => notify(error.message)).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [surveyId, notify]);

  const dayWidth = Math.round(DAY_WIDTH_BASE * (zoom / 100));
  const days = useMemo(() => Array.from({ length: VISIBLE_DAYS }, (_, index) => addDays(viewStart, index)), [viewStart]);
  const today = useMemo(() => startOfDay(new Date()), []);

  const rows = useMemo(() => tasks.map((task, index) => {
    const start = parseDate(task.startDate) || parseDate(task.deadline);
    const end = parseDate(task.deadline) || parseDate(task.startDate);
    const hasDates = Boolean(start && end);
    const clampedStart = hasDates && start <= end ? start : end;
    const clampedEnd = hasDates && start <= end ? end : start;
    const span = hasDates ? Math.max(1, daysBetween(clampedStart, clampedEnd) + 1) : 0;
    const offset = hasDates ? daysBetween(viewStart, clampedStart) : 0;
    return {
      task,
      rowIndex: index,
      hasDates,
      offset,
      span,
      color: BAR_COLORS[index % BAR_COLORS.length],
    };
  }), [tasks, viewStart]);

  const rowByTaskId = useMemo(() => new Map(rows.map((row) => [row.task.id, row])), [rows]);

  const goToday = () => setViewStart(addDays(startOfDay(new Date()), -3));
  const prev30 = () => setViewStart((current) => addDays(current, -30));
  const next30 = () => setViewStart((current) => addDays(current, 30));
  const zoomIn = () => setZoom((current) => Math.min(300, current + 25));
  const zoomOut = () => setZoom((current) => Math.max(50, current - 25));
  const resetZoom = () => setZoom(100);

  if (loading) return <div className="loading-panel"><Spinner label="Loading tasks…" /></div>;

  const datedCount = rows.filter((row) => row.hasDates).length;
  const timelineWidth = VISIBLE_DAYS * dayWidth;
  const bodyHeight = Math.max(rows.length, 1) * ROW_HEIGHT;
  const todayOffset = daysBetween(viewStart, today);

  const arrows = [];
  rows.forEach((row) => {
    (row.task.predecessors || []).forEach((predecessor) => {
      const predRow = rowByTaskId.get(predecessor.id);
      if (!predRow || !predRow.hasDates || !row.hasDates) return;
      const fromX = (predRow.offset + predRow.span) * dayWidth;
      const fromY = predRow.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const toX = row.offset * dayWidth;
      const toY = row.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const midX = (fromX + toX) / 2;
      arrows.push({
        key: `${predecessor.id}-${row.task.id}`,
        path: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
      });
    });
  });

  return (
    <div className="gantt-v2">
      <div className="gantt-v2__toolbar">
        <button type="button" className="button button--ghost" onClick={goToday}>Today</button>
        <button type="button" className="button button--ghost" onClick={prev30}><ChevronLeft size={14} aria-hidden="true" /> Prev 30 days</button>
        <button type="button" className="button button--ghost" onClick={next30}>Next 30 days <ChevronRight size={14} aria-hidden="true" /></button>
        <span className="gantt-v2__spacer" />
        <button type="button" className="icon-button" onClick={zoomOut} aria-label="Zoom out" disabled={zoom <= 50}><Minus size={15} /></button>
        <span className="gantt-v2__zoom-label">{zoom}%</span>
        <button type="button" className="icon-button" onClick={zoomIn} aria-label="Zoom in" disabled={zoom >= 300}><Plus size={15} /></button>
        <button type="button" className="button button--ghost" onClick={resetZoom}><RotateCw size={13} aria-hidden="true" /> Reset zoom</button>
      </div>

      {!tasks.length ? (
        <p className="muted">No tasks yet. Add some on the Tasks tab.</p>
      ) : !datedCount ? (
        <p className="muted">No tasks have a start date or deadline yet. Set dates on the Tasks tab to see them plotted here.</p>
      ) : (
        <div className="gantt-v2__panes">
          <div className="gantt-v2__labels">
            <div className="gantt-v2__labels-header" />
            {rows.map((row) => (
              <button
                type="button"
                key={row.task.id}
                className={`gantt-v2__label-row ${selectedTaskId === row.task.id ? 'gantt-v2__label-row--selected' : ''}`}
                style={{ height: ROW_HEIGHT }}
                onClick={() => setSelectedTaskId((current) => current === row.task.id ? null : row.task.id)}
              >
                <span className="gantt-v2__label-dot" style={{ background: row.color }} />
                <span className="gantt-v2__label-text">
                  <strong>{row.task.taskName}</strong>
                  <small>{row.task.vendor || row.task.assignedTo || '\u2014'}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="gantt-v2__scroll" ref={scrollRef}>
            <div className="gantt-v2__timeline" style={{ width: timelineWidth }}>
              <div className="gantt-v2__header">
                {days.map((day) => (
                  <div key={day.toISOString()} className={`gantt-v2__header-cell ${isSameDay(day, today) ? 'gantt-v2__header-cell--today' : ''}`} style={{ width: dayWidth }}>
                    <strong>{formatDayLabel(day)}</strong>
                    <span>{day.getFullYear()}</span>
                  </div>
                ))}
              </div>

              <div className="gantt-v2__body" style={{ height: bodyHeight }}>
                <div className="gantt-v2__gridlines">
                  {days.map((day) => <div key={day.toISOString()} className="gantt-v2__gridline" style={{ width: dayWidth }} />)}
                </div>

                {todayOffset >= 0 && todayOffset < VISIBLE_DAYS && (
                  <div className="gantt-v2__today-line" style={{ left: todayOffset * dayWidth }} />
                )}

                <svg className="gantt-v2__arrows" width={timelineWidth} height={bodyHeight}>
                  <defs>
                    <marker id="gantt-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" className="gantt-v2__arrow-head" />
                    </marker>
                  </defs>
                  {arrows.map((arrow) => <path key={arrow.key} d={arrow.path} className="gantt-v2__arrow-path" markerEnd="url(#gantt-arrowhead)" />)}
                </svg>

                {rows.map((row) => row.hasDates && (
                  <button
                    type="button"
                    key={row.task.id}
                    className={`gantt-v2__bar ${selectedTaskId === row.task.id ? 'gantt-v2__bar--selected' : ''}`}
                    style={{
                      top: row.rowIndex * ROW_HEIGHT + 8,
                      left: row.offset * dayWidth,
                      width: Math.max(dayWidth * row.span - 4, 6),
                      background: row.color,
                    }}
                    onClick={() => setSelectedTaskId((current) => current === row.task.id ? null : row.task.id)}
                    title={`${row.task.taskName}: ${row.task.startDate || '?'} to ${row.task.deadline || '?'}${row.task.vendor ? ` \u00b7 ${row.task.vendor}` : ''} \u00b7 ${row.task.progress ?? 0}% complete`}
                  >
                    <span className="gantt-v2__bar-progress" style={{ width: `${Math.max(0, Math.min(100, row.task.progress ?? 0))}%` }} />
                    <span className="gantt-v2__bar-label">{row.task.taskName}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
