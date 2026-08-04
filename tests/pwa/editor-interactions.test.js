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
