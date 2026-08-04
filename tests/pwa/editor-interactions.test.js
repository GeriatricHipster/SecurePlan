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
  for (const label of ['Color', 'Horizontal location', 'Vertical location', 'Text size', 'Thickness', 'Length']) {
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
