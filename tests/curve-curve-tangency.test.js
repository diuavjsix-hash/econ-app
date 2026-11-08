import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { snapCurveToCurveTangency, contactBranches } from '../src/graph/curve-curve-tangency.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';
import { translatedSketch } from '../src/graph/sketch.js';
import { curveFamilyOf } from '../src/models/curve-families.js';
import { snapFeedbackTargets } from '../src/graph/snap-feedback.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds = { xMin: 0, xMax: 12, yMin: 0, yMax: 12 }, unit = 50;
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const pclose = (a, b) => { close(a.x, b.x); close(a.y, b.y); };
const pose = (c, d) => ({ ...c, ...translatedSketch(c, d) });
function setup() {
  const store = createStore();
  const fixed = store.addSketch({ x: 1, y: 0.1 }, { x: 7, y: 0.1 }, { x: 4, y: 2.1 }, { mode: 'horizontal' });
  const moving = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' });
  return { store, fixed, moving, curve: store.getState().sketches[1] };
}
function tangentAtPoint(curve, point) {
  const branches = contactBranches(curve, bounds);
  let best;
  for (const branch of branches) {
    const ranges = branch.straight ? [[branch.angle, branch.angle]] : [branch.range];
    for (const [low, high] of ranges) for (let i = 0; i <= 200; i++) {
      const candidate = branch.contact(low + (high - low) * i / 200, point);
      if (candidate && (!best || Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) < best.distance)) best = { ...candidate, distance: Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) };
    }
  }
  return best;
}

test('two independent free curves snap at their true contact without reshaping or changing the target', () => {
  const { store, fixed, moving, curve } = setup(), before = serializeDocument(store.getState());
  const snap = snapMovingCurve(curve, store.getState(), bounds, unit);
  assert.ok(snap); assert.equal(snap.sourceId, fixed); assert.ok(snap.key.startsWith('curve-tangent:'));
  pclose(snap.point, { x: 4, y: 2.1 }); pclose(snap.anchor, snap.point);
  store.beginHistory(); store.updateSelected({ anchor: snap.anchor, translate: true }); store.endHistory();
  const after = store.getState().sketches.find(c => c.id === moving);
  for (const key of ['start', 'end']) pclose({ x: after[key].x - after.anchor.x, y: after[key].y - after.anchor.y }, { x: curve[key].x - curve.anchor.x, y: curve[key].y - curve.anchor.y });
  assert.deepEqual(after.tangent, curve.tangent); assert.equal(after.binding, null);
  assert.deepEqual(serializeDocument(store.getState()).sketches[0], before.sketches[0]);
  store.undo(); assert.deepEqual(serializeDocument(store.getState()), before); store.redo();
  assert.equal(store.getState().sketches[1].anchor.y, snap.anchor.y);
});

test('curve tangency shares 16/24px retention, raw-position release, Alt bypass and stable keys', () => {
  const { store, curve } = setup();
  const at = y => pose(curve, { x: 0, y });
  const captured = snapCurveToCurveTangency(at(-0.2), store.getState(), bounds, unit); assert.ok(captured);
  const retained = snapCurveToCurveTangency(at(-0.35), store.getState(), bounds, unit, { previous: captured }); assert.ok(retained); assert.equal(retained.key, captured.key);
  assert.equal(snapCurveToCurveTangency(at(-0.35), store.getState(), bounds, unit), null);
  assert.equal(snapCurveToCurveTangency(at(-0.4), store.getState(), bounds, unit, { previous: captured }), null);
  assert.equal(snapCurveToCurveTangency(curve, store.getState(), bounds, unit, { altKey: true }), null);
});

test('Shift corrections keep the locked coordinate for horizontal and vertical free curves', () => {
  const { store, curve } = setup();
  const result = snapCurveToCurveTangency(curve, store.getState(), bounds, unit, { axis: 'y' }); assert.ok(result); close(result.anchor.x, curve.anchor.x); close(result.point.y, 2.1);
  assert.equal(snapCurveToCurveTangency(curve, store.getState(), bounds, unit, { axis: 'x' }), null);
  const state = store.getState(), swap = c => ({ ...c, start: { x: c.start.y, y: c.start.x }, end: { x: c.end.y, y: c.end.x }, anchor: { x: c.anchor.y, y: c.anchor.x }, tangent: { x: c.tangent.y, y: c.tangent.x } });
  state.sketches = state.sketches.map(swap);
  const vertical = snapCurveToCurveTangency(state.sketches[1], state, bounds, unit, { axis: 'x' }); assert.ok(vertical); close(vertical.anchor.y, 4); close(vertical.point.x, 2.1);
});

test('same-shape overlap, crossings without a common tangent and L-shape kinks do not produce false contacts', () => {
  const { store, curve } = setup(); const state = store.getState();
  state.sketches[0] = { ...pose(curve, { x: 0, y: 0.1 }), id: state.sketches[0].id };
  assert.equal(snapCurveToCurveTangency(curve, state, bounds, unit), null);
  state.sketches[0] = { ...state.sketches[0], start: { x: 1, y: 1 }, end: { x: 7, y: 7 }, anchor: { x: 4, y: 4 }, tangent: { x: 1, y: 1 } };
  assert.equal(snapCurveToCurveTangency(curve, state, bounds, unit), null);
  store.selectObject(curve.id); store.addIndifference('complements');
  assert.deepEqual(contactBranches(store.getState().curves[0], bounds), []);
});

test('offscreen and axis-gap contacts, own curves, bound moving curves and other diagrams stay excluded', () => {
  const { store, curve } = setup(), state = store.getState();
  assert.equal(snapCurveToCurveTangency(curve, { ...state, axisGapEnabled: true, axisGap: 5 }, bounds, unit), null);
  assert.equal(snapCurveToCurveTangency(curve, state, { xMin: 0, xMax: 3, yMin: 0, yMax: 12 }, unit), null);
  assert.equal(snapCurveToCurveTangency({ ...curve, binding: { kind: 'tangent', sourceId: 'line-1' } }, state, bounds, unit), null);
  assert.equal(snapCurveToCurveTangency(curve, { ...state, sketches: [curve] }, bounds, unit), null);
  state.sketches[0].binding = { sourceId: curve.id };
  assert.equal(snapCurveToCurveTangency(curve, state, bounds, unit), null);
  store.configureLayout('horizontal2'); store.selectDiagram(store.getState().diagrams[1].id);
  assert.equal(snapCurveToCurveTangency(curve, store.getState(), bounds, unit), null);
});

test('PPC and Cobb-Douglas contact by radial size change with an exact shared negative slope', () => {
  const store = createStore(); store.addIndifference('cobb-douglas', { anchor: { x: 3, y: 3 } });
  store.addIndifference('ppc', { anchor: { x: 3.05, y: 3.05 } });
  const c = store.getState().curves[1], snap = snapMovingCurve(c, store.getState(), bounds, unit);
  assert.ok(snap); pclose(snap.point, { x: 3, y: 3 }); pclose(snap.anchor, { x: 3, y: 3 });
  close(snap.anchor.x / c.anchor.x, snap.anchor.y / c.anchor.y);
  const target = store.getState().curves[0], adopted = { ...c, anchor: snap.anchor };
  const a = curveFamilyOf(adopted).tangentVector(adopted, snap.point), b = curveFamilyOf(target).tangentVector(target, snap.point);
  close(a.y / a.x, b.y / b.x); close(a.y / a.x, -1);
});

test('basic quadratic curves and free-curve interior tangencies use the original quadratic geometry', () => {
  const store = createStore(); store.addCurve({ anchor: { x: 4, y: 4 }, span: 3, variant: 'descending' });
  const basic = store.getState().curves[0], x = 4.6, t = (x - basic.anchor.x) / basic.span;
  const y = basic.anchor.y + basic.span * (basic.slope * t + basic.bend * t * t), slope = basic.slope + 2 * basic.bend * t;
  store.addSketch({ x: x - 2, y: y - 1 }, { x: x + 2, y: y - 3 }, { x, y: y + 0.1 }, { tangent: { x: 1, y: slope } });
  const c = store.getState().sketches[0], snap = snapCurveToCurveTangency(c, store.getState(), bounds, unit);
  assert.ok(snap); assert.equal(snap.sourceId, basic.id);
  const contact = tangentAtPoint(basic, snap.point); assert.ok(contact.distance < 0.1);
  const exact = basic.anchor.y + basic.slope * (snap.point.x - basic.anchor.x) + basic.bend / basic.span * (snap.point.x - basic.anchor.x) ** 2;
  close(snap.point.y, exact);
});

test('both matched curves use common highlights under reflected axes and moving-point magnets retain priority', () => {
  const { store, curve } = setup(), state = store.getState(), snap = snapMovingCurve(curve, state, bounds, unit); assert.ok(snap);
  const highlights = snapFeedbackTargets(snap.ids, state, createViewport(800, 600, 'first', { flipX: true, flipY: true })); assert.equal(highlights.length, 2);
  store.addPoint({ x: 4, y: 2.01 });
  const point = snapMovingCurve(curve, store.getState(), bounds, unit); assert.equal(point.kind, 'point');
});

test('oblique tangencies solve both original parabola equations and derivatives under free/Shift movement', () => {
  const parabola = (id, k, y) => {
    const anchor = { x: 4, y }, slope = 0.7, tangent = { x: 1, y: slope };
    const start = { x: 1, y: y - 3 * slope + 9 * k }, end = { x: 7, y: y + 3 * slope + 9 * k };
    return { id, type: 'sketch', anchor, start, end, tangent, leftReach: 1.5 * Math.hypot(1, slope) / Math.hypot(start.x - 4, start.y - y),
      rightReach: 1.5 * Math.hypot(1, slope) / Math.hypot(end.x - 4, end.y - y), binding: null };
  };
  const target = parabola('sketch-1', 0.2, 4), moving = parabola('sketch-2', -0.3, 4.08);
  const state = { lines: [], curves: [], sketches: [target, moving], points: [], sums: [], axisGapEnabled: false };
  for (const axis of [null, 'x', 'y']) {
    const snap = snapCurveToCurveTangency(moving, state, bounds, unit, { axis }); assert.ok(snap);
    const x = snap.point.x, a = snap.anchor, targetY = 4 + 0.7 * (x - 4) + 0.2 * (x - 4) ** 2;
    const movingY = a.y + 0.7 * (x - a.x) - 0.3 * (x - a.x) ** 2;
    close(snap.point.y, targetY); close(movingY, targetY);
    close(0.7 + 0.4 * (x - 4), 0.7 - 0.6 * (x - a.x));
    if (axis) close(a[axis === 'x' ? 'y' : 'x'], moving.anchor[axis === 'x' ? 'y' : 'x']);
  }
});

test('quasi-linear curves keep their linear-axis movement when touching a PPC', () => {
  for (const linearAxis of ['x', 'y']) {
    const store = createStore(); store.addIndifference('ppc', { anchor: { x: 3, y: 3 } });
    store.addIndifference('quasilinear', { anchor: { x: 3, y: 3 } });
    store.updateSelected({ shape: 3, linearAxis });
    const c = store.getState().curves[1]; store.updateSelected({ anchor: { ...c.anchor, [linearAxis]: 3.05 } });
    const moving = store.getState().curves[1], snap = snapCurveToCurveTangency(moving, store.getState(), bounds, unit); assert.ok(snap);
    pclose(snap.point, { x: 3, y: 3 }); close(snap.anchor[linearAxis], 3);
    close(snap.anchor[linearAxis === 'x' ? 'y' : 'x'], moving.anchor[linearAxis === 'x' ? 'y' : 'x']);
  }
});
