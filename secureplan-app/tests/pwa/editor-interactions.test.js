import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../../src/components/PdfPlan.jsx', import.meta.url);

test('every selected canvas item exposes resize handles and resize commits are separated from previews', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /function SelectionHandles/);
  assert.match(source, /element\.category !== 'markup'/);
  assert.match(source, /\['line', 'arrow'\]\.includes\(element\.type\)/);
  assert.match(source, /onResizeElement\(element\.id, values, false\)/);
  assert.match(source, /onResizeElement\(id, values, true\)/);
});

test('markup editing requires a double click and exposes text, color, size, thickness, length, and location controls', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /onDoubleClick=/);
  assert.match(source, /event\.detail >= 2/);
  assert.match(source, /autoFocus value=\{draft\.label/);
  for (const label of ['Color', 'Left / right', 'Up / down', 'Font size', 'Thickness', 'Length']) {
    assert.equal(source.includes(label), true, `missing ${label} control`);
  }
  assert.match(source, /element=\{elements\.find\(\(element\) => element\.id === editingId\)\}/);
  assert.match(source, /style=\{\{ left: `\$\{anchor\.x \* 100\}%`, top: `\$\{anchor\.y \* 100\}%` \}\}/);
});

test('typing and drawing avoid per-input network writes and unbounded pointer renders', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /onBlur=\{\(\) => draft\.label !== element\.label && onCommit/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /cancelAnimationFrame/);
  assert.doesNotMatch(source, /value=\{element\.label \|\| ''\} onChange=\{\(event\) => onPatch/);
});

test('mobile markup supports double tap and text renders without a dotted box', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const styles = await readFile(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /touchDoubleTap/);
  assert.match(source, /now - lastTapRef\.current\.at < 450/);
  const textRule = styles.match(/\.markup-text \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(textRule, /border: 0;/);
  assert.doesNotMatch(textRule, /dashed/);
});

test('select mode pans the blueprint with mouse or touch without moving plotted elements', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const styles = await readFile(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /panRef\.current = \{ pointerId: event\.pointerId/);
  assert.match(source, /scroll\.scrollLeft = panRef\.current\.scrollLeft - \(event\.clientX - panRef\.current\.startX\)/);
  assert.match(source, /scroll\.scrollTop = panRef\.current\.scrollTop - \(event\.clientY - panRef\.current\.startY\)/);
  assert.match(source, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/);
  assert.match(styles, /\.tool-select \.plan-surface \{[\s\S]*?cursor: grab;[\s\S]*?touch-action: none;/);
});

test('mobile users can pinch to zoom without committing an interrupted canvas action', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /onPointerDownCapture=\{pointerDownCapture\}/);
  assert.match(source, /touchPointersRef = useRef\(new Map\(\)\)/);
  assert.match(source, /zoomFromPinch\(pinchRef\.current\.startZoom/);
  assert.match(source, /pinchFrameRef\.current = requestAnimationFrame/);
  assert.match(source, /renderedAnchorX - latest\.midpoint\.x/);
  assert.match(source, /consumedTouchRef\.current\.has\(event\.pointerId\)/);
  assert.match(source, /cancelSinglePointerAction\(\)/);
  assert.match(source, /tapActionRef\.current = \{ pointerId: event\.pointerId, kind: 'place'/);
});

test('supplied raster device artwork follows the selected icon color', async () => {
  const glyphSource = await readFile(new URL('../../src/components/DeviceGlyph.jsx', import.meta.url), 'utf8');
  assert.match(glyphSource, /color = DEFAULT_ICON_COLOR/);
  assert.match(glyphSource, /<feColorMatrix in="SourceGraphic" type="saturate" values="0" result="gray" \/>/);
  assert.match(glyphSource, /<feFuncR type="linear"/);
  assert.match(glyphSource, /filter=\{`url\(#\$\{filterId\}\)`\}/);
});

test('door-function color and installation-status dot remain independent in the editor', async () => {
  const planSource = await readFile(sourceUrl, 'utf8');
  const editorSource = await readFile(new URL('../../src/components/SurveyEditor.jsx', import.meta.url), 'utf8');
  const deviceElement = planSource.match(/function DeviceElement[\s\S]*?\n\}/)?.[0] || '';
  const lifecyclePanel = editorSource.match(/function DeviceLifecyclePanel[\s\S]*?\n\}/)?.[0] || '';

  assert.match(deviceElement, /const color = elementColor\(element\)/);
  assert.match(deviceElement, /const workflow = workflowStatusFor\(element\)/);
  assert.match(deviceElement, /<DeviceGlyph[\s\S]*?color=\{color\}/);
  assert.match(deviceElement, /className="plan-element__status" style=\{\{ '--status-color': workflow\.color \}\}/);

  assert.match(lifecyclePanel, /onPatch\(\{ metadata: \{ \.\.\.metadata, workflowStatus \} \}\)/);
  assert.doesNotMatch(lifecyclePanel, /onPatch\(\{ color: workflow/);
  assert.match(editorSource, /onPatch\(\{ color: option\.color, metadata: \{ \.\.\.metadata, doorFunction: option\.id \} \}\)/);
  assert.match(editorSource, /form\.color !== elementColor\(element\) && onPatch\(\{ color: form\.color \}\)/);
});

test('click, drop, and profile placement routes all use centralized device defaults', async () => {
  const editorSource = await readFile(new URL('../../src/components/SurveyEditor.jsx', import.meta.url), 'utf8');
  const placementCalls = editorSource.match(/devicePlacementDefaults\(/g) || [];

  assert.equal(placementCalls.length, 4);
  assert.match(editorSource, /devicePlacementDefaults\(activeTool\.type, activeTool\.symbol, activeTool\.doorFunction \|\| doorFunction\)/);
  assert.match(editorSource, /devicePlacementDefaults\(payload\.type, payload\.symbol, payload\.doorFunction \|\| doorFunction\)/);
  assert.match(editorSource, /devicePlacementDefaults\(component\.type, symbol, component\.doorFunction \|\| doorFunction\)/);
  assert.match(editorSource, /devicePlacementDefaults\(component\.type, component\.symbol, component\.doorFunction \|\| doorFunction\)/);
});
