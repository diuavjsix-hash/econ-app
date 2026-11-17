import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { relationTolerance, ON_TOLERANCE } from '../src/graph/drawn-relations.js';
import { linkFor, replaceLinks, rolesChangedBy, LINK_TYPES } from '../src/links.js';
import { interactionFor } from '../src/graph/interactions.js';
import { createViewport } from '../src/graph/viewport.js';
import { serializeActive } from './fixtures/document.js';

const bounds = { xMin: 0, xMax: 16, yMin: 0, yMax: 12 }, unit = 45;
const close = (a, b, message) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, message ?? `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
// Like the point tool: shared targets plus the placed points, which come first.
const snapAt = (store, p) => snapPoint(p, buildSnapTargets(store.getState(), bounds), unit, { points: store.getState().points, bounds });
const linksOf = store => serializeActive(store.getState()).links;

// The 2026-11-16 report: a line, a free curve tangent to it, points on the contact and the intercepts.
function report() {
  const store = createStore();
  const line = store.addLine({ x: 0, y: 10.214286 }, { x: 11.857143, y: 0 });
  const l = store.getState().lines[0], touch = { x: 6.07, y: l.anchor.y + l.slope * 6.07 };
  const sketch = store.addSketch({ x: 4.625, y: 10.732143 }, { x: 15.071429, y: 5.303571 }, touch, { lineId: line });
  const contact = snapAt(store, { x: touch.x + 0.03, y: touch.y + 0.02 });
  const point = store.addPoint(contact.point, { snap: contact });
  const onY = snapAt(store, { x: 0.02, y: l.anchor.y + 0.03 }), onX = snapAt(store, { x: 11.857143 + 0.03, y: 0.02 });
  const yPoint = store.addPoint(onY.point, { snap: onY }), xPoint = store.addPoint(onX.point, { snap: onX });
  return { store, line, sketch, point, yPoint, xPoint, contact };
}

test('a point placed with a magnet records what it was aligned to, in the same undo step', () => {
  const { store, line, sketch, point, yPoint, xPoint, contact } = report();
  assert.equal(contact.kind, 'tangent');
  const links = linksOf(store), atContact = links.find(link => link.ids[0] === point);
  assert.deepEqual({ type: atContact.type, role: atContact.role, follow: atContact.follow, status: atContact.status },
    { type: 'tangent', role: 'anchor', follow: false, status: 'holds' });
  assert.deepEqual(atContact.ids.slice(1).sort(), [line, sketch].sort());
  const onAxis = links.find(link => link.ids[0] === yPoint);
  assert.equal(onAxis.type, 'intercept'); assert.ok(onAxis.ids.includes('axis-y') && onAxis.ids.includes(line)); assert.equal(onAxis.status, 'holds');
  assert.ok(links.some(link => link.follow && link.type === 'tangent' && link.ids[0] === sketch), 'the following tangency is listed with them');
  store.undo();
  assert.equal(store.getState().links.some(link => link.ids[0] === xPoint), false, 'undo removes the last point and its link together');
  assert.equal(store.getState().links.some(link => link.ids[0] === point), true);
  assert.equal(store.getState().points.length, 2);
});

test('redrawing the line through the intercept points: links say what was meant and what still holds', () => {
  const { store, line, sketch, point, yPoint, xPoint } = report();
  const onY = snapAt(store, store.getState().points.find(p => p.id === yPoint).anchor), onX = snapAt(store, store.getState().points.find(p => p.id === xPoint).anchor);
  const second = store.addLine(onY.point, onX.point, { snaps: { start: onY, end: onX } });
  store.selectObject(line); store.removeSelected();
  const links = linksOf(store);
  assert.ok(!links.some(link => link.ids.includes(line)), 'links of the deleted line go with it');
  const through = links.filter(link => link.ids[0] === second);
  assert.deepEqual(through.map(link => [link.role, link.type, link.status]).sort(), [['end', 'point', 'holds'], ['start', 'point', 'holds']]);
  // The contact point lost its targets with the old line; the drawing still shows the tangency.
  assert.ok(!links.some(link => link.ids[0] === point));
  const doc = serializeActive(store.getState());
  assert.ok(doc.relations.some(r => r.points?.includes(point) && r.tangent?.some(pair => pair.includes(sketch) && pair.includes(second))), 'relations measure the new contact at the point');
});

test('moving the target breaks a link but keeps it; moving the subject by hand forgets it', () => {
  const { store, sketch, point } = report();
  // The curve slides along its line by 0.05 (the drift of the report, made larger).
  store.selectObject(sketch);
  const s = store.getState().sketches[0];
  store.updateSelected({ anchor: { x: s.anchor.x + 0.05 * 0.757643, y: s.anchor.y - 0.05 * 0.652669 }, translate: true });
  let link = linksOf(store).find(l => l.ids[0] === point);
  assert.equal(link.status, 'broken', 'the point is no longer at the contact');
  close(link.at, store.getState().points.find(p => p.id === point).anchor, 'at is where it was made');
  // The user drags the point away without a magnet: that alignment is no longer meant.
  store.recordSnaps(point, { roles: rolesChangedBy('point', 'move'), snaps: {} });
  assert.ok(!linksOf(store).some(l => l.ids[0] === point));
});

test('re-snapping replaces the role; a set moving together keeps its inner links', () => {
  const store = createStore();
  const a = store.addPoint({ x: 2, y: 2 }), line = store.addLine({ x: 0, y: 2 }, { x: 8, y: 2 });
  const onLine = snapAt(store, { x: 4.02, y: 2.03 });
  const b = store.addPoint(onLine.point, { snap: onLine });
  assert.equal(linksOf(store).find(l => l.ids[0] === b).type, 'on');
  const onA = snapAt(store, { x: 2.01, y: 2.01 });
  store.selectObject(b); store.updateSelected({ anchor: onA.point }); // dragged onto point a
  store.recordSnaps(b, { roles: ['anchor'], snaps: { anchor: onA } });
  assert.deepEqual(store.getState().links.filter(l => l.ids[0] === b).map(l => l.type), ['point'], 'one link per role');
  store.selectObjects([a, b, line]); const group = store.groupSelected();
  const set = store.getState().groups[0], handler = interactionFor(set), viewport = createViewport(800, 600, 'first');
  const ctx = { viewport, state: store.getState(), tangentSnap: null, snapTargets: () => ({ shapes: [], crossings: [] }) };
  store.selectObject(group); store.updateSelected(handler.keyboard(set, 'move', { key: 'ArrowUp', shiftKey: true }, ctx).patch);
  const moving = new Set([a, b, line]);
  for (const id of moving) store.recordSnaps(id, { moving });
  const link = linksOf(store).find(l => l.ids[0] === b);
  assert.equal(link.type, 'point'); assert.equal(link.status, 'holds', 'aligned to a point that moved with it');
});

test('the line tool records a Shift tangent lock as touching that curve', () => {
  const store = createStore();
  const curve = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' });
  const lock = { point: { x: 4, y: 2 }, kind: 'tangent', ids: [curve] };
  const line = store.addLine({ x: 4, y: 2 }, { x: 8, y: 2 }, { snaps: { start: null, end: null, shape: lock } });
  const link = linksOf(store).find(l => l.ids[0] === line);
  assert.deepEqual([link.type, link.role, link.status], ['tangent', 'shape', 'holds']);
});

test('the on-tolerance scales with the drawing, so a graph in the thousands reads alike', () => {
  const small = createStore(); small.addLine({ x: 0, y: 10 }, { x: 10, y: 0 });
  assert.equal(relationTolerance(small.getState()), ON_TOLERANCE);
  const big = createStore();
  const line = big.addLine({ x: 0, y: 10000 }, { x: 10000, y: 0 });
  const p = big.addPoint({ x: 5000, y: 5000 + 0.5 }); // half a unit off a line 10,000 wide
  assert.equal(relationTolerance(big.getState()), ON_TOLERANCE * 1000);
  assert.ok(serializeActive(big.getState()).relations.some(r => r.points?.includes(p) && r.on.includes(line)), 'within the scaled tolerance');
  const off = createStore(); const l2 = off.addLine({ x: 0, y: 8 }, { x: 10, y: 0 }); const q = off.addPoint({ x: 5, y: 4.01 });
  assert.ok(!serializeActive(off.getState()).relations.some(r => r.points?.includes(q) && r.on.includes(l2)), 'a visible gap on a normal graph is not "on"');
});

test('link records are plain typed data with one shape for every kind', () => {
  for (const kind of ['intersection', 'tangent', 'intercept', 'endpoint', 'kink', 'minimum', 'point', 'shape']) {
    const link = linkFor('link-1', 'point-1', 'anchor', { kind, point: { x: 1, y: 2 }, ids: ['line-1', 'point-1'] });
    assert.deepEqual(Object.keys(link), ['id', 'type', 'role', 'ids', 'at']); assert.ok(LINK_TYPES.includes(link.type));
    assert.deepEqual(link.ids, ['point-1', 'line-1'], 'the subject is first and never its own target');
  }
  assert.equal(linkFor('link-1', 'point-1', 'anchor', { kind: 'free', point: { x: 1, y: 2 } }), null);
  assert.equal(linkFor('link-1', 'point-1', 'anchor', { kind: 'direction', point: { x: 1, y: 2 }, ids: [] }), null);
  const kept = replaceLinks([{ id: 'a', ids: ['line-1', 'axis-y'], role: 'start' }, { id: 'b', ids: ['line-1', 'point-2'], role: 'end' }], 'line-1', rolesChangedBy('line', 'line-to'));
  assert.deepEqual(kept.map(l => l.id), ['a'], 'dragging one end forgets only that end');
});

test('a free curve drawn touching a line records the contact and stays put when the line moves', async () => {
  const { snapSketchTangent } = await import('../src/graph/sketch-magnets.js');
  const { directionOf } = await import('../src/graph/math.js');
  const store = createStore(), line = store.addLine({ x: 0, y: 8 }, { x: 8, y: 0 });
  const target = snapSketchTangent({ x: 4.05, y: 4.02 }, store.getState(), bounds, unit);
  assert.equal(target.kind, 'tangent');
  const sketch = store.addSketch({ x: 1, y: 1 }, { x: 9, y: 3 }, target.point, { tangent: directionOf(target.line.slope), snaps: { anchor: target } });
  const curve = () => store.getState().sketches.find(c => c.id === sketch);
  assert.equal(curve().binding, null, 'no following relation');
  const link = linksOf(store).find(l => l.ids[0] === sketch);
  assert.deepEqual({ type: link.type, role: link.role, follow: link.follow, status: link.status, ids: link.ids }, { type: 'tangent', role: 'anchor', follow: false, status: 'holds', ids: [sketch, line] });
  const before = structuredClone(curve());
  store.selectObject(line); store.updateSelected({ anchor: { x: 1, y: 8 } });
  assert.deepEqual(curve(), before, 'moving the line leaves the curve where it was drawn');
  assert.equal(linksOf(store).find(l => l.ids[0] === sketch).status, 'broken');
});
