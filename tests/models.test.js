import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { objectsOf } from '../src/objects.js';
import { GraphObject, DrawableObject, MovableObject, StrokeObject } from '../src/models/graph-object.js';
import { objectModel, objectModelsOf, OBJECT_MODELS, LineObject, CurveObject, AnalyticCurveObject, SegmentObject, DashedObject, RulerObject } from '../src/models/objects.js';
import { OBJECT_TYPES, OBJECT_COLLECTIONS, DUPLICATABLE_TYPES } from '../src/models/object-types.js';
import { AnalyticCurveFamily, RadialCurveFamily, PowerCurveFamily, CURVE_FAMILIES, curveFamilyOf } from '../src/models/curve-families.js';
import { SnapPolicy, NearestSnapPolicy, PrioritySnapPolicy } from '../src/graph/snap-policy.js';
import { objectsInRectangle } from '../src/graph/selection.js';
import { snapFeedbackTargets } from '../src/graph/snap-feedback.js';
import { createViewport } from '../src/graph/viewport.js';
import { SvgRenderer, StrokeRenderer } from '../src/graph/svg-renderer.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function populatedStore() {
  const store = createStore();
  store.addLine(); store.addCurve(); store.addPoint({ x: 2, y: 3 }); store.addDashedLine({ x: 1, y: 1 }, { x: 4, y: 5 });
  store.addGroup(); store.addSketch({ x: 1, y: 4 }, { x: 7, y: 4 }, { x: 4, y: 2 });
  store.addFill({ rings: [[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }]] });
  store.addSum([store.getState().lines[0].id, store.getState().curves[0].id]);
  for (const family of Object.keys(CURVE_FAMILIES)) store.addIndifference(family);
  return store;
}

test('abstract bases reject direct construction and the registry covers every document collection', () => {
  for (const Base of [GraphObject, DrawableObject, MovableObject, StrokeObject, SegmentObject, AnalyticCurveFamily, RadialCurveFamily, SnapPolicy]) assert.throws(() => new Base({}), /abstract/);
  assert.deepEqual(Object.keys(OBJECT_TYPES), Object.keys(OBJECT_MODELS));
  assert.equal(new Set(OBJECT_COLLECTIONS).size, OBJECT_COLLECTIONS.length);
  assert.deepEqual(DUPLICATABLE_TYPES, ['line', 'curve', 'sketch', 'point', 'dashed', 'group']);
  assert.throws(() => objectModel({ type: 'constructor' }), /Unknown graph object type/);
});

test('all existing shapes use the shared name-edit contract with one history step and independent geometry', () => {
  const store = populatedStore();
  for (const object of objectsOf(store.getState())) {
    store.selectObject(object.id);
    const before = serializeDocument(store.getState());
    store.beginHistory(); store.updateSelected({ name: '공통 이름 '.repeat(30) }); store.updateSelected({ name: '공통 편집' }); store.endHistory();
    assert.equal(objectsOf(store.getState()).find(item => item.id === object.id).name, '공통 편집');
    store.undo(); assert.deepEqual(serializeDocument(store.getState()), before);
    store.redo(); assert.equal(objectsOf(store.getState()).find(item => item.id === object.id).name, '공통 편집');
  }
});

test('models and curve strategies never enter live snapshots, undo snapshots or JSON', () => {
  const store = populatedStore(), assertPlain = value => {
    if (value === null || typeof value !== 'object') return;
    assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
    for (const child of Object.values(value)) assertPlain(child);
  };
  const before = store.getState();
  for (const data of objectsOf(before)) assert.ok(objectModel(data) instanceof GraphObject);
  assertPlain(before); assertPlain(structuredClone(before)); assertPlain(serializeDocument(before));
  store.updateSelected({ anchor: { x: 5, y: 6 } }); store.undo(); assertPlain(store.getState()); store.redo(); assertPlain(store.getState());
});

test('finite dashed and ruler subclasses share validation while preserving retired-ruler visibility rules', () => {
  const base = { id: 'segment-1', name: '선분', color: '#123456', parentId: null, anchor: { x: 1, y: 2 }, end: { x: 4, y: 6 } };
  const dashed = objectModel({ ...structuredClone(base), type: 'dashed' }), ruler = objectModel({ ...structuredClone(base), type: 'ruler', style: 'solid', showMeasurement: true });
  assert.ok(dashed instanceof DashedObject && dashed instanceof SegmentObject);
  assert.ok(ruler instanceof RulerObject && ruler instanceof SegmentObject);
  for (const model of [dashed, ruler]) {
    model.applyPatch({ anchor: { ...base.end }, name: '이름' });
    assert.deepEqual(model.data.anchor, base.anchor); assert.equal(model.data.name, '이름');
    model.applyPatch({ end: { x: Infinity, y: 2 } }); assert.deepEqual(model.data.end, base.end);
    const moved = model.translate({ x: 3, y: -1 });
    close(Math.hypot(moved.end.x - moved.anchor.x, moved.end.y - moved.anchor.y), 5);
    assert.deepEqual(model.data.anchor, base.anchor);
  }
  const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
  assert.ok(dashed.touchesRectangle(bounds, {})); assert.equal(ruler.touchesRectangle(bounds, {}), false);
  assert.equal(ruler.highlightGeometry(bounds, {}), null);
});

test('copy and export adapters produce detached values and keep unsupported capabilities closed', () => {
  const store = populatedStore();
  for (const data of objectsOf(store.getState())) {
    const model = objectModel(data), before = structuredClone(data), exported = model.serialize();
    assert.equal(Object.hasOwn(exported, 'collapsed'), false);
    if (exported.anchor) exported.anchor.x += 20;
    if (exported.rings) exported.rings[0][0].x += 20;
    assert.deepEqual(data, before);
    const copy = model.duplicate();
    if (!DUPLICATABLE_TYPES.includes(data.type)) { assert.ok(copy.error); continue; }
    assert.equal(copy.error, null);
    if (copy.object.anchor) copy.object.anchor.x += 30;
    assert.deepEqual(data, before);
  }
});

test('the shared translation API moves filled rings with their anchor and leaves the source detached', () => {
  const store = populatedStore(), fill = store.getState().fills[0], model = objectModel(fill), moved = model.translate({ x: 2, y: -1 });
  close(moved.anchor.x, fill.anchor.x + 2); close(moved.anchor.y, fill.anchor.y - 1);
  for (let i = 0; i < fill.rings[0].length; i++) {
    close(moved.rings[0][i].x, fill.rings[0][i].x + 2); close(moved.rings[0][i].y, fill.rings[0][i].y - 1);
  }
  moved.rings[0][0].x += 10; assert.equal(fill.rings[0][0].x, 0);
  assert.equal(model.translate({ x: Infinity, y: 0 }), null);
});

test('selection and common highlights consume the same visible geometry for every drawable subclass', () => {
  const store = populatedStore(); store.update({ axisGapEnabled: true, axisGap: 0.75 });
  const state = store.getState(), viewport = createViewport(800, 600, 'first', state), rectangle = viewport.bounds;
  const models = objectModelsOf(state), ids = objectsInRectangle(state, rectangle), highlights = snapFeedbackTargets(state.objectOrder, state, viewport);
  for (const model of models) {
    assert.equal(ids.includes(model.data.id), model.touchesRectangle(rectangle, state));
    const geometry = model.highlightGeometry(rectangle, state);
    assert.equal(highlights.some(target => target.id === model.data.id), Boolean(geometry && (geometry.kind === 'point' || geometry.pieces.length)));
  }
  // Read-only collection inference preserves minimal legacy geometry fixtures.
  const fixture = { lines: [{ id: 'line-x', anchor: { x: 1, y: 1 }, slope: 1 }], curves: [] };
  assert.ok(objectModelsOf(fixture)[0] instanceof LineObject); assert.equal(fixture.lines[0].type, undefined);
});

test('analytic curves inherit radial and power behavior and share shape controls between UI and store', () => {
  const store = createStore();
  for (const family of Object.keys(CURVE_FAMILIES)) {
    store.addIndifference(family); const c = store.getState().curves.at(-1), model = objectModel(c), strategy = curveFamilyOf(c);
    assert.ok(model instanceof AnalyticCurveObject && model instanceof CurveObject && model instanceof StrokeObject);
    assert.equal(strategy instanceof RadialCurveFamily, ['ppc', 'cobb-douglas', 'rectangular-hyperbola', 'complements'].includes(family));
    assert.equal(strategy instanceof PowerCurveFamily, ['cobb-douglas', 'rectangular-hyperbola'].includes(family));
    const patch = strategy.shapeFromValue(c, 1.7); store.updateSelected(patch);
    close(strategy.shapeValue(store.getState().curves.at(-1)), 1.7);
    if (!strategy.editableShape) { store.updateSelected({ shape: 8 }); assert.equal(store.getState().curves.at(-1).shape, 1); }
  }
});

test('snap subclasses share capture/release while preserving creation promotion and movement retention', () => {
  const nearest = new NearestSnapPolicy(), priority = new PrioritySnapPolicy();
  const retained = { key: 'stroke', kind: 'shape', distance: 22, priority: 2, pointerDistance: 0 };
  const point = { key: 'point', kind: 'point', distance: 10, priority: 0, pointerDistance: 0 };
  assert.equal(nearest.choose([retained, point], retained), retained);
  assert.equal(priority.choose([retained, point], retained), point);
  for (const policy of [nearest, priority]) {
    assert.equal(policy.choose([{ ...retained, distance: 24.1 }], retained), null);
    assert.equal(policy.choose([{ ...point, distance: 16.1 }]), null);
    assert.equal(policy.choose([point]), point);
  }
});

test('the inherited SVG renderer preserves gaps, connected curves and reflected projection', () => {
  const renderer = new StrokeRenderer(); assert.ok(renderer instanceof SvgRenderer);
  for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const viewport = createViewport(500, 400, 'all', { flipX, flipY });
    const disconnected = [[{ x: -2, y: -2 }, { x: -1, y: -1 }], [{ x: 1, y: 1 }, { x: 2, y: 2 }]];
    assert.equal(renderer.pathData(disconnected, viewport).split('M').length - 1, 2);
    const connected = [[{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], [{ x: 3, y: 1 }, { x: 4, y: 0 }, { x: 5, y: 1 }]];
    const d = renderer.pathData(connected, viewport, { quadratic: true });
    assert.equal(d.split('M').length - 1, 1); assert.equal(d.split('Q').length - 1, 2);
    assert.equal(renderer.pathData(connected, viewport, { quadratic: true, connect: false }).split('M').length - 1, 2);
    assert.equal(d.includes('NaN'), false);
  }
});
