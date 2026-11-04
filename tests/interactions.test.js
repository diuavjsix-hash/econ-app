import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionFor, ShapeInteraction, assertInteractionHandlers, INTERACTION_HANDLERS } from '../src/graph/interactions.js';
import { createViewport } from '../src/graph/viewport.js';
import { CURVE_FAMILIES } from '../src/models/curve-families.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const viewport = createViewport(800, 600, 'first');
const ctx = { viewport, state: { lines: [], curves: [], sketches: [], sums: [], points: [], dashedLines: [], axisGapEnabled: false },
  tangentSnap: null, snappedMove: anchor => anchor, dashedPosition: anchor => anchor, dashedTargets: () => ({ shapes: [], crossings: [] }), dashedOptions: () => ({ altKey: true }) };
const point = { id: 'point-1', type: 'point', anchor: { x: 2, y: 3 } };

test('new tool registrations fail early when an object or keyboard implementation is missing', () => {
  class Incomplete extends ShapeInteraction { drag() { return null; } }
  const missing = { ...INTERACTION_HANDLERS }; delete missing.point;
  assert.throws(() => assertInteractionHandlers(missing), /must register/);
  assert.throws(() => assertInteractionHandlers({ ...INTERACTION_HANDLERS, point: new Incomplete() }), /must implement keyboard/);
  class InvalidMethod extends ShapeInteraction { drag() { return null; } keyboard = null; }
  assert.throws(() => assertInteractionHandlers({ ...INTERACTION_HANDLERS, point: new InvalidMethod() }), /must implement keyboard/);
});

test('pointer and keyboard handlers share axis directions without mutating a drag snapshot', () => {
  assert.throws(() => new ShapeInteraction(), /abstract/);
  assert.throws(() => interactionFor({ type: 'unknown' }), /Missing interaction/);
  const handler = interactionFor(point), before = structuredClone(point);
  const result = handler.drag(point, 'move', { x: 2, y: 3 }, { x: 4, y: 3.1 }, { shiftKey: true }, ctx);
  assert.deepEqual(result.patch.anchor, { x: 4, y: 3 }); assert.deepEqual(point, before);
  const moved = handler.keyboard(point, 'move', { key: 'ArrowRight' }, { ...ctx, viewport: { ...viewport, xDirection: -1 } });
  close(moved.patch.anchor.x, 1.9); close(moved.patch.anchor.y, 3);
});

test('line controllers preserve vertical null and use the same Shift movement and rotation limits', () => {
  const line = { id: 'line-1', type: 'line', slope: -1, anchor: { x: 3, y: 3 } }, handler = interactionFor(line);
  assert.equal(handler.drag(line, 'rotate', line.anchor, { x: 3, y: 5 }, {}, ctx).patch.slope, null);
  assert.equal(handler.canDrag({ ...line, binding: { kind: 'through-point' } }, 'move'), false);
  const result = handler.drag(line, 'move', line.anchor, { x: 4, y: 3.1 }, { shiftKey: true, altKey: true }, ctx);
  close(result.patch.anchor.x, 4); close(result.patch.anchor.y, 3);
  const rotated = handler.keyboard({ ...line, slope: null }, 'rotate', { key: 'ArrowRight', shiftKey: true }, ctx);
  assert.ok(Number.isFinite(rotated.patch.slope));
});

test('dashed body moves preserve both endpoints and endpoint editing preserves the Shift lock', () => {
  const segment = { id: 'dashed-1', type: 'dashed', anchor: { x: 2, y: 3 }, end: { x: 5, y: 6 } }, handler = interactionFor(segment);
  const body = handler.drag(segment, 'move', segment.anchor, { x: 3, y: 3.2 }, { shiftKey: true }, ctx).patch;
  close(body.end.x - body.anchor.x, 3); close(body.end.y - body.anchor.y, 3); close(body.anchor.y, 3);
  const endpoint = handler.drag(segment, 'end', segment.end, { x: 6, y: 6.1 }, { shiftKey: true }, ctx).patch;
  close(endpoint.end.x, 6); close(endpoint.end.y, 6);
});

test('analytic keyboard and drag shape handlers share family geometry and PPC endpoint limits', () => {
  for (const family of Object.keys(CURVE_FAMILIES)) {
    const curve = { id: 'curve-1', type: 'curve', family, anchor: { x: 3, y: 4 }, shape: 1, linearAxis: 'y' }, handler = interactionFor(curve);
    const patch = handler.keyboard(curve, 'ic-shape', { key: 'ArrowRight' }, ctx).patch;
    assert.ok(patch.anchor || Number.isFinite(patch.shape));
    const drag = handler.drag(curve, 'move', curve.anchor, { x: 4, y: 5 }, { altKey: true, shiftKey: true }, ctx).patch;
    if (CURVE_FAMILIES[family].radial) close(drag.anchor.x / curve.anchor.x, drag.anchor.y / curve.anchor.y);
  }
  const ppc = { id: 'curve-1', type: 'curve', family: 'ppc', anchor: { x: 3, y: 4 }, shape: 1 };
  const patch = interactionFor(ppc).drag(ppc, 'ppc-x', ppc.anchor, { x: -10, y: 10 }, {}, ctx).patch;
  close(patch.anchor.x * Math.SQRT2, 0.1); close(patch.anchor.y, 4);
});

test('bound free-curve gestures keep line constraints and selection-only objects never start movement', () => {
  const curve = { id: 'sketch-1', type: 'sketch', start: { x: 1, y: 6 }, end: { x: 7, y: 6 }, anchor: { x: 4, y: 4 }, tangent: { x: 1, y: 0 }, leftReach: 0.5, rightReach: 0.5, binding: { sourceId: 'line-1' } };
  const state = { ...ctx.state, lines: [{ id: 'line-1', type: 'line', slope: 1, anchor: { x: 4, y: 4 } }] };
  const result = interactionFor(curve).drag(curve, 'move', curve.anchor, { x: 5, y: 4.1 }, { shiftKey: true }, { ...ctx, state });
  assert.deepEqual(result.patch.anchor, curve.anchor); assert.equal(result.patch.translate, true);
  for (const type of ['sum', 'group', 'ruler']) {
    const handler = interactionFor({ type }); assert.equal(handler.canDrag({}, 'move'), false); assert.equal(handler.keyboard({}, 'move', {}, ctx), null);
  }
});
