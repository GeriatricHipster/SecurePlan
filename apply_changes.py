from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT
if (ROOT / "secureplan-app").exists():
    REPO_ROOT = ROOT
else:
    # If the bundle is placed inside the repo root, the script lives beside secureplan-app.
    REPO_ROOT = ROOT


def read_text(rel: str) -> str:
    path = REPO_ROOT / rel
    if not path.exists():
        raise FileNotFoundError(path)
    return path.read_text(encoding="utf-8")


def write_text(rel: str, text: str) -> None:
    path = REPO_ROOT / rel
    path.write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise ValueError(f"Could not find block for {label}")
    return text.replace(old, new, 1)


def regex_replace(text: str, pattern: str, replacement: str, label: str, flags: int = re.DOTALL) -> str:
    if not re.search(pattern, text, flags=flags):
        raise ValueError(f"Could not find pattern for {label}")
    return re.sub(pattern, replacement, text, count=1, flags=flags)


# -----------------------------------------------------------------------------
# deviceLibrary.js
# -----------------------------------------------------------------------------
path = "secureplan-app/src/components/deviceLibrary.js"
text = read_text(path)

old_markup_tools = """export const MARKUP_TOOLS = [
  { type: 'select', label: 'Select', symbol: '↖' },
  { type: 'line', label: 'Line', symbol: '╱' },
  { type: 'arrow', label: 'Arrow', symbol: '↗' },
  { type: 'rectangle', label: 'Rectangle', symbol: '□' },
  { type: 'ellipse', label: 'Ellipse', symbol: '○' },
  { type: 'text', label: 'Text callout', symbol: 'T' },
];"""
new_markup_tools = """export const MARKUP_TOOLS = [
  { type: 'select', label: 'Select', symbol: '↖' },
  { type: 'line', label: 'Line', symbol: '╱' },
  { type: 'measure', label: 'Measure', symbol: '↔' },
  { type: 'arrow', label: 'Arrow', symbol: '↗' },
  { type: 'rectangle', label: 'Rectangle', symbol: '□' },
  { type: 'ellipse', label: 'Ellipse', symbol: '○' },
  { type: 'text', label: 'Text callout', symbol: 'T' },
];"""
text = replace_once(text, old_markup_tools, new_markup_tools, "MARKUP_TOOLS")

append_helpers = """

export function measurementScaleForSurvey(survey) {
  const raw = survey?.measurementScale ?? survey?.metadata?.measurementScale ?? 1;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function measurementUnitsForSurvey(survey) {
  return survey?.measurementUnits ?? survey?.metadata?.measurementUnits ?? 'ft';
}

export function measurementLengthForElement(element, survey, dimensions) {
  if (!element) return '';
  const pxPerUnit = measurementScaleForSurvey(survey);
  const units = measurementUnitsForSurvey(survey);
  const width = Number(dimensions?.width || 1);
  const height = Number(dimensions?.height || 1);
  const dx = Number(element.width || 0) * width;
  const dy = Number(element.height || 0) * height;
  const pixels = Math.hypot(dx, dy);
  const length = pixels / pxPerUnit;
  if (!Number.isFinite(length)) return '';
  const precision = length < 10 ? 2 : 1;
  return `${length.toFixed(precision)} ${units}`;
}
"""
if "export function measurementScaleForSurvey" not in text:
    text = text.rstrip() + append_helpers + "\n"
write_text(path, text)

# -----------------------------------------------------------------------------
# App.jsx - rename Sites visible labels to Library
# -----------------------------------------------------------------------------
path = "secureplan-app/src/App.jsx"
text = read_text(path)
text = text.replace("sites: 'Sites'", "sites: 'Library'")
text = text.replace(">Sites</button>", ">Library</button>")
text = text.replace(">Sites<", ">Library<")
text = text.replace("onClick={() => navigate('sites')}>Sites</button>", "onClick={() => navigate('sites')}>Library</button>")
text = text.replace("onClick={() => navigate('sites')}><span aria-hidden=\"true\">▦</span>Sites</button>", "onClick={() => navigate('sites')}><span aria-hidden=\"true\">▦</span>Library</button>")
write_text(path, text)

# -----------------------------------------------------------------------------
# SitesDashboard.jsx - rename heading
# -----------------------------------------------------------------------------
path = "secureplan-app/src/components/SitesDashboard.jsx"
text = read_text(path)
text = text.replace("<p className=\"eyebrow\">Workspace</p>\n          <h1>Sites</h1>\n          <p>Organize buildings, plans, surveys, and field documentation.</p>",
                    "<p className=\"eyebrow\">Workspace</p>\n          <h1>Library</h1>\n          <p>Browse site folders and survey collections from one place.</p>")
write_text(path, text)

# -----------------------------------------------------------------------------
# SurveyEditor.jsx - fullscreen + scale modal + measurement tool
# -----------------------------------------------------------------------------
path = "secureplan-app/src/components/SurveyEditor.jsx"
text = read_text(path)

# Add state hooks
anchor = "  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);\n"
insert = """  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [scaleDraft, setScaleDraft] = useState({ measurementScale: 1, measurementUnits: 'ft' });
"""
text = replace_once(text, anchor, insert, "SurveyEditor state hooks")

# Add effects for fullscreen and survey scale sync after toast effect block.
old_toast_effect = """  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
"""
new_toast_effect = old_toast_effect + """
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!survey) return;
    setScaleDraft({
      measurementScale: Number(survey.measurementScale ?? survey.metadata?.measurementScale ?? 1) || 1,
      measurementUnits: survey.measurementUnits ?? survey.metadata?.measurementUnits ?? 'ft',
    });
  }, [survey?.id, survey?.measurementScale, survey?.measurementUnits, survey?.metadata?.measurementScale, survey?.metadata?.measurementUnits]);
"""
text = replace_once(text, old_toast_effect, new_toast_effect, "SurveyEditor fullscreen and scale effects")

# Add helper functions after touch()
old_touch = """  const touch = () => setSurvey((current) => ({ ...current, updatedAt: new Date().toISOString(), lastEditor: user, lastEditedBy: user }));

  const createOne = async (values) => {
"""
new_touch = """  const touch = () => setSurvey((current) => ({ ...current, updatedAt: new Date().toISOString(), lastEditor: user, lastEditedBy: user }));

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      notify(error.message);
    }
  };

  const openMeasurementScale = () => {
    setModal({ type: 'scale' });
  };

  const saveMeasurementScale = async () => {
    const measurementScale = Number(scaleDraft.measurementScale || 1) || 1;
    const measurementUnits = scaleDraft.measurementUnits || 'ft';
    try {
      const updated = await api.updateSurvey(surveyId, { measurementScale, measurementUnits });
      setSurvey((current) => ({ ...current, ...updated, measurementScale, measurementUnits }));
      setModal(null);
      touch();
      notify(`Measurement scale saved: ${measurementScale} px/${measurementUnits}`);
    } catch (error) {
      notify(error.message);
    }
  };

  const createOne = async (values) => {
"""
text = replace_once(text, old_touch, new_touch, "SurveyEditor helper functions")

# Replace draw function
old_draw = """  const draw = async ({ type, start, end }) => {
    let x = start.x; let y = start.y; let width = end.x - start.x; let height = end.y - start.y;
    if (!['line', 'arrow'].includes(type)) { x = Math.min(start.x, end.x); y = Math.min(start.y, end.y); width = Math.abs(end.x - start.x); height = Math.abs(end.y - start.y); }
    if (Math.abs(width) < 0.005 && Math.abs(height) < 0.005 && type !== 'text') return;
    try {
      await createOne({ category: 'markup', type, label: type === 'text' ? 'Callout' : type[0].toUpperCase() + type.slice(1), x, y, width: type === 'text' ? 0.14 : width, height: type === 'text' ? 0.05 : height, rotation: 0, color: '#b4232d', metadata: type === 'text' ? { fontSize: 18 } : {} });
      setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
    } catch (error) { notify(error.message); }
  };
"""
new_draw = """  const draw = async ({ type, start, end }) => {
    let x = start.x; let y = start.y; let width = end.x - start.x; let height = end.y - start.y;
    if (!['line', 'arrow', 'measure'].includes(type)) { x = Math.min(start.x, end.x); y = Math.min(start.y, end.y); width = Math.abs(end.x - start.x); height = Math.abs(end.y - start.y); }
    if (Math.abs(width) < 0.005 && Math.abs(height) < 0.005 && type !== 'text' && type !== 'measure') return;
    try {
      await createOne({
        category: 'markup',
        type,
        label: type === 'text' ? 'Callout' : type === 'measure' ? 'Measure' : type[0].toUpperCase() + type.slice(1),
        x,
        y,
        width: type === 'text' ? 0.14 : width,
        height: type === 'text' ? 0.05 : height,
        rotation: 0,
        color: type === 'measure' ? '#b4232d' : '#b4232d',
        metadata: type === 'text' ? { fontSize: 18 } : type === 'measure' ? { strokeWidth: 3, measurement: true } : {},
      });
      setActiveTool({ kind: 'markup', type: 'select', label: 'Select' });
    } catch (error) { notify(error.message); }
  };
"""
text = replace_once(text, old_draw, new_draw, "SurveyEditor draw function")

# Replace header actions block
old_header_actions = """        <div className="editor-actions">
          <button type="button" className="button button--ghost" onClick={rotate} disabled={!canEdit} title="Rotate survey clockwise"><span aria-hidden="true">↻</span><span className="button-label">Rotate {orientation}°</span></button>
          <button type="button" className="button button--secondary" onClick={() => setModal({ type: 'schedule' })}><span aria-hidden="true">☷</span><span className="button-label">Schedule</span></button>
          <button type="button" className="button button--secondary" onClick={toggleTheme} title="Toggle dark mode"><span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span className="button-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
          <button type="button" className="button button--secondary" onClick={exportPdf} disabled={pdfBusy} title="Export a PDF summary of plotted devices"><span aria-hidden="true">⬇</span><span className="button-label">{pdfBusy ? 'Exporting…' : 'Export PDF'}</span></button>
        </div>
"""
new_header_actions = """        <div className="editor-actions">
          <button type="button" className="button button--ghost" onClick={rotate} disabled={!canEdit} title="Rotate survey clockwise"><span aria-hidden="true">↻</span><span className="button-label">Rotate {orientation}°</span></button>
          <button type="button" className="button button--secondary" onClick={() => setModal({ type: 'schedule' })}><span aria-hidden="true">☷</span><span className="button-label">Schedule</span></button>
          <button type="button" className="button button--secondary" onClick={openMeasurementScale} title="Set blueprint scale used by the measurement tool"><span aria-hidden="true">尺</span><span className="button-label">Scale {Math.round(scaleDraft.measurementScale || 1)} px/{scaleDraft.measurementUnits || 'ft'}</span></button>
          <button type="button" className="button button--secondary" onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Open full screen'}><span aria-hidden="true">{isFullscreen ? '🡼' : '⛶'}</span><span className="button-label">{isFullscreen ? 'Exit full screen' : 'Full screen'}</span></button>
          <button type="button" className="button button--secondary" onClick={toggleTheme} title="Toggle dark mode"><span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span className="button-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
          <button type="button" className="button button--secondary" onClick={exportPdf} disabled={pdfBusy} title="Export a PDF summary of plotted devices"><span aria-hidden="true">⬇</span><span className="button-label">{pdfBusy ? 'Exporting…' : 'Export PDF'}</span></button>
        </div>
"""
text = replace_once(text, old_header_actions, new_header_actions, "SurveyEditor header actions")

# Add scale modal before ProfileBuilder modal
old_modal_anchor = """      <Modal open={modal?.type === 'schedule'} title="Device schedule" description={`${elements.filter((element) => element.category !== 'markup').length} plotted security components`} onClose={() => setModal(null)} wide><Schedule elements={elements} onSelect={setSelectedId} onClose={() => setModal(null)} /></Modal>
      <ProfileBuilder open={modal?.type === 'profile'} onClose={() => setModal(null)} onCreate={createProfile} />
"""
new_modal_anchor = """      <Modal open={modal?.type === 'schedule'} title="Device schedule" description={`${elements.filter((element) => element.category !== 'markup').length} plotted security components`} onClose={() => setModal(null)} wide><Schedule elements={elements} onSelect={setSelectedId} onClose={() => setModal(null)} /></Modal>
      <Modal open={modal?.type === 'scale'} title="Measurement scale" description="Set how many pixels equal one blueprint unit so the measurement tool can calculate lengths." onClose={() => setModal(null)}>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); saveMeasurementScale(); }}>
          <Field label="Pixels per unit">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={scaleDraft.measurementScale}
              onChange={(event) => setScaleDraft((current) => ({ ...current, measurementScale: event.target.value }))}
              autoFocus
            />
          </Field>
          <Field label="Units">
            <select
              value={scaleDraft.measurementUnits}
              onChange={(event) => setScaleDraft((current) => ({ ...current, measurementUnits: event.target.value }))}
            >
              <option value="ft">ft</option>
              <option value="m">m</option>
              <option value="in">in</option>
            </select>
          </Field>
          <div className="button-group">
            <button type="button" className="button button--secondary" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="button button--primary">Save scale</button>
          </div>
        </form>
      </Modal>
      <ProfileBuilder open={modal?.type === 'profile'} onClose={() => setModal(null)} onCreate={createProfile} />
"""
text = replace_once(text, old_modal_anchor, new_modal_anchor, "SurveyEditor scale modal")

# Add fullscreen state to render wrapper class maybe not required; but add class for CSS if fullscreen.
old_main_open = "<main id=\"main-content\" className=\"survey-editor\">"
new_main_open = "<main id=\"main-content\" className={`survey-editor ${isFullscreen ? 'survey-editor--fullscreen' : ''}`}>"
text = replace_once(text, old_main_open, new_main_open, "SurveyEditor main wrapper")

# update PdfPlan call to pass survey already present, no changes needed.
write_text(path, text)

# -----------------------------------------------------------------------------
# PdfPlan.jsx - measurement rendering + import
# -----------------------------------------------------------------------------
path = "secureplan-app/src/components/PdfPlan.jsx"
text = read_text(path)
text = text.replace(
    "import { cameraFieldsFor, doorOutlineColorFor, elementColor, elementSymbol, isCameraType, itemFor, workflowStatusFor } from './deviceLibrary.js';",
    "import { cameraFieldsFor, doorOutlineColorFor, elementColor, elementSymbol, isCameraType, itemFor, measurementLengthForElement, workflowStatusFor } from './deviceLibrary.js';",
)

# Insert measurement helper after getField
old_getfield_block = """function getField(element, camel, snake, fallback) {
  return element[camel] ?? element[snake] ?? fallback;
}
function hasPdf(survey) {
"""
new_getfield_block = """function getField(element, camel, snake, fallback) {
  return element[camel] ?? element[snake] ?? fallback;
}
function measurementLabel(element, survey, dimensions) {
  return measurementLengthForElement(element, survey, dimensions);
}
function hasPdf(survey) {
"""
text = replace_once(text, old_getfield_block, new_getfield_block, "PdfPlan measurement helper")

# Replace MarkupElement function block
old_markup_element = """function MarkupElement({ element, orientation, selected, onPointerDown, onSelect, onEdit }) {
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
"""
new_markup_element = """function MarkupElement({ element, survey, orientation, dimensions, selected, onPointerDown, onSelect, onEdit }) {
  const x = Number(getField(element, 'x', 'x', 0.5));
  const y = Number(getField(element, 'y', 'y', 0.5));
  const width = Number(getField(element, 'width', 'width', 0.12));
  const height = Number(getField(element, 'height', 'height', 0.08));
  const start = toDisplay({ x, y }, orientation);
  const end = toDisplay({ x: x + width, y: y + height }, orientation);
  const color = element.type === 'measure' ? '#b4232d' : elementColor(element);
  const strokeWidth = Math.max(1, Math.min(20, Number(element.metadata?.strokeWidth || 3)));
  const isLineLike = element.type === 'line' || element.type === 'arrow' || element.type === 'measure';
  if (isLineLike) {
    const markerId = `arrow-${String(element.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const midpointX = ((start.x + end.x) / 2) * 100;
    const midpointY = ((start.y + end.y) / 2) * 100;
    const measurement = element.type === 'measure' ? measurementLabel(element, survey, dimensions) : '';
    return (
      <svg className={`markup-line markup-line--${element.type} ${selected ? 'selected' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="button" tabIndex="0" aria-pressed={selected} aria-label={element.label} onPointerDown={(event) => onPointerDown(event, element)} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onDoubleClick={(event) => { event.stopPropagation(); onEdit(element.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); } }}>
        {element.type === 'arrow' && <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill={color} /></marker></defs>}
        <line className="markup-line__hit-area" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} vectorEffect="non-scaling-stroke" />
        <line className="markup-line__visible" x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" markerEnd={element.type === 'arrow' ? `url(#${markerId})` : undefined} />
        {element.type === 'measure' && measurement && (
          <text className="markup-line__label" x={midpointX} y={Math.max(4, midpointY - 3)} textAnchor="middle">{measurement}</text>
        )}
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
"""
text = replace_once(text, old_markup_element, new_markup_element, "PdfPlan MarkupElement")

# Update MarkupElement invocation in the map
text = text.replace(
    "? <MarkupElement key={element.id} element={element} orientation={orientation} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} onEdit={setEditingId} />",
    "? <MarkupElement key={element.id} element={element} survey={survey} orientation={orientation} dimensions={dimensions} selected={selectedId === element.id} onPointerDown={pointerDownElement} onSelect={onSelect} onEdit={setEditingId} />",
)

write_text(path, text)

# -----------------------------------------------------------------------------
# styles.css - measurement labels and fullscreen polish
# -----------------------------------------------------------------------------
path = "secureplan-app/src/styles.css"
text = read_text(path)
append_css = """

/* Measurement tool and full screen support */
.markup-line--measure .markup-line__visible {
  stroke: var(--red);
}

.markup-line__label {
  fill: var(--red);
  font: 700 3.2px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 0.8px;
  pointer-events: none;
}

.survey-editor--fullscreen {
  background: var(--page);
}

.survey-editor--fullscreen .editor-header {
  position: sticky;
  top: 0;
  z-index: 40;
}

.survey-editor--fullscreen .canvas-panel,
.survey-editor--fullscreen .editor-layout {
  min-height: calc(100vh - 72px);
}
"""
if "markup-line--measure" not in text:
    text = text.rstrip() + append_css + "\n"
write_text(path, text)

print("SecurePlan patch applied successfully.")
