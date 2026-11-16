import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { interactionFor } from '../src/graph/interactions.js';
import { createViewport } from '../src/graph/viewport.js';

const close = (a, b, message) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, message ?? `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const viewport = createViewport(800, 600, 'first');
const ctxFor = store => ({ viewport, state: store.getState(), tangentSnap: null, snapTargets: () => ({ shapes: [], crossings: [] }) });

// A budget line drawn from the y axis keeps its anchor on the axis, where the drawn line is hidden.
function tangentSketch(kind = 'line') {
  const store = createStore();
  const line = store.addLine({ x: 0, y: 8 }, { x: 10, y: 0 }, { kind });
  const touch = { x: 6, y: 3.2 };
  const sketch = store.addSketch({ x: 3, y: 9 }, { x: 10, y: 5 }, touch, { lineId: line });
  return { store, line, sketch, touch };
}
const lineOf = (store, id) => store.getState().lines.find(l => l.id === id);
const sketchOf = (store, id) => store.getState().sketches.find(s => s.id === id);
function touchLine(store, id) {
  const line = lineOf(store, id), handler = interactionFor(line), anchor = handler.start(line, ctxFor(store));
  store.selectObject(id); store.updateSelected(handler.startPatch(line, anchor));
  return anchor;
}

for (const kind of ['line', 'segment']) test(`touching a ${kind} re-anchors it without moving the tangent free curve`, () => {
  const { store, line, sketch, touch } = tangentSketch(kind), before = structuredClone(sketchOf(store, sketch));
  const anchor = touchLine(store, line);
  assert.ok(Math.hypot(anchor.x, anchor.y - 8) > 1, 'the line was re-anchored away from the axis');
  close(lineOf(store, line).anchor, anchor);
  const after = sketchOf(store, sketch);
  close(after.anchor, touch); close(after.tangent, before.tangent); close(after.start, before.start); close(after.end, before.end);
  assert.equal(after.binding.sourceId, line, 'the curve still follows the line');
});

test('after the re-anchor the free curve still follows the line', () => {
  const { store, line, sketch, touch } = tangentSketch();
  touchLine(store, line);
  const l = lineOf(store, line);
  store.updateSelected({ anchor: { x: l.anchor.x, y: l.anchor.y + 1 } });
  close(sketchOf(store, sketch).anchor, { x: touch.x, y: touch.y + 1 }, 'a translation carries the contact with it');
});

test('a rotation that first moves the pivot along the line keeps the contact on the line', () => {
  const { store, line, sketch, touch } = tangentSketch();
  store.selectObject(line);
  // Same slope, new pivot on the line: only the reference moves.
  store.updateSelected({ anchor: { x: 5, y: 4 }, slope: -0.8, rebase: true });
  close(sketchOf(store, sketch).anchor, touch);
});
