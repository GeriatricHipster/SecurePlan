import React, { useEffect, useMemo, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { Spinner } from './Common.jsx';

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

export default function GanttChart({ surveyId, notify }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.tasks(surveyId).then((result) => {
      if (active) setTasks(normalizeList(result?.tasks ?? result));
    }).catch((error) => notify(error.message))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [surveyId, notify]);

  const chart = useMemo(() => {
    const withDeadline = tasks.filter((task) => parseDate(task.deadline));
    if (!withDeadline.length) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const starts = withDeadline.map((task) => parseDate(task.createdAt) || today);
    const ends = withDeadline.map((task) => parseDate(task.deadline));
    const earliest = new Date(Math.min(...starts.map((d) => d.getTime()), today.getTime()));
    const latest = new Date(Math.max(...ends.map((d) => d.getTime()), today.getTime()));
    const rangeStart = addDays(earliest, -2);
    const rangeEnd = addDays(latest, 2);
    const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));

    const rows = withDeadline
      .map((task) => {
        const start = parseDate(task.createdAt) || today;
        const end = parseDate(task.deadline);
        const clampedStart = start < rangeStart ? rangeStart : start;
        const offset = daysBetween(rangeStart, clampedStart);
        const span = Math.max(1, daysBetween(clampedStart, end));
        return { task, offset, span, overdue: end < today };
      })
      .sort((a, b) => a.offset + a.span - (b.offset + b.span));

    return { rows, rangeStart, rangeEnd, totalDays, todayOffset: daysBetween(rangeStart, today) };
  }, [tasks]);

  const undated = tasks.filter((task) => !parseDate(task.deadline));

  if (loading) return <div className="loading-panel"><Spinner label="Loading tasks…" /></div>;
  if (!chart) return <p className="muted">No tasks with deadlines yet. Add deadlines in the Tasks tab to see them plotted here.</p>;

  return (
    <div className="gantt-chart">
      <div className="gantt-chart__scale">
        <span>{chart.rangeStart.toLocaleDateString()}</span>
        <span>Today</span>
        <span>{chart.rangeEnd.toLocaleDateString()}</span>
      </div>
      <div className="gantt-chart__body">
        <div className="gantt-chart__today-line" style={{ left: `${(chart.todayOffset / chart.totalDays) * 100}%` }} />
        {chart.rows.map(({ task, offset, span, overdue }) => (
          <div key={task.id} className="gantt-row">
            <div className="gantt-row__label">
              <strong>{task.taskName}</strong>
              <small>{[task.assignedTo, task.vendor].filter(Boolean).join(' · ') || '\u2014'}</small>
            </div>
            <div className="gantt-row__track">
              <div
                className={`gantt-row__bar ${overdue ? 'gantt-row__bar--overdue' : ''}`}
                style={{ left: `${(offset / chart.totalDays) * 100}%`, width: `${(span / chart.totalDays) * 100}%` }}
                title={`${task.taskName} — due ${new Date(task.deadline).toLocaleDateString()}`}
              />
            </div>
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <p className="gantt-chart__undated">{undated.length} task{undated.length === 1 ? '' : 's'} without a deadline aren't shown here.</p>
      )}
    </div>
  );
}
