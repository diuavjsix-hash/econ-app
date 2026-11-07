import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';
import { contactTangentSlope, contactTangentsAt, slopeOfDirection } from '../src/graph/curve-contacts.js';
import { interactionFor } from '../src/graph/interactions.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { createViewport } from '../src/graph/viewport.js';
import { CURVE_CONTACT_CASES } from './fixtures/curve-contact-cases.js';

const bounds = { xMin: 0, xMax: 12, yMin: 0, yMax: 12 }, unit = 50;
const viewport = { ...createViewport(600, 600, 'first'), bounds, unit };
const sameSlope = (a, b) => {
  if (a === null || b === null) return assert.equal(a, b);
  assert.ok(Math.abs(Math.atan(a) - Math.atan(b)) < 1e-6, `${a} != ${b}`);
};
const directionOf = slope => slope === null ? { x: 0, y: 1 } : { x: 1 / Math.hypot(1, slope), y: slope / Math.hypot(1, slope) };
const ctxFor = (state, tangentSnap = null) => ({ state, viewport, tangentSnap, snapTargets: () => buildSnapTargets(state, bounds) });
// A pointer `along` pixels down the tangent from the pivot and `across` pixels off it.
const pointerAt = (pivot, slope, along, across) => {
  const d = directionOf(slope);
  return { x: pivot.x + (d.x * along - d.y * across) / unit, y: pivot.y + (d.y * along + d.x * across) / unit };
};

function touchingCase(fixture) {
  const { store, target, moving } = fixture.setup(), state = store.getState();
  const curve = [...state.curves, ...state.sketches].find(c => c.id === moving);
  const contact = snapMovingCurve(curve, state, bounds, unit, { axis: fixture.axis });
  store.selectObject(moving); store.updateSelected({ anchor: contact.anchor, translate: true });
  return { store, target, moving, contact };
}
function verticalContact() {
  // Two sketches meeting at (4,4) with a vertical shared tangent, opening away from each other.
  const store = createStore();
  const right = store.addSketch({ x: 6, y: 1 }, { x: 6, y: 7 }, { x: 4, y: 4 }, { tangent: { x: 0, y: 1 } });
  const left = store.addSketch({ x: 2, y: 1 }, { x: 2, y: 7 }, { x: 4, y: 4 }, { tangent: { x: 0, y: 1 } });
  return { store, ids: [right, left], point: { x: 4, y: 4 } };
}

for (const fixture of CURVE_CONTACT_CASES) test(`a line through a contact point starts on and snaps back to the common tangent: ${fixture.name}`, () => {
  const { store, target, moving, contact } = touchingCase(fixture);
  const found = contactTangentSlope(store.getState(), bounds, contact.point);
  assert.ok(found, 'the contact reports its shared tangent');
  assert.deepEqual(new Set(found.ids), new Set([target, moving]));
  if (contact.tangent) sameSlope(found.slope, slopeOfDirection(contact.tangent));

  // Point magnet → point → the existing "line through this point" action.
  const targets = buildSnapTargets(store.getState(), bounds);
  const snapped = snapPoint({ x: contact.point.x + 0.1, y: contact.point.y + 0.05 }, targets, unit);
  assert.equal(snapped.kind, 'tangent');
  const point = store.addPoint(snapped.point);
  store.selectObject(point);
  const lineId = store.lineThroughSelectedPoint({ slope: contactTangentSlope(store.getState(), bounds, snapped.point).slope });
  const line = store.getState().lines.find(l => l.id === lineId);
  sameSlope(line.slope, found.slope);
  assert.deepEqual(line.binding, { kind: 'through-point', sourceId: point }, 'the line follows the point, not the contact');

  // Rotating away and back: 16px capture, 24px hold, release beyond it, Alt bypass.
  const handler = interactionFor(line), state = store.getState(), free = { ...line, slope: 5 };
  const captured = handler.drag(free, 'rotate', free.anchor, pointerAt(line.anchor, found.slope, 90, 12), {}, ctxFor(state)).tangentSnap;
  assert.equal(captured?.kind, 'tangent'); assert.equal(snapFeedbackModel(captured).label, '접선 맞춤');
  assert.deepEqual(new Set(captured.ids), new Set([target, moving]));
  sameSlope(captured.rotation.slope, found.slope);
  const held = handler.drag(free, 'rotate', free.anchor, pointerAt(line.anchor, found.slope, 90, 20), {}, ctxFor(state, captured));
  assert.equal(held.tangentSnap?.key, captured.key, 'held within the shared 24px release');
  sameSlope(held.patch.slope, found.slope);
  assert.equal(handler.drag(free, 'rotate', free.anchor, pointerAt(line.anchor, found.slope, 90, 30), {}, ctxFor(state, captured)).tangentSnap, null);
  assert.equal(handler.drag(free, 'rotate', free.anchor, pointerAt(line.anchor, found.slope, 90, 4), { altKey: true }, ctxFor(state)).tangentSnap, null);
  assert.equal(handler.drag(free, 'rotate', free.anchor, pointerAt(line.anchor, found.slope, 12, 1), {}, ctxFor(state)).tangentSnap, null, 'no direction next to the pivot');
});

test('a vertical common tangent is stored as a null slope and remains a rotation target', () => {
  const { store, ids, point } = verticalContact();
  const found = contactTangentSlope(store.getState(), bounds, point);
  assert.ok(found); assert.equal(found.slope, null); assert.deepEqual(new Set(found.ids), new Set(ids));
  store.selectObject(store.addPoint(point));
  const lineId = store.lineThroughSelectedPoint({ slope: found.slope }), line = store.getState().lines.find(l => l.id === lineId);
  assert.equal(line.slope, null);
  const result = interactionFor(line).drag({ ...line, slope: 1 }, 'rotate', line.anchor, pointerAt(point, null, 90, 10), {}, ctxFor(store.getState()));
  assert.equal(result.tangentSnap?.kind, 'tangent'); assert.equal(result.patch.slope, null);
});

test('a plain point, a single curve point and a kink keep the default slope and no rotation magnet', () => {
  const store = createStore();
  store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' });
  const kink = store.addIndifference('complements', { anchor: { x: 3, y: 3 } });
  store.addIndifference('cobb-douglas', { anchor: { x: 3, y: 3 } });
  const state = store.getState(), kinkPoint = state.curves.find(c => c.id === kink).anchor;
  for (const point of [{ x: 9, y: 9 }, { x: 4, y: 2 }, kinkPoint]) assert.equal(contactTangentSlope(state, bounds, point), null, JSON.stringify(point));
  assert.equal(contactTangentsAt(buildSnapTargets(state, bounds).crossings, kinkPoint).length, 0, 'a kink has no single tangent');
  store.selectObject(store.addPoint({ x: 4, y: 2 }));
  const lineId = store.lineThroughSelectedPoint(), line = store.getState().lines.find(l => l.id === lineId);
  assert.equal(line.slope, 1);
  const result = interactionFor(line).drag(line, 'rotate', line.anchor, { x: 6, y: 2.1 }, {}, ctxFor(store.getState()));
  assert.equal(result.tangentSnap, null);
});

test('only a contact at the rotation pivot is a rotation magnet', () => {
  const { store, point } = verticalContact();
  store.addLine(); store.selectObject(store.getState().lines[0].id); store.updateSelected({ anchor: { x: 4, y: 6 }, slope: null });
  const line = store.getState().lines[0];
  // The line already passes through the contact, but its pivot is elsewhere.
  const result = interactionFor(line).drag({ ...line, slope: 3 }, 'rotate', line.anchor, pointerAt(point, null, 90, 2), {}, ctxFor(store.getState()));
  assert.equal(result.tangentSnap, null);
  const pivoted = { ...line, anchor: point, slope: 3 };
  assert.equal(interactionFor(line).drag(pivoted, 'rotate', point, pointerAt(point, null, 90, 2), {}, ctxFor(store.getState())).tangentSnap?.kind, 'tangent');
});
