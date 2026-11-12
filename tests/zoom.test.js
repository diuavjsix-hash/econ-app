import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewport, clampZoom, wheelZoom, gridStep, zoomable, ZOOM_MIN, ZOOM_MAX } from '../src/graph/viewport.js';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';

test('zoom scales the unit about the fixed origin; the box format keeps its fit', () => {
  const base = createViewport(800, 540, 'first'), zoomed = createViewport(800, 540, 'first', { zoom: 2 });
  assert.equal(zoomed.unit, base.unit * 2);
  assert.equal(zoomed.cx, base.cx); assert.equal(zoomed.cy, base.cy);
  assert.equal(zoomed.bounds.xMin, 0); assert.equal(zoomed.bounds.yMin, 0);
  assert.ok(Math.abs(zoomed.bounds.xMax - base.bounds.xMax / 2) < 1e-12, 'zooming in shows half the range');
  const all = createViewport(800, 540, 'all', { zoom: 0.5 }), allBase = createViewport(800, 540, 'all');
  assert.ok(Math.abs(all.bounds.xMin - allBase.bounds.xMin * 2) < 1e-12 && Math.abs(all.bounds.yMax - allBase.bounds.yMax * 2) < 1e-12);
  const box = createViewport(800, 540, 'edgeworth', { zoom: 3 }), boxBase = createViewport(800, 540, 'edgeworth');
  assert.deepEqual(box, boxBase); assert.equal(zoomable('edgeworth'), false); assert.equal(zoomable('first'), true);
});

test('zoom limits, wheel steps, the exact default and the grid spacing', () => {
  assert.equal(clampZoom(100), ZOOM_MAX); assert.equal(clampZoom(0.001), ZOOM_MIN); assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(1.02), 1, 'near 1 snaps back to the default view');
  assert.ok(wheelZoom(1, -100) > 1.1 && wheelZoom(1, 100) < 0.9, 'wheel up zooms in, wheel down zooms out');
  let zoom = 1;
  for (let i = 0; i < 4; i++) zoom = wheelZoom(zoom, -100);
  for (let i = 0; i < 4; i++) zoom = wheelZoom(zoom, 100);
  assert.equal(zoom, 1, 'the same notches back return exactly to 1');
  assert.equal(gridStep(30), 1); assert.equal(gridStep(8), 1); assert.equal(gridStep(120), 1);
  assert.equal(gridStep(3), 5); assert.equal(gridStep(1.6), 5); assert.equal(gridStep(0.5), 20);
  assert.equal(gridStep(200), 0.2); assert.equal(gridStep(560), 0.1);
});

test('zoom is per graph view state: no undo step, no JSON field, kept across graph switches', () => {
  const store = createStore();
  store.configureLayout('horizontal2', null, 'first');
  const [first, second] = store.getState().diagrams.map(d => d.id);
  const fresh = createStore();
  fresh.setZoom(3);
  assert.equal(fresh.getState().canUndo, false, 'zooming is not an undo step');
  assert.equal(fresh.undo(), false);
  const before = JSON.stringify(serializeActive(store.getState()));
  store.setZoom(2);
  let state = store.getState();
  assert.equal(state.zoom, 2); assert.equal(state.diagrams.find(d => d.id === first).zoom, 2);
  assert.equal(state.diagrams.find(d => d.id === second).zoom, 1, 'the other graph keeps its own view');
  assert.equal(JSON.stringify(serializeActive(state)), before, 'zoom is not saved in the JSON');
  store.setDiagramZoom(second, 0.5);
  store.selectDiagram(second); assert.equal(store.getState().zoom, 0.5);
  store.selectDiagram(first); assert.equal(store.getState().zoom, 2);
  store.addPoint({ x: 1, y: 1 }); store.undo();
  assert.equal(store.getState().zoom, 2, 'undo leaves the view alone');
  store.setDiagramZoom('missing', 3); assert.equal(store.getState().zoom, 2);
});
