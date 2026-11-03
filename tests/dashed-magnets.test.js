import test from 'node:test';
import assert from 'node:assert/strict';
import { snapDashedPoint, snapMovingDashed } from '../src/graph/dashed-magnets.js';
import { buildSnapTargets } from '../src/graph/snap.js';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';

const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, unit = 50;
const empty = { lines: [], curves: [], sketches: [], sums: [], points: [], dashedLines: [], axisGapEnabled: false };
const line = (id, slope, anchor) => ({ id, type: 'line', slope, anchor });
const targets = (...lines) => buildSnapTargets({ ...empty, lines }, bounds);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('Shift drawing finds the actual oblique-line crossing instead of projecting then constraining', () => {
  const target = targets(line('line-1', -1, { x: 5, y: 4 }));
  const result = snapDashedPoint({ x: 4.72, y: 4 }, target, unit, { axis: 'x', bounds });
  assert.deepEqual(result.point, { x: 5, y: 4 });
  const vertical = snapDashedPoint({ x: 5, y: 3.72 }, target, unit, { axis: 'y', bounds });
  assert.deepEqual(vertical.point, { x: 5, y: 4 });
});

test('capture is 16 screen pixels, retained target releases after 24 pixels', () => {
  const target = targets(line('vertical', null, { x: 5, y: 4 }));
  const first = snapDashedPoint({ x: 4.7, y: 4 }, target, unit, { axis: 'x' });
  assert.ok(first);
  assert.equal(snapDashedPoint({ x: 4.6, y: 4 }, target, unit, { axis: 'x' }), null);
  assert.ok(snapDashedPoint({ x: 4.6, y: 4 }, target, unit, { axis: 'x', previous: first }));
  assert.equal(snapDashedPoint({ x: 4.5, y: 4 }, target, unit, { axis: 'x', previous: first }), null);
});

test('hysteresis resists neighboring lines and Alt or disabled snapping clears it', () => {
  const target = targets(line('first', null, { x: 5, y: 0 }), line('second', null, { x: 5.4, y: 0 }));
  const first = snapDashedPoint({ x: 4.9, y: 4 }, target, unit, { axis: 'x' });
  const options = { axis: 'x', previous: first };
  assert.deepEqual(snapDashedPoint({ x: 5.3, y: 4 }, target, unit, options).ids, ['first']);
  assert.equal(snapDashedPoint({ x: 5.3, y: 4 }, target, unit, { ...options, altKey: true }), null);
  assert.equal(snapDashedPoint({ x: 5.3, y: 4 }, target, unit, { ...options, enabled: false }), null);
  assert.deepEqual(snapDashedPoint({ x: 5.3, y: 4 }, target, unit, { axis: 'x' }).ids, ['second']);
});

test('parallel inaccessible lines cannot pull the locked coordinate', () => {
  const target = targets(line('horizontal', 0, { x: 0, y: 4.1 }));
  assert.equal(snapDashedPoint({ x: 5, y: 4 }, target, unit, { axis: 'x' }), null);
  const coincident = snapDashedPoint({ x: 5, y: 4.1 }, target, unit, { axis: 'x' });
  assert.deepEqual(coincident.point, { x: 5, y: 4.1 });
});

test('vertical, horizontal and nearly parallel lines use true geometry and correction distance', () => {
  assert.deepEqual(snapDashedPoint({ x: 4.8, y: 4 }, targets(line('v', null, { x: 5, y: 0 })), unit, { axis: 'x' }).point, { x: 5, y: 4 });
  assert.deepEqual(snapDashedPoint({ x: 5, y: 3.8 }, targets(line('h', 0, { x: 0, y: 4 })), unit, { axis: 'y' }).point, { x: 5, y: 4 });
  assert.equal(snapDashedPoint({ x: 4, y: 4 }, targets(line('flat', 0.001, { x: 8, y: 4 })), unit, { axis: 'x' }), null);
});

test('placed points have priority but cannot displace a Shift locked coordinate', () => {
  const target = targets(line('v', null, { x: 5, y: 0 }));
  const options = { axis: 'x', points: [{ id: 'point-1', anchor: { x: 4.9, y: 4 } }], bounds };
  assert.equal(snapDashedPoint({ x: 4.8, y: 4 }, target, unit, options).kind, 'point');
  assert.equal(snapDashedPoint({ x: 4.8, y: 4.05 }, target, unit, options).kind, 'shape');
  assert.equal(snapDashedPoint({ x: 4.8, y: 4 }, target, unit, { ...options, points: [{ id: 'outside', anchor: { x: 11, y: 4 } }] }).kind, 'shape');
});

test('crossings retain priority and off-axis crossings fall back to the allowed shape intersection', () => {
  const target = targets(line('v', null, { x: 5, y: 0 }), line('h', 0, { x: 0, y: 4 }));
  assert.equal(snapDashedPoint({ x: 4.8, y: 4 }, target, unit, { axis: 'x' }).kind, 'intersection');
  assert.deepEqual(snapDashedPoint({ x: 4.8, y: 4.1 }, target, unit, { axis: 'x' }).point, { x: 5, y: 4.1 });
});

test('sliding along an axis or coincident stroke still captures an approaching crossing or point', () => {
  const target = targets(line('v', null, { x: 5, y: 0 }));
  const previous = snapDashedPoint({ x: 4, y: 0 }, target, unit, { axis: 'x' });
  assert.equal(previous.kind, 'shape');
  const crossing = snapDashedPoint({ x: 4.8, y: 0 }, target, unit, { axis: 'x', previous });
  assert.equal(crossing.kind, 'intercept'); assert.deepEqual(crossing.point, { x: 5, y: 0 });
  const point = snapDashedPoint({ x: 4.8, y: 0 }, target, unit, { axis: 'x', previous, points: [{ id: 'p', anchor: { x: 4.9, y: 0 } }] });
  assert.equal(point.kind, 'point');
});

test('finite dashed targets and axis-gap clipping do not create phantom extensions', () => {
  const state = { ...empty, dashedLines: [{ id: 'self', anchor: { x: 1, y: 2 }, end: { x: 4, y: 2 } }] };
  assert.equal(snapDashedPoint({ x: 6, y: 2.1 }, buildSnapTargets(state, bounds), unit), null);
  assert.equal(snapDashedPoint({ x: 3, y: 2.1 }, buildSnapTargets(state, bounds, 'self'), unit), null);
  const gapped = { ...empty, axisGapEnabled: true, axisGap: 1, lines: [line('v', null, { x: 5, y: 0 })] };
  assert.equal(snapDashedPoint({ x: 4.8, y: 0.5 }, buildSnapTargets(gapped, bounds), unit, { axis: 'x' }), null);
});

test('quadratic curves intersect the locked coordinate exactly', () => {
  const curve = { id: 'curve-1', type: 'curve', anchor: { x: 5, y: 4 }, slope: -1, span: 2, bend: 0.2 };
  const target = buildSnapTargets({ ...empty, curves: [curve] }, bounds);
  const result = snapDashedPoint({ x: 4.8, y: 4 }, target, unit, { axis: 'x' });
  close(result.point.x, 5); assert.equal(result.point.y, 4);
});

test('whole movement snaps either endpoint while preserving length, angle and Shift lock', () => {
  const target = targets(line('v', null, { x: 5, y: 0 }));
  const segment = { anchor: { x: 1.8, y: 3 }, end: { x: 4.8, y: 4 } };
  const result = snapMovingDashed(segment, target, unit, { axis: 'x', bounds });
  assert.equal(result.endpoint, 'end'); assert.equal(result.geometry.end.x, 5);
  assert.equal(result.geometry.anchor.y, 3); assert.equal(result.geometry.end.y, 4);
  close(result.geometry.end.x - result.geometry.anchor.x, 3);
  assert.equal(segment.end.x, 4.8);
  const start = snapMovingDashed({ anchor: { x: 4.8, y: 3 }, end: { x: 7.8, y: 4 } }, target, unit, { axis: 'x', bounds });
  assert.equal(start.endpoint, 'anchor');
});

test('whole-movement magnets respect bounds, Alt, settings and endpoint-specific retention', () => {
  const target = targets(line('v', null, { x: 5, y: 0 })), segment = { anchor: { x: 4.8, y: 3 }, end: { x: 9.9, y: 4 } };
  assert.equal(snapMovingDashed(segment, target, unit, { axis: 'x', bounds }), null);
  const valid = { anchor: { x: 1.8, y: 3 }, end: { x: 4.8, y: 4 } };
  const first = snapMovingDashed(valid, target, unit, { axis: 'x', bounds });
  assert.equal(snapMovingDashed(valid, target, unit, { previous: first, altKey: true }), null);
  assert.equal(snapMovingDashed(valid, target, unit, { enabled: false }), null);
  assert.ok(snapMovingDashed({ anchor: { x: 1.6, y: 3 }, end: { x: 4.6, y: 4 } }, target, unit, { axis: 'x', bounds, previous: first }));
});

test('screen radius and exact mathematical coordinates survive zoom and reversed axes', () => {
  for (const flipX of [false, true]) for (const flipY of [false, true]) for (const size of [[800, 600], [390, 500]]) {
    const viewport = createViewport(...size, 'first', { flipX, flipY });
    const x = viewport.bounds.xMax / 2, y = viewport.bounds.yMax / 2;
    const screen = toScreen({ x: x - 15 / viewport.unit, y }, viewport);
    const raw = toWorld(screen, viewport);
    const result = snapDashedPoint(raw, buildSnapTargets({ ...empty, lines: [line('v', null, { x, y })] }, viewport.bounds), viewport.unit, { axis: 'x' });
    close(result.point.x, x); close(result.point.y, y);
  }
});

test('snapped drag records once and leaves the source point, line and JSON schema unchanged', () => {
  const store = createStore(), lineId = store.addLine();
  store.updateSelected({ slope: null, anchor: { x: 5, y: 4 } });
  store.addPoint({ x: 1, y: 3 });
  const dashedId = store.addDashedLine({ x: 1, y: 3 }, { x: 3, y: 3 });
  const before = serializeDocument(store.getState());
  const target = buildSnapTargets(store.getState(), bounds, dashedId);
  store.beginHistory();
  for (const x of [4.7, 4.8, 4.9]) {
    const snapped = snapDashedPoint({ x, y: 3 }, target, unit, { axis: 'x' });
    store.updateSelected({ end: snapped.point });
  }
  store.endHistory();
  const after = serializeDocument(store.getState());
  assert.equal(after.schemaVersion, 10); assert.deepEqual(after.points, before.points);
  assert.deepEqual(after.lines.find(line => line.id === lineId), before.lines.find(line => line.id === lineId));
  assert.deepEqual(after.dashedLines[0].end, { x: 5, y: 3 });
  assert.equal('binding' in after.dashedLines[0], false);
  store.undo(); assert.deepEqual(serializeDocument(store.getState()), before);
  store.redo(); assert.deepEqual(serializeDocument(store.getState()), after);
});
