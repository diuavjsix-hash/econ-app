import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { canReparent, objectsOf } from '../src/objects.js';
import { pointGuides, pointCoordinatesLabel } from '../src/graph/point.js';
import { createViewport } from '../src/graph/viewport.js';
import { serializeDocument } from '../src/export.js';

test('curve directions change independently of custom names and hierarchy', () => {
  const store = createStore();
  const line = store.addLine();
  store.updateSelected({ name: '수요곡선' });
  const curve = store.addCurve();
  store.updateSelected({ name: '보조 곡선' });
  store.moveObject(curve, line);
  store.updateSelected({ variant: 'ascending' });
  let object = store.getState().curves[0];
  assert.equal(object.variant, 'ascending');
  assert.equal(object.slope, 0.75);
  assert.equal(object.name, '보조 곡선');
  assert.equal(object.parentId, line);
  store.updateSelected({ variant: 'descending' });
  assert.equal(store.getState().curves[0].slope, -0.75);
  assert.equal(store.getState().lines[0].name, '수요곡선');
});

test('points preserve internal coordinates and edit names and guides without affecting other objects', () => {
  const store = createStore();
  const line = store.addLine();
  const originalLine = store.getState().lines[0];
  store.update({ activeTool: 'point' });
  const first = store.addPoint({ x: -2, y: 3 });
  const second = store.addPoint({ x: 4, y: 5 });
  assert.equal(store.getState().activeTool, 'point');
  store.selectObject(first);
  store.updateSelected({ name: '균형점 E', anchor: { x: 1.25, y: -3 }, guides: { horizontal: 'dashed' } });
  store.updateSelected({ guides: { vertical: 'solid', extent: 'full' } });
  store.update({ quadrantMode: 'all' });
  const state = store.getState();
  assert.deepEqual(state.points[0].anchor, { x: 1.25, y: -3 });
  assert.equal(state.points[0].name, '균형점 E');
  assert.deepEqual(state.points[0].guides, { horizontal: 'dashed', vertical: 'solid', extent: 'full' });
  assert.deepEqual(state.points[1].anchor, { x: 4, y: 5 });
  assert.equal(state.points[1].id, second);
  assert.deepEqual(state.lines[0], originalLine);
  state.points[0].anchor.x = 500;
  assert.equal(store.getState().points[0].anchor.x, 1.25);
  assert.equal(store.addPoint({ x: NaN, y: 1 }), null);
  store.selectObject(line);
  assert.equal(store.getState().activeTool, 'point', 'left selection keeps right-click creation enabled');
});

test('coordinate creation preference applies to new points and per-point visibility follows full precision anchors', () => {
  const store = createStore();
  const first = store.addPoint({ x: 1.23456, y: -0.001 });
  store.update({ pointCoordinates: true, activeTool: 'point' });
  const second = store.addPoint({ x: -2.34567, y: 3.45678 });
  store.addLine();
  store.addCurve();
  store.selectObject(second);
  assert.equal(store.getState().activeTool, 'point');
  assert.equal(store.getState().points[0].showCoordinates, false);
  assert.equal(store.getState().points[1].showCoordinates, true);
  store.update({ pointCoordinates: false });
  store.updateSelected({ anchor: { x: -4.123456, y: 5.987654 } });
  assert.equal(pointCoordinatesLabel(store.getState().points[1].anchor), '(-4.12, 5.99)');
  store.selectObject(first);
  store.updateSelected({ showCoordinates: true });
  assert.equal(pointCoordinatesLabel(store.getState().points[0].anchor), '(1.23, 0)');
  const exported = serializeDocument(store.getState());
  assert.deepEqual(exported.points[0].anchor, { x: 1.23456, y: -0.001 });
  assert.equal(exported.points[0].showCoordinates, true);
  assert.equal(exported.points[1].showCoordinates, true);
  assert.equal('pointCoordinates' in exported, false);
  store.updateSelected({ showCoordinates: false });
  assert.equal(store.getState().points[0].showCoordinates, false);
  assert.equal(store.getState().points[1].showCoordinates, true);
});

test('point guides project to axes or cover the domain in all quadrants without pixel state', () => {
  for (const mode of ['first', 'upper', 'all']) {
    const { bounds } = createViewport(640, 480, mode);
    const point = { anchor: { x: mode === 'first' ? 2 : -2, y: mode === 'all' ? -2 : 2 }, guides: { horizontal: 'dashed', vertical: 'solid', extent: 'axes' } };
    const projected = pointGuides(point, bounds);
    assert.equal(projected.length, 2);
    for (const guide of projected) {
      if (guide.axis === 'horizontal') {
        assert.equal(guide.start.y, point.anchor.y);
        assert.equal(guide.end.y, point.anchor.y);
        assert.ok(guide.start.x === 0 || guide.end.x === 0);
      } else {
        assert.equal(guide.start.x, point.anchor.x);
        assert.equal(guide.end.x, point.anchor.x);
        assert.ok(guide.start.y === 0 || guide.end.y === 0);
      }
    }
    point.guides.extent = 'full';
    const full = pointGuides(point, bounds);
    assert.equal(full[0].start.x, bounds.xMin);
    assert.equal(full[0].end.x, bounds.xMax);
    assert.equal(full[1].start.y, bounds.yMin);
    assert.equal(full[1].end.y, bounds.yMax);
    point.guides.horizontal = point.guides.vertical = 'none';
    assert.deepEqual(pointGuides(point, bounds), []);
  }
  const bounds = { xMin: 0, xMax: 5, yMin: 0, yMax: 5 };
  const edge = { anchor: { x: 8, y: 2 }, guides: { horizontal: 'solid', vertical: 'solid', extent: 'axes' } };
  assert.deepEqual(pointGuides(edge, bounds), [{ axis: 'horizontal', style: 'solid', start: { x: 0, y: 2 }, end: { x: 5, y: 2 } }]);
});

test('mixed hierarchy supports nesting and extraction, prevents cycles, and preserves geometry', () => {
  const store = createStore();
  const line = store.addLine();
  const curve = store.addCurve();
  const point = store.addPoint({ x: 2, y: 4 });
  const folder = store.addGroup();
  const geometry = store.getState();
  assert.deepEqual(objectsOf(geometry).map((object) => object.id), [line, curve, point, folder]);
  assert.equal(store.moveObject(curve, line), true);
  assert.equal(store.moveObject(point, curve), true);
  assert.equal(store.moveObject(line, folder), true);
  const before = store.getState();
  assert.equal(store.moveObject(folder, point), false);
  assert.equal(store.moveObject(line, line), false);
  assert.equal(store.moveObject(curve, 'missing'), false);
  assert.deepEqual(store.getState(), before);
  store.toggleCollapsed(line);
  assert.equal(store.getState().lines[0].collapsed, true);
  store.moveObject(point, line);
  assert.equal(store.getState().lines[0].collapsed, false);
  store.moveObject(point, null);
  const state = store.getState();
  assert.equal(state.points[0].parentId, null);
  assert.deepEqual(state.lines[0].anchor, geometry.lines[0].anchor);
  assert.deepEqual(state.curves[0].anchor, geometry.curves[0].anchor);
  assert.deepEqual(state.points[0].anchor, geometry.points[0].anchor);
  assert.equal(canReparent(objectsOf(state), folder, curve), false);
});

test('deleting a parent lifts its children and keeps their own descendants and unique IDs', () => {
  const store = createStore();
  const folder = store.addGroup();
  const line = store.addLine();
  const curve = store.addCurve();
  const point = store.addPoint({ x: 1, y: 1 });
  store.moveObject(line, folder);
  store.moveObject(curve, line);
  store.moveObject(point, curve);
  store.selectObject(line);
  store.removeSelected();
  let state = store.getState();
  assert.equal(state.lines.length, 0);
  assert.equal(state.curves[0].parentId, folder);
  assert.equal(state.points[0].parentId, curve);
  assert.equal(state.selectedId, folder);
  store.removeSelected();
  state = store.getState();
  assert.equal(state.groups.length, 0);
  assert.equal(state.curves[0].parentId, null);
  const newPoint = store.addPoint({ x: 2, y: 2 });
  assert.notEqual(newPoint, point);
});

test('JSON version 3 exports point labels, guide styles and mixed parent links in creation order', () => {
  const store = createStore();
  const line = store.addLine();
  store.updateSelected({ name: '수요 <test>' });
  const curve = store.addCurve();
  const point = store.addPoint({ x: -2.5, y: 4.75 });
  store.updateSelected({ name: 'E', guides: { horizontal: 'dashed', vertical: 'solid' } });
  const folder = store.addGroup();
  store.moveObject(line, folder);
  store.moveObject(curve, line);
  store.moveObject(point, line);
  const exported = JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(exported.schemaVersion, 3);
  assert.deepEqual(exported.objectOrder, [line, curve, point, folder]);
  assert.equal(exported.lines[0].parentId, folder);
  assert.equal(exported.curves[0].parentId, line);
  assert.equal(exported.curves[0].variant, 'descending');
  assert.equal(exported.points[0].parentId, line);
  assert.equal(exported.points[0].name, 'E');
  assert.deepEqual(exported.points[0].anchor, { x: -2.5, y: 4.75 });
  assert.deepEqual(exported.points[0].guides, { horizontal: 'dashed', vertical: 'solid', extent: 'axes' });
  assert.equal(exported.groups[0].parentId, null);
  exported.points[0].guides.horizontal = 'none';
  assert.equal(store.getState().points[0].guides.horizontal, 'dashed');
});
