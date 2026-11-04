import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';
import { snapDashedPoint, snapMovingDashed } from '../src/graph/dashed-magnets.js';
import { CURVE_CONTACT_CASES, NON_SMOOTH_CONTACT_FAMILIES } from './fixtures/curve-contact-cases.js';
import { CURVE_FAMILIES } from '../src/models/curve-families.js';
import { serializeDocument } from '../src/export.js';
import { snapFeedbackTargets } from '../src/graph/snap-feedback.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds = { xMin: 0, xMax: 12, yMin: 0, yMax: 12 }, unit = 50;
const close = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7, JSON.stringify({ a, b }));

test('a curve movement contact remains a shared point and dashed target after the gesture ends', () => {
  const store = createStore();
  const fixed = store.addSketch({ x: 1, y: 0.1 }, { x: 7, y: 0.1 }, { x: 4, y: 2.1 }, { mode: 'horizontal' });
  const moving = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' });
  const contact = snapMovingCurve(store.getState().sketches[1], store.getState(), bounds, unit);
  assert.equal(contact.kind, 'tangent');
  store.updateSelected({ anchor: contact.anchor, translate: true });
  // No live drag candidate is passed to the target builder: it must recover the contact.
  const targets = buildSnapTargets(store.getState(), bounds);
  const pointer = { x: contact.point.x + 0.12, y: contact.point.y + 0.08 };
  for (const result of [snapPoint(pointer, targets, unit), snapDashedPoint(pointer, targets, unit),
    snapMovingDashed({ anchor: { x: 1, y: 8 }, end: pointer }, targets, unit, { bounds })]) {
    assert.equal(result?.kind, 'tangent'); close(result.point, contact.point);
    assert.deepEqual(new Set(result.ids), new Set([fixed, moving]));
  }
});

test('every registered curve family explicitly participates in the cross-tool contact contract', () => {
  assert.deepEqual([...NON_SMOOTH_CONTACT_FAMILIES].sort(), Object.keys(CURVE_FAMILIES).filter(key => CURVE_FAMILIES[key].contactGeometry === 'kink').sort(),
    'Only explicitly nonsmooth families can skip the smooth contact round trip');
  const covered = new Set([...CURVE_CONTACT_CASES.flatMap(c => c.families), ...NON_SMOOTH_CONTACT_FAMILIES]);
  assert.deepEqual([...covered].sort(), Object.keys(CURVE_FAMILIES).sort(),
    'A new curve family needs movement → point/dashed coverage or an explicit nonsmooth exclusion');
});

for (const fixture of CURVE_CONTACT_CASES) test(`contact round trip: ${fixture.name}`, () => {
  const { store, target, moving, expected } = fixture.setup();
  const state = store.getState(), curve = [...state.curves, ...state.sketches].find(c => c.id === moving);
  const contact = snapMovingCurve(curve, state, bounds, unit, { axis: fixture.axis });
  assert.equal(contact?.kind, 'tangent'); assert.equal(contact.sourceId, target);
  if (expected) close(contact.point, expected);
  store.beginHistory(); store.selectObject(moving);
  store.updateSelected({ anchor: contact.anchor, translate: true }); store.endHistory();
  const document = serializeDocument(store.getState());
  // A fresh clone proves the target does not depend on object identity or drag metadata.
  const targets = buildSnapTargets(structuredClone(store.getState()), bounds);
  const pair = targets.crossings.filter(c => c.kind === 'tangent' && c.ids.includes(target) && c.ids.includes(moving));
  assert.ok(pair.some(c => Math.hypot(c.point.x - contact.point.x, c.point.y - contact.point.y) < 1e-7));
  for (const offset of [-0.12, 0.12]) {
    const pointer = { x: contact.point.x + offset, y: contact.point.y + 0.06 };
    const point = snapPoint(pointer, targets, unit), dashed = snapDashedPoint(pointer, targets, unit);
    for (const result of [point, dashed]) {
      assert.equal(result?.kind, 'tangent'); close(result.point, contact.point);
      assert.deepEqual(new Set(result.ids), new Set([target, moving]));
      assert.equal(snapFeedbackTargets(result.ids, store.getState(), createViewport(800, 600, 'first', {})).length, 2);
    }
  }
  for (const axis of ['x', 'y']) {
    const pointer = { ...contact.point, [axis]: contact.point[axis] + 0.1 };
    for (const result of [snapPoint(pointer, targets, unit, { axis }), snapDashedPoint(pointer, targets, unit, { axis })]) {
      assert.equal(result?.kind, 'tangent'); close(result.point, contact.point);
    }
  }
  for (const endpoint of ['anchor', 'end']) {
    const pointer = { x: contact.point.x + 0.1, y: contact.point.y }, far = { x: 1, y: 8 };
    const segment = endpoint === 'anchor' ? { anchor: pointer, end: far } : { anchor: far, end: pointer };
    const result = snapMovingDashed(segment, targets, unit, { bounds });
    assert.equal(result?.kind, 'tangent'); assert.equal(result.endpoint, endpoint); close(result.geometry[endpoint], contact.point);
    close({ x: result.geometry.end.x - result.geometry.anchor.x, y: result.geometry.end.y - result.geometry.anchor.y },
      { x: segment.end.x - segment.anchor.x, y: segment.end.y - segment.anchor.y });
  }
  assert.deepEqual(serializeDocument(store.getState()), document, 'target discovery must not mutate document geometry');
  store.undo();
  assert.ok(!buildSnapTargets(store.getState(), bounds).crossings.some(c => c.kind === 'tangent' && c.ids.includes(moving) && c.ids.includes(target)));
  store.redo(); close(snapPoint({ x: contact.point.x + 0.1, y: contact.point.y + 0.1 }, buildSnapTargets(store.getState(), bounds), unit).point, contact.point);
});

function adoptedContact() {
  const fixture = CURVE_CONTACT_CASES[0], result = fixture.setup(), { store, moving } = result;
  const curve = store.getState().sketches.find(c => c.id === moving);
  const contact = snapMovingCurve(curve, store.getState(), bounds, unit, { axis: fixture.axis });
  store.updateSelected({ anchor: contact.anchor, translate: true });
  return { ...result, point: contact.point };
}

test('shared contacts keep 16/24px hysteresis and the exact Shift lock for every guided consumer', () => {
  const { store, point } = adoptedContact(), targets = buildSnapTargets(store.getState(), bounds);
  for (const consumer of [snapPoint, snapDashedPoint]) {
    const at = pixels => ({ x: point.x + pixels / unit, y: point.y });
    const captured = consumer(at(15), targets, unit); assert.equal(captured.kind, 'tangent'); close(captured.point, point);
    const retained = consumer(at(23), targets, unit, { previous: captured });
    assert.equal(retained.kind, 'tangent'); close(retained.point, point);
    assert.notEqual(consumer(at(23), targets, unit)?.kind, 'tangent');
    assert.notEqual(consumer(at(25), targets, unit, { previous: retained })?.kind, 'tangent');
    assert.notEqual(consumer({ x: point.x + 0.1, y: point.y + 0.02 }, targets, unit, { axis: 'x' })?.kind, 'tangent');
  }
  assert.equal(snapDashedPoint(point, targets, unit, { altKey: true }), null);
  assert.equal(snapDashedPoint(point, targets, unit, { enabled: false }), null);
});

test('contact targets disappear after geometry/history/graph changes and obey exclusions and visibility', () => {
  const { store, target, moving, point } = adoptedContact();
  const hasContact = (state, b = bounds, exclude = null) => buildSnapTargets(state, b, exclude).crossings
    .some(c => c.kind === 'tangent' && c.ids.includes(moving) && c.ids.includes(target));
  const state = store.getState(); assert.ok(hasContact(state));
  assert.equal(hasContact(state, { ...bounds, xMin: point.x + 0.01 }), false);
  assert.equal(hasContact({ ...state, axisGapEnabled: true, axisGap: 5 }), false);
  for (const id of [moving, target]) assert.equal(hasContact(state, bounds, id), false);
  store.updateSelected({ anchor: { x: 4, y: 5 }, translate: true }); assert.equal(hasContact(store.getState()), false);
  store.undo(); assert.ok(hasContact(store.getState()));
  store.selectObject(target); store.removeSelected(); assert.equal(hasContact(store.getState()), false);
  store.undo(); assert.ok(hasContact(store.getState()));
  store.configureLayout('horizontal2'); store.selectDiagram(store.getState().diagrams[1].id);
  assert.equal(hasContact(store.getState()), false);
});

test('near misses, ordinary crossings, coincident curves and nonsmooth families never invent tangent points', () => {
  const fixture = CURVE_CONTACT_CASES[0], { store } = fixture.setup();
  const tangencies = state => buildSnapTargets(state, bounds).crossings.filter(c => c.kind === 'tangent');
  assert.deepEqual(tangencies(store.getState()), [], 'a raw near miss is not an existing contact');
  const state = structuredClone(store.getState()), original = state.sketches[0];
  state.sketches[1] = { ...structuredClone(original), id: state.sketches[1].id };
  assert.deepEqual(tangencies(state), [], 'identical strokes have no isolated contact');
  state.sketches[1] = { ...state.sketches[1], tangent: { x: 1, y: 0.7 } };
  assert.deepEqual(tangencies(state), [], 'crossing directions are not tangent');
  for (const family of NON_SMOOTH_CONTACT_FAMILIES) {
    const s = createStore(); s.addIndifference(family); s.addIndifference('ppc');
    assert.deepEqual(tangencies(s.getState()), []);
  }
});
