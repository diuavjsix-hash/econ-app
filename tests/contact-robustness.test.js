import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { serializeActive } from './fixtures/document.js';

const bounds = { xMin: 0, xMax: 16, yMin: 0, yMax: 12 }, unit = 45;
// A small deterministic generator, so the 2026-11-16 report case repeats over many positions.
function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

/** Line → tangent free curve → points on both intercepts → a new line through them → the old line deleted. */
function rebuilt(next) {
  const store = createStore();
  const first = store.addLine({ x: 0, y: 8 + next() * 4 }, { x: 9 + next() * 5, y: 0 });
  const l = store.getState().lines[0], tx = 3 + next() * 4, touch = { x: tx, y: l.anchor.y + l.slope * (tx - l.anchor.x) };
  store.addSketch({ x: tx - 1.5, y: touch.y + 5 }, { x: tx + 8, y: touch.y + 1 }, touch, { lineId: first });
  const intercepts = buildSnapTargets(store.getState(), bounds).crossings.filter(c => c.kind === 'intercept' && c.ids.includes(first));
  const onY = intercepts.find(c => c.point.x === 0).point, onX = intercepts.find(c => c.point.y === 0).point;
  for (const p of [onY, onX]) store.addPoint(p);
  const second = store.addLine(onY, onX);
  store.selectObject(first); store.removeSelected();
  return { store, second };
}

test('a line redrawn through the intercepts of a tangent line touches the curve as one tangent target', () => {
  const next = random(20261116);
  for (let i = 0; i < 120; i++) {
    const { store, second } = rebuilt(next), sketch = store.getState().sketches[0];
    const near = buildSnapTargets(store.getState(), bounds).crossings
      .filter(c => c.ids.includes(second) && Math.hypot(c.point.x - sketch.anchor.x, c.point.y - sketch.anchor.y) < 0.05);
    assert.deepEqual(near.map(c => c.kind), ['tangent'], `case ${i}: one touching point, never a tangent beside a crossing`);
  }
});

test('placing a point near the contact always reads tangent, and the JSON records the contact', () => {
  const next = random(7);
  for (let i = 0; i < 40; i++) {
    const { store, second } = rebuilt(next), sketch = store.getState().sketches[0], targets = buildSnapTargets(store.getState(), bounds);
    for (const offset of [-0.12, -0.04, 0, 0.04, 0.12]) {
      const hit = snapPoint({ x: sketch.anchor.x + offset, y: sketch.anchor.y + 0.03 }, targets, unit, {});
      assert.equal(hit?.kind, 'tangent', `case ${i} offset ${offset}`);
      assert.ok(hit.ids.includes(second));
    }
    const doc = serializeActive(store.getState());
    assert.ok(doc.relations.some(r => r.tangent?.some(pair => pair.includes(sketch.id) && pair.includes(second))), `case ${i}: the JSON keeps the tangency`);
  }
});

test('two distinct crossings of the same shapes stay two targets', () => {
  const store = createStore();
  const line = store.addLine({ x: 0, y: 3 }, { x: 10, y: 3 });
  store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' });
  const crossings = buildSnapTargets(store.getState(), bounds).crossings.filter(c => c.ids.includes(line) && c.ids.some(id => id.startsWith('sketch')));
  assert.equal(crossings.filter(c => c.kind === 'intersection').length, 2);
});
