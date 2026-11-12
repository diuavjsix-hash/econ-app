import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { QUADRANT_MODES, createViewport, toScreen, toWorld, faceToFace } from '../src/graph/viewport.js';
import { pointCoordinatesLabel } from '../src/graph/point.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { serializeDocument } from '../src/export.js';
import { serializeActive } from './fixtures/document.js';

test('the face-to-face format shares one y axis in the middle of a single graph', () => {
  assert.equal(faceToFace('face'), true);
  assert.equal(faceToFace('upper'), false);
  assert.deepEqual(QUADRANT_MODES.face.quadrants, [1, 2]);
  for (const flipX of [false, true]) {
    const viewport = createViewport(600, 400, 'face', { flipX });
    assert.equal(viewport.cx, 300, 'the shared y axis is the middle of the sheet');
    assert.equal(viewport.cy, viewport.plot.bottom);
    assert.ok(Math.abs(viewport.bounds.xMin + viewport.bounds.xMax) < 1e-12, 'both sides are equally wide');
    assert.equal(viewport.bounds.yMin, 0);
    for (const point of [{ x: -3, y: 2 }, { x: 3, y: 2 }]) {
      const back = toWorld(toScreen(point, viewport), viewport);
      assert.ok(Math.abs(back.x - point.x) < 1e-10 && Math.abs(back.y - point.y) < 1e-10);
    }
  }
});

test('one line crosses the shared axis as a single object', () => {
  const store = createStore();
  store.update({ quadrantMode: 'face' });
  const id = store.addLine({ x: -4, y: 3 }, { x: 4, y: 3 });
  const { lines } = store.getState();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, id);
  assert.equal(lines[0].slope, 0);
  // A point on the shared axis reports both the line and the y axis through it.
  store.addPoint({ x: 0, y: 3 });
  const crossing = serializeActive(store.getState()).relations.find(entry => entry.on?.includes('axis-y') && entry.on.includes(id));
  assert.deepEqual(crossing?.at, { x: 0, y: 3 }, 'the line meets the shared y axis');
});

test('the facing x axis name belongs to each graph and follows history', () => {
  const store = createStore();
  store.configureLayout('horizontal2', null, 'face');
  assert.equal(store.getState().faceAxisName, 'x′');
  store.update({ faceAxisName: 'L₂' });
  const other = store.getState().diagrams[1].id;
  store.selectDiagram(other);
  assert.equal(store.getState().faceAxisName, 'x′');
  store.selectDiagram(store.getState().diagrams[0].id);
  assert.equal(store.getState().faceAxisName, 'L₂');
  store.undo();
  assert.equal(store.getState().faceAxisName, 'x′');
  store.redo();
  assert.equal(store.getState().faceAxisName, 'L₂');
  store.update({ faceAxisName: 'x'.repeat(100) });
  assert.equal(store.getState().faceAxisName.length, 80);
});

test('coordinates on the facing side read as positive x', () => {
  assert.equal(pointCoordinatesLabel({ x: -3, y: 2 }, 'face'), '(3, 2)');
  assert.equal(pointCoordinatesLabel({ x: 3, y: 2 }, 'face'), '(3, 2)');
  assert.equal(pointCoordinatesLabel({ x: -3, y: 2 }, 'upper'), '(-3, 2)');
  assert.equal(pointCoordinatesLabel({ x: -3, y: 2 }), '(-3, 2)');
  assert.equal(snapFeedbackModel({ point: { x: -1.5, y: 4 }, kind: 'point' }, { coordinates: true, quadrantMode: 'face' }).text, '점 맞춤 (1.5, 4)');
});

test('JSON tells readers which side faces back and how to read its x', () => {
  const store = createStore();
  store.update({ quadrantMode: 'face', axisNames: { x: 'L₁', y: 'w' }, faceAxisName: 'L₂' });
  let document = serializeActive(store.getState());
  assert.equal(document.schemaVersion, 13);
  assert.equal(document.coordinateSystem.origin, 'bottom-center');
  assert.equal(document.coordinateSystem.type, 'face-to-face');
  assert.equal(document.coordinateSystem.sharedAxis, 'y');
  assert.deepEqual(document.coordinateSystem.facing, { side: 'left', axisName: 'L₂', xPositive: 'left', ownX: '-x' });
  assert.match(document.legend.faceToFace, /-x/);
  store.updateDiagram({ flipX: true });
  document = serializeActive(store.getState());
  assert.equal(document.coordinateSystem.facing.side, 'right');
  assert.equal(document.coordinateSystem.facing.xPositive, 'right');

  const plain = serializeDocument(createStore().getState());
  assert.equal('faceToFace' in plain.legend, false, 'other drawings keep the usual legend');
  assert.equal('facing' in plain.diagrams[0].coordinateSystem, false);
});
