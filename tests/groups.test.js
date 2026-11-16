import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { canvasPick, outermostGroup, selectionClosure } from '../src/objects.js';
import { interactionFor } from '../src/graph/interactions.js';
import { independentSnapState } from '../src/graph/snap-context.js';
import { createViewport } from '../src/graph/viewport.js';
import { lineEndPoints } from '../src/graph/line-extent.js';
import { groupShortcut } from '../src/tools/selection.js';
import { serializeActive } from './fixtures/document.js';

const close = (a, b, message) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, message ?? `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const viewport = createViewport(800, 600, 'first');

// A kinked demand curve: two rays meeting at (4, 5).
function kinked() {
  const store = createStore();
  const upper = store.addLine({ x: 4, y: 5 }, { x: 0, y: 9 }, { kind: 'ray' });
  const lower = store.addLine({ x: 4, y: 5 }, { x: 9, y: 0 }, { kind: 'ray' });
  const other = store.addLine({ x: 0, y: 2 }, { x: 9, y: 2 });
  store.selectObjects([upper, lower]);
  const group = store.groupSelected();
  return { store, upper, lower, other, group };
}
const lineOf = (store, id) => store.getState().lines.find(line => line.id === id);
const ctxFor = (store, extra = {}) => ({ viewport, state: store.getState(), tangentSnap: null, snapTargets: () => ({ shapes: [], crossings: [] }), ...extra });

test('bundling two rays makes one selected set in place of the first ray, in one undo step', () => {
  const { store, upper, lower, group } = kinked(), state = store.getState();
  assert.deepEqual(state.selectedIds, [group]);
  assert.equal(lineOf(store, upper).parentId, group); assert.equal(lineOf(store, lower).parentId, group);
  assert.ok(state.objectOrder.indexOf(group) < state.objectOrder.indexOf(upper), 'the set takes the place of its first member');
  assert.equal(state.groups[0].name, '묶음 01');
  assert.deepEqual([...selectionClosure(state)].sort(), [group, lower, upper].sort(), 'the whole set is highlighted');
  store.undo();
  assert.equal(store.getState().groups.length, 0); assert.equal(lineOf(store, upper).parentId, null);
});

test('a single shape or a member inside another selected set is not bundled again', () => {
  const store = createStore(), a = store.addLine({ x: 0, y: 1 }, { x: 1, y: 2 });
  store.selectObjects([a]); assert.equal(store.groupSelected(), null);
  const { store: s, group, upper, other } = kinked();
  s.selectObjects([group, upper, other]);
  const outer = s.groupSelected();
  assert.equal(lineOf(s, upper).parentId, group, 'a member keeps its own set');
  assert.equal(s.getState().groups.find(g => g.id === group).parentId, outer);
  assert.equal(outermostGroup(s.getState(), upper).id, outer);
});

test('a canvas click picks the whole set until a member is selected inside it', () => {
  const { store, upper, lower, other, group } = kinked();
  store.selectObject(null);
  assert.equal(canvasPick(store.getState(), upper), group);
  assert.equal(canvasPick(store.getState(), other), other);
  store.selectObject(upper); // a double-click enters the set
  assert.equal(canvasPick(store.getState(), lower), lower, 'inside the set, clicks pick members');
  store.selectObject(other);
  assert.equal(canvasPick(store.getState(), lower), group, 'leaving the set picks it whole again');
});

test('dragging a set translates every member from its snapshot, with Shift and undo', () => {
  const { store, upper, lower, group } = kinked();
  const set = store.getState().groups[0], handler = interactionFor(set), ctx = ctxFor(store);
  assert.equal(handler.canDrag(set, 'move'), true);
  const object = { ...structuredClone(set), ...handler.dragSnapshot(set, ctx) };
  const before = [upper, lower].map(id => lineEndPoints(lineOf(store, id)).find(Boolean));
  store.beginHistory(); store.selectObject(group);
  for (const point of [{ x: 0.5, y: 0.2 }, { x: 1, y: -0.5 }]) store.updateSelected(handler.drag(object, 'move', { x: 0, y: 0 }, point, {}, ctx).patch);
  store.endHistory();
  [upper, lower].forEach((id, i) => close(lineEndPoints(lineOf(store, id)).find(Boolean), { x: before[i].x + 1, y: before[i].y - 0.5 }, 'moves from the snapshot, not cumulatively'));
  assert.equal(lineOf(store, upper).slope, -1);
  const shifted = handler.drag(object, 'move', { x: 0, y: 0 }, { x: 2, y: 0.3 }, { shiftKey: true }, ctx);
  close(shifted.patch.offset, { x: 2, y: 0 });
  store.undo();
  [upper, lower].forEach((id, i) => close(lineEndPoints(lineOf(store, id)).find(Boolean), before[i], 'one undo step'));
  const keyed = handler.keyboard(set, 'move', { key: 'ArrowRight', shiftKey: true }, ctx);
  store.selectObject(group); store.updateSelected(keyed.patch);
  close(lineEndPoints(lineOf(store, upper)).find(Boolean), { x: before[0].x + 1, y: before[0].y });
});

test('a moving set never snaps to its own members but meets shapes outside it', () => {
  const { store, upper, lower, other, group } = kinked();
  const ids = independentSnapState(store.getState(), group).lines.map(line => line.id);
  assert.deepEqual(ids, [other], 'members are excluded from the targets');
  const set = store.getState().groups[0], handler = interactionFor(set);
  const target = { point: { x: 4, y: 2 }, kind: 'point', ids: [other] };
  const ctx = ctxFor(store, { snapTargets: () => ({ shapes: [], crossings: [{ ...target, kind: 'intersection', ids: [other, 'axis-y'] }] }) });
  const object = { ...structuredClone(set), ...handler.dragSnapshot(set, ctx) };
  const result = handler.drag(object, 'move', { x: 0, y: 0 }, { x: 0.03, y: -2.96 }, {}, ctx);
  assert.ok(result.tangentSnap, 'the kink lands on the crossing');
  close(result.patch.offset, { x: 0, y: -3 });
  assert.equal(handler.drag(object, 'move', { x: 0, y: 0 }, { x: 0.03, y: -2.96 }, { altKey: true }, ctx).tangentSnap, null);
  void upper; void lower;
});

test('a free curve tangent to a line in the set moves with it; one on an outside line keeps following that line', () => {
  const store = createStore();
  const line = store.addLine({ x: 0, y: 8 }, { x: 10, y: 0 }), outside = store.addLine({ x: 0, y: 6 }, { x: 6, y: 0 });
  const inner = store.addSketch({ x: 3, y: 9 }, { x: 10, y: 5 }, { x: 6, y: 3.2 }, { lineId: line });
  const follower = store.addSketch({ x: 1, y: 7 }, { x: 7, y: 3 }, { x: 3, y: 3 }, { lineId: outside });
  store.selectObjects([line, inner, follower]);
  const group = store.groupSelected(), set = store.getState().groups[0], handler = interactionFor(set);
  const before = structuredClone(store.getState().sketches);
  store.selectObject(group); store.updateSelected(handler.keyboard(set, 'move', { key: 'ArrowUp', shiftKey: true }, ctxFor(store)).patch);
  const [a, b] = store.getState().sketches;
  close(a.anchor, { x: before[0].anchor.x, y: before[0].anchor.y + 1 }); close(a.start, { x: before[0].start.x, y: before[0].start.y + 1 });
  assert.equal(a.binding.sourceId, line);
  close(b.anchor, before[1].anchor, 'a curve attached outside the set stays on its line'); close(b.start, before[1].start);
});

test('ungroup keeps the members selected in place; deleting a set deletes its members', () => {
  const { store, upper, lower, group } = kinked();
  assert.equal(store.ungroupSelected(), true);
  assert.deepEqual(store.getState().selectedIds.sort(), [lower, upper].sort());
  assert.equal(lineOf(store, upper).parentId, null); assert.equal(store.getState().groups.length, 0);
  store.undo(); store.selectObject(group); store.removeSelected();
  assert.equal(store.getState().lines.length, 1);
  store.undo(); assert.equal(store.getState().lines.length, 3);
});

test('copying a set copies its members and keeps a relation inside the copy', () => {
  const store = createStore();
  const line = store.addLine({ x: 0, y: 8 }, { x: 10, y: 0 });
  const sketch = store.addSketch({ x: 3, y: 9 }, { x: 10, y: 5 }, { x: 6, y: 3.2 }, { lineId: line });
  store.selectObjects([line, sketch]); store.groupSelected();
  const copy = store.duplicateSelected();
  const state = store.getState(), copied = state.sketches.find(s => s.parentId === copy), copiedLine = state.lines.find(l => l.parentId === copy);
  assert.ok(copied && copiedLine, 'members are copied into the new set');
  assert.equal(copied.binding.sourceId, copiedLine.id, 'the copy follows the copied line');
  assert.equal(state.sketches.find(s => s.id === sketch).binding.sourceId, line);
});

test('the JSON keeps the set and its members; the legend explains what a set means', () => {
  const { store, upper, group } = kinked();
  const doc = serializeActive(store.getState());
  assert.equal(doc.groups[0].id, group); assert.equal(doc.lines.find(l => l.id === upper).parentId, group);
  assert.match(doc.legend.groups, /group is a set/);
});

test('Ctrl+G bundles, Ctrl+Shift+G dissolves, and text fields keep their own shortcut', () => {
  const event = extra => ({ key: 'g', ctrlKey: true, target: { closest: () => null }, ...extra });
  assert.equal(groupShortcut(event({}), {}), 'group');
  assert.equal(groupShortcut(event({ key: 'G', shiftKey: true }), {}), 'ungroup');
  assert.equal(groupShortcut(event({ ctrlKey: false }), {}), null);
  assert.equal(groupShortcut(event({ target: { closest: () => ({}) } }), {}), null);
  assert.equal(groupShortcut(event({}), {}, true), null);
});
