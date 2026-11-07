import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { buildSnapTargets, snapPoint, SnapTargetCache } from '../src/graph/snap.js';
import { snapDashedPoint, snapMovingDashed } from '../src/graph/dashed-magnets.js';
import { sketchMinimum } from '../src/graph/sketch.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { serializeDocument } from '../src/export.js';

const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, unit = 50;
const close = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
function setup() {
  const store = createStore();
  const id = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 3, y: 2 }, { mode: 'horizontal' });
  store.updateSelected({ showMinimum: true });
  const sketch = store.getState().sketches[0];
  return { store, id, minimum: sketchMinimum(sketch) };
}
const minimumTargets = targets => targets.crossings.filter(target => target.kind === 'minimum');

test('a displayed minimum is one shared point target and a hidden one is none', () => {
  const { store, id, minimum } = setup();
  const [target] = minimumTargets(buildSnapTargets(store.getState(), bounds));
  close(target.point, minimum); assert.deepEqual(target.ids, [id]);
  assert.equal(snapFeedbackModel(target).label, '최저점 맞춤');
  store.updateSelected({ showMinimum: false });
  assert.equal(minimumTargets(buildSnapTargets(store.getState(), bounds)).length, 0);
  store.updateSelected({ showMinimum: true });
  assert.equal(minimumTargets(buildSnapTargets(store.getState(), { xMin: 5, xMax: 10, yMin: 0, yMax: 10 })).length, 0, 'an off-screen minimum is not a magnet');
});

test('point and dashed tools capture, hold and store the exact minimum without a relation', () => {
  const { store, minimum } = setup(), targets = buildSnapTargets(store.getState(), bounds);
  const pointer = { x: minimum.x + 0.12, y: minimum.y + 0.08 };
  for (const snap of [snapPoint, snapDashedPoint]) {
    const result = snap(pointer, targets, unit);
    assert.equal(result.kind, 'minimum'); close(result.point, minimum);
    const held = snap({ x: minimum.x + 20 / unit, y: minimum.y }, targets, unit, { previous: result });
    assert.equal(held.kind, 'minimum', 'held within the shared 24px release');
    for (const axis of ['x', 'y']) close(snap({ ...minimum, [axis]: minimum[axis] + 0.1 }, targets, unit, { axis }).point, minimum);
  }
  for (const endpoint of ['anchor', 'end']) {
    const segment = endpoint === 'anchor' ? { anchor: pointer, end: { x: 1, y: 8 } } : { anchor: { x: 1, y: 8 }, end: pointer };
    const result = snapMovingDashed(segment, targets, unit, { bounds });
    assert.equal(result.kind, 'minimum'); close(result.geometry[endpoint], minimum);
  }
  const before = serializeDocument(store.getState()).sketches;
  const point = store.addPoint(snapPoint(pointer, targets, unit).point);
  const stored = store.getState().points.find(p => p.id === point);
  close(stored.anchor, minimum); assert.equal(stored.binding ?? null, null);
  assert.deepEqual(serializeDocument(store.getState()).sketches, before, 'snapping never changes the curve');
  assert.equal(store.getState().lines.length, 0);
});

test('the minimum target follows curve edits through the shared cache and skips the curve being edited', () => {
  const { store, id } = setup(), cache = new SnapTargetCache();
  const first = minimumTargets(cache.get(store.getState(), bounds))[0].point;
  store.selectObject(id); store.updateSelected({ anchor: { x: 4, y: 1.5 } });
  const moved = minimumTargets(cache.get(store.getState(), bounds))[0].point;
  close(moved, sketchMinimum(store.getState().sketches[0])); assert.notDeepEqual(moved, first);
  assert.equal(minimumTargets(cache.get(store.getState(), bounds, id)).length, 0, 'the curve being dragged is not its own magnet');
});
