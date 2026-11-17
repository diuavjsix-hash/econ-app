import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { sketchControls, sketchPieces, sketchKnots, sketchMinimum, nearestOnSketch, quadraticPoint, insertSketchPoint, validSketch, sketchHandlePoints } from '../src/graph/sketch.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { rolesChangedBy, replaceLinks, linkFor } from '../src/links.js';
import { interactionFor } from '../src/graph/interactions.js';
import { createViewport } from '../src/graph/viewport.js';
import { objectModel } from '../src/models/objects.js';
import { serializeActive } from './fixtures/document.js';

const bounds = { xMin: 0, xMax: 16, yMin: 0, yMax: 12 }, unit = 45;
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < tolerance, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const sketch = (store, id) => store.getState().sketches.find(curve => curve.id === (id ?? store.getState().selectedId));
/** The farthest any sample of `a` is from curve `b`. */
const deviation = (a, b) => Math.max(...sketchControls(a).flatMap(points => Array.from({ length: 41 }, (_, i) => nearestOnSketch(b, quadraticPoint(points, i / 40)).distance)));
const cup = store => { const id = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' }); store.selectObject(id); return id; };

test('without through points the pieces are the original two, bit for bit', () => {
  const curve = { start: { x: 1, y: 7 }, end: { x: 9, y: 3 }, anchor: { x: 4, y: 2.5 }, tangent: { x: 0.8, y: -0.6 }, leftReach: 0.7, rightReach: 0.3 };
  const d = curve.tangent, l = Math.hypot(curve.start.x - 4, curve.start.y - 2.5) * 0.7 * -1, r = Math.hypot(curve.end.x - 4, curve.end.y - 2.5) * 0.3;
  assert.deepEqual(sketchControls(curve), [[curve.start, { x: 4 + d.x * l, y: 2.5 + d.y * l }, curve.anchor], [curve.anchor, { x: 4 + d.x * r, y: 2.5 + d.y * r }, curve.end]]);
  assert.deepEqual(sketchKnots(curve).map(knot => knot.key), ['start', 'anchor', 'end']);
});

test('an added through point keeps the curve; next to an end exactly, between inner points closely', () => {
  const store = createStore(), id = cup(store), original = sketch(store);
  assert.equal(store.insertSketchPoint({ x: 2, y: 4 }), 'p1');
  const one = sketch(store);
  assert.ok(deviation(original, one) < 1e-7 && deviation(one, original) < 1e-7, 'split of a piece next to the start');
  assert.deepEqual(one.through.map(point => [point.id, point.side]), [['p1', 'start']]);
  assert.ok(sketchPieces(one).some(piece => piece.part === 'first'), 'the span between p1 and the anchor has two pieces');
  assert.equal(store.insertSketchPoint({ x: 6.2, y: 4.5 }), 'p2');
  assert.ok(deviation(one, sketch(store)) < 1e-7);
  // Between p1 and the anchor: two inner points, so the far half may move a little.
  assert.equal(store.insertSketchPoint({ x: 3, y: 2.6 }), 'p3');
  assert.ok(deviation(original, sketch(store)) < 0.05);
  assert.deepEqual(sketchKnots(sketch(store)).map(knot => knot.key), ['start', 'through:p1', 'through:p3', 'anchor', 'through:p2', 'end']);
  assert.equal(validSketch(sketch(store)), true);
  assert.equal(store.getState().sketchFocus.key, 'through:p3', 'the new point gets the tangent handles');
  assert.deepEqual(sketchHandlePoints(sketch(store), 'through:p3').center, sketch(store).through[1].point);
  // Each addition is its own undo step.
  store.undo(); assert.equal(sketch(store, id).through.length, 2);
  store.undo(); store.undo(); assert.equal(sketch(store, id).through, undefined); assert.deepEqual(sketch(store, id), original);
});

test('a moved through point makes the curve pass there; its own handles reshape only around it', () => {
  const store = createStore(); cup(store); store.insertSketchPoint({ x: 6.2, y: 4.5 });
  const handler = interactionFor(sketch(store)), viewport = createViewport(720, 540, 'first');
  const ctx = () => ({ state: store.getState(), viewport, snappedMove: point => point });
  store.updateSelected(handler.drag(sketch(store), 'sketch-point:p1', null, { x: 6, y: 0.5 }, {}, ctx()).patch);
  near(sketch(store).through[0].point, { x: 6, y: 0.5 });
  assert.ok(sketchControls(sketch(store)).some(points => Math.hypot(points[2].x - 6, points[2].y - 0.5) < 1e-12), 'the curve passes the point');
  const before = sketch(store);
  store.updateSelected(handler.drag(before, 'sketch-tangent:p1', null, { x: 7, y: 0.5 }, {}, ctx()).patch);
  near(sketch(store).through[0].tangent, { x: 1, y: 0 }, 1e-12);
  assert.deepEqual(sketch(store).tangent, before.tangent, 'the anchor keeps its tangent');
  near(sketchMinimum(sketch(store)), { x: 6, y: 0.5 }, 1e-9);
  const handles = sketchHandlePoints(sketch(store), 'through:p1');
  store.updateSelected(handler.drag(sketch(store), 'sketch-rightReach:p1', null, { x: handles.rightReach.x + 0.3, y: handles.rightReach.y }, {}, ctx()).patch);
  assert.ok(sketch(store).through[0].rightReach > before.through[0].rightReach);
  assert.equal(sketch(store).leftReach, before.leftReach);
  const nudged = handler.keyboard(sketch(store), 'sketch-point:p1', { key: 'ArrowUp' }, ctx());
  near(nudged.patch.through[0].point, { x: 6, y: 0.6 }, 1e-9);
});

test('translation, sets and duplicates carry the through points with the curve', () => {
  const store = createStore(); cup(store); store.insertSketchPoint({ x: 2, y: 4 });
  const before = sketch(store);
  store.updateSelected({ anchor: { x: 5, y: 3 }, translate: true });
  near(sketch(store).through[0].point, { x: before.through[0].point.x + 1, y: before.through[0].point.y + 1 });
  const copy = objectModel(sketch(store)).translate({ x: 2, y: 0 });
  near(copy.through[0].point, { x: sketch(store).through[0].point.x + 2, y: sketch(store).through[0].point.y });
  assert.equal(objectModel(sketch(store)).sameGeometry(copy), false);
  assert.equal(objectModel(sketch(store)).sameGeometry(structuredClone(sketch(store))), true);
});

test('removing a through point drops it and the links recorded for it, in one undo step', () => {
  const store = createStore(), avc = store.addSketch({ x: 1, y: 8 }, { x: 9, y: 8 }, { x: 5, y: 3 }, { mode: 'horizontal' });
  store.selectObject(avc); store.updateSelected({ showMinimum: true });
  const mc = store.addSketch({ x: 1, y: 6 }, { x: 9, y: 10 }, { x: 3, y: 2 }, { mode: 'horizontal' });
  store.selectObject(mc); store.insertSketchPoint({ x: 6, y: 5 });
  // The shared magnet offers AVC's displayed minimum; the through point lands on it.
  const target = snapPoint({ x: 5.05, y: 3.04 }, buildSnapTargets(store.getState(), bounds, mc), unit, { points: [], bounds });
  assert.equal(target.kind, 'minimum');
  store.beginHistory();
  const handler = interactionFor(sketch(store, mc));
  store.updateSelected(handler.drag(sketch(store, mc), 'sketch-point:p1', null, target.point, {}, { state: store.getState(), viewport: createViewport(720, 540, 'first'), snappedMove: () => target.point }).patch);
  store.recordSnaps(mc, { roles: rolesChangedBy('sketch', 'sketch-point:p1'), snaps: { 'through:p1': target } });
  store.endHistory();
  const link = serializeActive(store.getState()).links.find(link => link.ids[0] === mc);
  assert.deepEqual({ type: link.type, role: link.role, status: link.status, ids: link.ids }, { type: 'minimum', role: 'through:p1', status: 'holds', ids: [mc, avc] });
  // Moving AVC away breaks the recorded intent; the curves stay free.
  store.selectObject(avc); store.updateSelected({ anchor: { x: 5.5, y: 3.5 }, translate: true });
  assert.equal(serializeActive(store.getState()).links.find(link => link.ids[0] === mc).status, 'broken');
  store.undo();
  store.selectObject(mc);
  assert.equal(store.removeSketchPoint('p1'), true);
  assert.equal(sketch(store, mc).through, undefined);
  assert.equal(store.getState().links.some(link => link.ids[0] === mc), false);
  store.undo();
  assert.equal(sketch(store, mc).through.length, 1);
  assert.equal(store.getState().links.find(link => link.ids[0] === mc).role, 'through:p1');
});

test('link roles: a through handle replaces only its own role; moving the whole curve replaces all', () => {
  assert.deepEqual(rolesChangedBy('sketch', 'sketch-point:p2'), ['through:p2', 'shape']);
  assert.deepEqual(rolesChangedBy('sketch', 'sketch-tangent:p2'), ['shape']);
  const candidate = { kind: 'point', ids: ['point-1'], point: { x: 1, y: 1 } };
  assert.equal(linkFor('l', 'sketch-1', 'through:p2', candidate).role, 'through:p2');
  assert.equal(linkFor('l', 'sketch-1', 'through', candidate), null, 'the family name is not a role');
  const links = ['start', 'through:p1', 'through:p2'].map(role => ({ id: role, ids: ['sketch-1', 'point-1'], role }));
  assert.deepEqual(replaceLinks(links, 'sketch-1', rolesChangedBy('sketch', 'sketch-point:p1')).map(link => link.role), ['start', 'through:p2']);
  assert.deepEqual(replaceLinks(links, 'sketch-1', rolesChangedBy('sketch', 'move')), []);
});

test('invalid through lists are rejected without changing the curve', () => {
  const store = createStore(); cup(store);
  const original = sketch(store), point = { id: 'p1', side: 'start', point: { x: 2, y: 4 }, tangent: { x: 1, y: -1 }, leftReach: 0.5, rightReach: 0.5 };
  for (const through of [[{ ...point, point: { ...original.start } }], [point, { ...point }], [{ ...point, side: 'end' }, { ...point, id: 'p2' }]]) {
    store.updateSelected({ through });
    assert.deepEqual(sketch(store), original);
  }
  assert.equal(insertSketchPoint(original, { x: 1, y: 6 }), null, 'not on an existing point');
  store.updateSelected({ through: [point] });
  assert.equal(sketch(store).through.length, 1);
  store.updateSelected({ through: [] });
  assert.equal(sketch(store).through, undefined);
});

test('the shared contact case really has its contact between two inner points', async () => {
  const { CURVE_CONTACT_CASES } = await import('./fixtures/curve-contact-cases.js');
  const { store, target, expected } = CURVE_CONTACT_CASES.find(c => c.name === 'free through points interior').setup();
  const curve = sketch(store, target);
  assert.deepEqual(curve.through.map(point => point.side), ['start', 'end']);
  const at = nearestOnSketch(curve, expected);
  assert.ok(at.distance < 1e-9 && at.piece.part !== 'single', 'on a piece of a span between two inner points');
});
