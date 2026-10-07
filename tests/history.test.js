import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';

test('undo and redo restore mixed objects and disable when their stacks are empty', () => {
  const store = createStore();
  assert.equal(store.getState().canUndo, false);
  assert.equal(store.undo(), false);
  assert.equal(store.redo(), false);
  const line = store.addLine();
  const curve = store.addCurve();
  const point = store.addPoint({ x: 1.234567, y: -2 });
  const folder = store.addGroup();
  const original = serializeDocument(store.getState());
  for (let i = 0; i < 4; i++) assert.equal(store.undo(), true);
  assert.equal(store.getState().canUndo, false);
  assert.deepEqual(store.getState().objectOrder, []);
  assert.equal(store.getState().canRedo, true);
  for (let i = 0; i < 4; i++) assert.equal(store.redo(), true);
  assert.deepEqual(serializeDocument(store.getState()), original);
  assert.deepEqual(store.getState().objectOrder, [line, curve, point, folder]);
  assert.equal(store.getState().selectedId, folder);
  assert.equal(store.getState().canRedo, false);
});

test('one gesture restores movement, shape, names and guides in one step', () => {
  const store = createStore();
  store.addCurve();
  const original = store.getState().curves[0];
  store.beginHistory();
  for (let i = 1; i <= 20; i++) store.updateSelected({ anchor: { x: i / 3, y: i / 7 }, bend: i / 100, name: `curve ${i}` });
  const final = store.getState().curves[0];
  store.endHistory();
  store.undo();
  assert.deepEqual(store.getState().curves[0], original);
  store.redo();
  assert.deepEqual(store.getState().curves[0], final);
  store.undo();
  store.undo();
  assert.equal(store.getState().curves.length, 0);
});

test('clear all is reversible and retains axes, viewport and mouse preferences', () => {
  const store = createStore();
  store.update({ axisNames: { x: 'Q', y: 'P' }, quadrantMode: 'all', showGrid: false, pointCoordinates: true });
  const line = store.addLine();
  const point = store.addPoint({ x: -2, y: 3 });
  store.updateSelected({ guides: { vertical: 'dashed' }, showCoordinates: true });
  const folder = store.addGroup();
  store.moveObject(line, folder);
  store.moveObject(point, line);
  store.update({ mouseSelected: true, activeTool: 'point', pointSnap: true });
  const original = serializeDocument(store.getState());
  store.clearAll();
  assert.deepEqual(store.getState().objectOrder, []);
  assert.equal(store.getState().mouseSelected, true);
  assert.equal(store.getState().pointSnap, true);
  assert.equal(store.getState().quadrantMode, 'all');
  assert.deepEqual(store.getState().axisNames, { x: 'Q', y: 'P' });
  store.undo();
  assert.deepEqual(serializeDocument(store.getState()), original);
  store.redo();
  assert.deepEqual(store.getState().objectOrder, []);
  assert.equal(store.clearAll(), false);
});

test('hierarchy and parent deletion restore precisely while UI selection adds no history', () => {
  const store = createStore();
  const parent = store.addLine();
  const child = store.addPoint({ x: 2, y: 2 });
  store.moveObject(child, parent);
  store.selectObject(parent);
  store.removeSelected();
  assert.equal(store.getState().points[0].parentId, null);
  store.undo();
  assert.equal(store.getState().points[0].parentId, parent);
  assert.equal(store.getState().selectedId, parent);
  store.selectObject(child);
  store.toggleCollapsed(parent);
  store.update({ mouseSelected: true, pointSnap: true, pointCoordinates: true });
  assert.equal(store.getState().canRedo, true);
  store.redo();
  assert.equal(store.getState().lines.length, 0);
  assert.equal(store.getState().mouseSelected, true);
});

test('new edits invalidate redo and IDs never repeat after undo', () => {
  const store = createStore();
  const old = store.addLine();
  store.undo();
  store.selectObject(null);
  store.updateSelected({ name: 'no selection' });
  assert.equal(store.getState().canRedo, true);
  const fresh = store.addLine();
  assert.notEqual(fresh, old);
  assert.equal(store.getState().canRedo, false);
  assert.equal(store.redo(), false);
  store.updateSelected({ slope: store.getState().lines[0].slope });
  store.undo();
  assert.equal(store.getState().lines.length, 0, 'a no-op shape edit does not add history');
});

test('viewport, axis names and grid restore, and undo closes a pending gesture', () => {
  const store = createStore();
  store.update({ quadrantMode: 'all', axisNames: { x: 'Q' }, showGrid: false });
  store.beginHistory();
  store.update({ axisNames: { x: 'quantity' } });
  store.undo();
  assert.equal(store.getState().axisNames.x, 'Q');
  store.undo();
  assert.equal(store.getState().quadrantMode, 'first');
  assert.equal(store.getState().showGrid, true);
  assert.equal(store.getState().axisNames.x, 'x');
  store.redo();
  assert.equal(store.getState().quadrantMode, 'all');
});

test('history is bounded and mouse selection controls the cursor independently of snapping', () => {
  const store = createStore();
  store.update({ mouseSelected: true });
  assert.equal(store.getState().pointSnap, false);
  assert.equal(store.getState().canUndo, false);
  store.addLine();
  assert.equal(store.getState().mouseSelected, false);
  for (let i = 0; i < 110; i++) store.updateSelected({ name: String(i) });
  let count = 0;
  while (store.undo()) count++;
  assert.equal(count, 100);
  assert.equal('canUndo' in serializeDocument(store.getState()), false);
});
