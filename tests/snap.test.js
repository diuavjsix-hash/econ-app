import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { curvePoint } from '../src/graph/curve.js';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';

const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
const state = (lines = [], curves = []) => ({ lines, curves });
const line = (id, slope, x, y) => ({ id, slope, anchor: { x, y } });
const curve = (id, slope = -0.75, bend = 0.25, anchor = { x: 4, y: 4 }) => ({ id, slope, bend, span: 3, anchor });
const close = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8, JSON.stringify({ actual, expected }));

test('line snapping uses a consistent screen radius and leaves distant positions free', () => {
  const targets = buildSnapTargets(state([line('h', 0, 3, 2)]), bounds);
  for (const unit of [32, 56]) {
    const snapped = snapPoint({ x: 3, y: 2 + 9 / unit }, targets, unit);
    assert.equal(snapped.kind, 'shape');
    close(snapped.point, { x: 3, y: 2 });
    assert.equal(snapPoint({ x: 3, y: 2 + 11 / unit }, targets, unit), null);
  }
});

test('true vertical and extremely steep lines snap without finite-slope substitutions', () => {
  for (const slope of [null, 1e10, Number.MAX_VALUE]) {
    const targets = buildSnapTargets(state([line('v', slope, 3, 3)]), bounds);
    const snapped = snapPoint({ x: 3.1, y: 5 }, targets, 56);
    assert.equal(snapped.kind, 'shape');
    close(snapped.point, { x: 3 + (slope === null ? 0 : 2 / slope), y: 5 });
  }
});

test('intersections have a larger radius and priority even when the pointer is on another stroke', () => {
  const targets = buildSnapTargets(state([line('h', 0, 4, 4), line('v', null, 4, 4)]), bounds);
  const snapped = snapPoint({ x: 4 + 15 / 56, y: 4 }, targets, 56);
  assert.equal(snapped.kind, 'intersection');
  close(snapped.point, { x: 4, y: 4 });
  assert.deepEqual(new Set(snapped.ids), new Set(['h', 'v']));
  const outside = snapPoint({ x: 4 + 17 / 56, y: 4 }, targets, 56);
  assert.equal(outside.kind, 'shape');
  close(outside.point, { x: 4 + 17 / 56, y: 4 });
});

test('curves snap to the exact quadratic and to the displayed tangent extensions', () => {
  const c = curve('c');
  const targets = buildSnapTargets(state([], [c]), bounds);
  const expected = curvePoint(c, 0.4);
  const tangent = c.slope + 2 * c.bend * 0.4;
  const normalLength = Math.hypot(-tangent, 1);
  const point = { x: expected.x - tangent / normalLength * 0.1, y: expected.y + 0.1 / normalLength };
  const snapped = snapPoint(point, targets, 56);
  assert.equal(snapped.kind, 'shape');
  close(snapped.point, expected);
  const extension = { x: 8, y: 2.25 };
  const tailSnap = snapPoint({ x: extension.x + 0.025 / Math.hypot(0.25, 1), y: extension.y + 0.1 / Math.hypot(0.25, 1) }, targets, 56);
  close(tailSnap.point, extension);
  const join = snapPoint({ x: 7.05, y: 2.5 }, targets, 56);
  assert.equal(join.kind, 'shape', 'a curve must not intersect its own connected pieces');
});

test('line/curve and curve/curve intersections include multiple roots and tangencies', () => {
  const c = curve('c');
  const expected = curvePoint(c, 0.4);
  let targets = buildSnapTargets(state([line('v', null, expected.x, 3)], [c]), bounds);
  close(snapPoint({ x: expected.x + 0.1, y: expected.y + 0.1 }, targets, 56).point, expected);
  const other = curve('other', 0.75);
  targets = buildSnapTargets(state([], [c, other]), bounds);
  close(snapPoint({ x: 4.1, y: 4.1 }, targets, 56).point, { x: 4, y: 4 });
  const a = curve('a', -0.75, 0.35), b = curve('b', -0.75, 0.1, { x: 4, y: 4.1 });
  targets = buildSnapTargets(state([], [a, b]), bounds);
  for (const t of [-Math.sqrt(0.1 / 0.75), Math.sqrt(0.1 / 0.75)]) {
    const crossing = curvePoint(a, t);
    const snapped = snapPoint({ x: crossing.x + 0.05, y: crossing.y + 0.05 }, targets, 56);
    assert.equal(snapped.kind, 'intersection');
    close(snapped.point, crossing);
  }
  const bowed = curve('bowed', 0, 0.25);
  targets = buildSnapTargets(state([line('tangent', 0, 4, 4)], [bowed]), bounds);
  close(snapPoint({ x: 4.1, y: 4.05 }, targets, 56).point, { x: 4, y: 4 });
});

test('axis intersections are selectable; coincident strokes and invisible objects add no false intersections', () => {
  const targets = buildSnapTargets(state([line('a', 0, 4, 4), line('b', 0, 4, 4), line('hidden', null, -2, 3)]), bounds);
  assert.ok(!targets.shapes.some((shape) => shape.id === 'hidden'));
  assert.ok(!targets.crossings.some((crossing) => crossing.ids.includes('a') && crossing.ids.includes('b')));
  const origin = snapPoint({ x: 0.15, y: 0.12 }, targets, 56);
  assert.equal(origin.kind, 'intersection');
  close(origin.point, { x: 0, y: 0 });
  const projection = snapPoint({ x: 0.1, y: 4.1 }, targets, 56);
  assert.equal(projection.kind, 'intersection');
  close(projection.point, { x: 0, y: 4 });
});

test('toggling snap changes only the tool preference, and snapped coordinates remain mathematical in JSON', () => {
  const store = createStore();
  const id = store.addPoint({ x: 4.1, y: 4.1 });
  const original = store.getState().points[0];
  assert.equal(store.getState().pointSnap, false);
  store.update({ pointSnap: true });
  assert.equal(store.getState().pointSnap, true);
  assert.deepEqual(store.getState().points[0], original);
  store.update({ pointSnap: 'false' });
  assert.equal(store.getState().pointSnap, true);
  const snapped = snapPoint(original.anchor, buildSnapTargets(state([line('h', 0, 4, 4), line('v', null, 4, 4)]), bounds), 56);
  store.updateSelected({ anchor: snapped.point });
  store.update({ pointSnap: false });
  assert.equal(store.getState().selectedId, id);
  close(store.getState().points[0].anchor, { x: 4, y: 4 });
  const exported = serializeDocument(store.getState());
  assert.equal(exported.schemaVersion, 3);
  assert.equal('pointSnap' in exported, false);
  close(exported.points[0].anchor, { x: 4, y: 4 });
});

test('other points guide snapping while the dragged point excludes its own guides', () => {
  const guided = {
    lines: [], curves: [],
    points: [{ id: 'point-1', anchor: { x: 6, y: 4.3 }, guides: { horizontal: 'dashed', vertical: 'solid', extent: 'axes' } }],
  };
  const raw = { x: 3, y: 4.4 };
  const snapped = snapPoint(raw, buildSnapTargets(guided, bounds), 56);
  assert.equal(snapped.kind, 'shape');
  close(snapped.point, { x: 3, y: 4.3 });
  assert.equal(snapPoint(raw, buildSnapTargets(guided, bounds, 'point-1'), 56), null);
  const intersection = snapPoint({ x: 6.1, y: 4.4 }, buildSnapTargets(guided, bounds), 56);
  assert.equal(intersection.kind, 'intersection');
  close(intersection.point, guided.points[0].anchor);
});
