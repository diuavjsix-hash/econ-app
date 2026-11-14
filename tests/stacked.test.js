import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { QUADRANT_MODES, createViewport, toScreen, toWorld, panelSheet, panelAt, zoomable, lowerHeightOf } from '../src/graph/viewport.js';
import { displayedLineSegments, displayedCurveSegments, lineDisplayRegions } from '../src/graph/display.js';
import { axisSegments, coordinateOrigins } from '../src/graph/axes.js';
import { buildSnapTargets, snapPoint, guidedSnapCandidates } from '../src/graph/snap.js';
import { pointCoordinatesLabel } from '../src/graph/point.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { serializeDocument } from '../src/export.js';
import { lineFromPoints } from '../src/graph/line-extent.js';

const near = (a, b, eps = 1e-9) => assert.ok(a && b && Math.hypot(a.x - b.x, a.y - b.y) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const sheet = () => { const store = createStore(); store.configureWorkspace('stacked'); return store; };
const ys = pieces => pieces.flat().map(p => p.y);

test('the stacked format puts a lower graph under the upper one with one x scale and no zoom', () => {
  assert.equal(panelSheet('stacked'), true); assert.equal(panelSheet('first'), false);
  assert.deepEqual(QUADRANT_MODES.stacked.quadrants, [1, 4]);
  assert.equal(zoomable('stacked'), false);
  const viewport = createViewport(1000, 680, 'stacked', { lowerHeight: 6, zoom: 3 });
  assert.equal(viewport.bounds.xMin, 0); assert.equal(viewport.bounds.yMin, -6);
  assert.ok(Math.abs(viewport.bounds.yMax - 6) < 1e-9, 'at the default size both graphs are equally tall; zoom is ignored');
  assert.equal(toScreen({ x: 0, y: -6 }, viewport).y, viewport.plot.bottom, 'the lower origin sits at the bottom of the plot');
  for (const flipX of [false, true]) {
    const flipped = createViewport(800, 600, 'stacked', { lowerHeight: 4, flipX });
    for (const point of [{ x: 2, y: 3 }, { x: 2, y: -3 }]) near(toWorld(toScreen(point, flipped), flipped), point, 1e-10);
  }
  assert.equal(lowerHeightOf({}), 6); assert.equal(lowerHeightOf({ lowerHeight: 100 }), 40);
  assert.equal(panelAt({ x: 1, y: 0 }, { quadrantMode: 'stacked' }).key, 'upper');
  assert.equal(panelAt({ x: 1, y: -0.1 }, { quadrantMode: 'stacked' }).key, 'lower');
  assert.equal(panelAt({ x: 1, y: -0.1 }, { quadrantMode: 'first' }), null);
});

test('every stroke is drawn as drawn across both graphs; the line tool preview matches the result', () => {
  const store = sheet(), bounds = { xMin: 0, xMax: 12, yMin: -6, yMax: 6 };
  store.addLine({ x: 1, y: 5 }, { x: 5, y: 1 });
  store.addLine({ x: 1, y: -1 }, { x: 5, y: -5 });
  store.setToolMode('line'); store.addLine({ x: 3, y: 3 }, { x: 3, y: -6 }, { kind: 'segment', style: 'dashed' });
  store.setToolMode('line'); store.addLine({ x: 4, y: 2 }, { x: 4, y: 0 }, { kind: 'ray' });
  store.addCurve({ variant: 'descending', anchor: { x: 4, y: 2 }, span: 6 });
  const state = store.getState(), [upper, lower, guide, ray] = state.lines;
  assert.equal(Math.min(...ys(displayedLineSegments(upper, bounds, state))), -6, 'an upper line runs on into the lower graph');
  assert.equal(Math.max(...ys(displayedLineSegments(lower, bounds, state))), 0, 'a lower line is not stopped below the lower y axis top');
  const draft = lineFromPoints({ x: 1, y: 5 }, { x: 5, y: 1 }, 'line');
  assert.deepEqual(displayedLineSegments(draft, bounds, state), displayedLineSegments(upper, bounds, state), 'the preview is the line it becomes');
  assert.deepEqual(ys(displayedLineSegments(guide, bounds, state)).sort((a, b) => a - b), [-6, 3], 'a segment is drawn end to end');
  assert.ok(Math.min(...ys(displayedLineSegments(ray, bounds, state))) === -6, 'a ray runs down to the bottom of the sheet');
  assert.ok(displayedCurveSegments(state.curves[0], bounds, state).length, 'a curve is drawn as drawn');
  store.update({ axisGapEnabled: true, axisGap: 0.5 });
  const gapped = store.getState();
  assert.deepEqual(lineDisplayRegions(bounds, gapped).map(r => [r.yMin, r.yMax]), [[-5.5, -0.5], [0.5, 6]], 'both x axes get the gap');
  assert.deepEqual(ys(displayedLineSegments(guide, bounds, gapped)).sort((a, b) => a - b), [-5.5, -0.5, 0.5, 3]);
});

test('the lower axes are shared snap targets: points, segment ends and relations land on them', () => {
  const store = sheet(), bounds = { xMin: 0, xMax: 12, yMin: -6, yMax: 6 };
  const state0 = store.getState();
  assert.deepEqual(axisSegments(state0, bounds).map(a => a.id), ['axis-x', 'axis-y', 'axis-lower-x', 'axis-lower-y']);
  assert.deepEqual(axisSegments(state0, bounds).find(a => a.id === 'axis-y').points.map(p => p.y), [0, 6], 'the upper y axis starts at its origin');
  assert.deepEqual(axisSegments(state0, bounds).find(a => a.id === 'axis-lower-y').points.map(p => p.y), [-6, -0.5]);
  assert.deepEqual(coordinateOrigins(state0, bounds).map(o => o.label), ['원점', '아래 원점']);
  store.setToolMode('line'); store.addLine({ x: 3, y: 3 }, { x: 3, y: -4 }, { kind: 'segment', style: 'dashed' });
  const state = store.getState(), targets = buildSnapTargets(state, bounds), unit = 50;
  const hit = snapPoint({ x: 0.1, y: -5.95 }, targets, unit);
  near(hit.point, { x: 0, y: -6 }); assert.equal(snapFeedbackModel(hit).label, '아래 원점');
  const onAxis = snapPoint({ x: 7, y: -5.9 }, targets, unit);
  assert.ok(onAxis.ids.includes('axis-lower-x')); assert.equal(onAxis.point.y, -6);
  // Dragging the guide's lower end down its own line meets the lower x axis.
  const guide = state.lines[0], [end] = guidedSnapCandidates({ x: 3, y: -5.8 }, targets, unit, null, 16, guide);
  near(end.point, { x: 3, y: -6 }); assert.ok(end.ids.includes('axis-lower-x'));
  store.selectObject(guide.id); store.updateSelected({ extent: [-9, 0] });
  const doc = serializeDocument(store.getState()), diagram = doc.diagrams[0];
  assert.ok(diagram.relations.some(r => Math.abs(r.at.y + 6) < 1e-9 && r.on.includes('axis-lower-x') && r.on.includes(guide.id)));
});

test('lower-graph coordinates, settings, history and JSON', () => {
  const store = sheet();
  assert.equal(pointCoordinatesLabel({ x: 2, y: -4 }, 'stacked', { lowerHeight: 6 }), '(2, 2)');
  assert.equal(pointCoordinatesLabel({ x: 2, y: 4 }, 'stacked', { lowerHeight: 6 }), '(2, 4)');
  assert.equal(pointCoordinatesLabel({ x: 2, y: -4 }, 'all', { lowerHeight: 6 }), '(2, -4)');
  assert.equal(snapFeedbackModel({ point: { x: 1, y: -5 }, kind: 'point' }, { coordinates: true, quadrantMode: 'stacked', sheet: { lowerHeight: 6 } }).text, '점 맞춤 (1, 1)');
  store.update({ lowerHeight: 8, panelAxisNames: { lower: { y: 'P' } } });
  assert.equal(store.getState().lowerHeight, 8); assert.deepEqual(store.getState().panelAxisNames.lower, { x: 'x', y: 'P' });
  store.update({ lowerHeight: 1 }); store.update({ lowerHeight: Infinity }); assert.equal(store.getState().lowerHeight, 8);
  store.undo(); assert.equal(store.getState().lowerHeight, 6); store.redo();
  const doc = serializeDocument(store.getState()), system = doc.diagrams[0].coordinateSystem;
  assert.equal(system.type, 'stacked'); assert.equal(system.origin, 'middle-left'); assert.deepEqual(system.quadrants, [1, 4]);
  assert.deepEqual(system.lower, { lowerHeight: 8, lowerOrigin: { x: 0, y: -8 }, lowerAxisNames: { x: 'x', y: 'P' }, ownY: 'y+lowerHeight' });
  assert.equal(typeof doc.legend.panels, 'string');
  assert.deepEqual(system.panels.map(p => [p.id, p.own.y]), [['upper', 'y'], ['lower', 'y+8']]);
  store.configureWorkspace('first');
  const plain = serializeDocument(store.getState());
  assert.equal(plain.legend.panels, undefined); assert.equal(plain.diagrams[0].coordinateSystem.lower, undefined); assert.equal(plain.diagrams[0].coordinateSystem.panels, undefined);
});
