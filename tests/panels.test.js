import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { QUADRANT_MODES, createViewport, toScreen, toWorld, panelSheet, panelAt, sheetPanels, zoomable } from '../src/graph/viewport.js';
import { lineDisplayRegions, displayedLineSegments } from '../src/graph/display.js';
import { axisSegments, coordinateOrigins } from '../src/graph/axes.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { pointCoordinatesLabel } from '../src/graph/point.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { serializeDocument } from '../src/export.js';

// 상하 3단 (stacked3) and 2×2 (grid): more graphs on the same one-plane sheet as 상하 2단.
const near = (a, b, eps = 1e-9) => assert.ok(a && b && Math.hypot(a.x - b.x, a.y - b.y) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const sheet = mode => { const store = createStore(); store.configureWorkspace(mode); return store; };
const axisMap = (state, bounds) => Object.fromEntries(axisSegments(state, bounds).map(a => [a.id, a.points]));

test('three rows and a 2×2 grid are panel sheets with one scale, equal rows at the default size and no zoom', () => {
  for (const mode of ['stacked3', 'grid']) {
    assert.equal(panelSheet(mode), true); assert.equal(zoomable(mode), false);
    assert.deepEqual(QUADRANT_MODES[mode].quadrants, [1, 4]);
    for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const v = createViewport(900, 640, mode, { flipX, flipY });
      for (const point of [{ x: 2, y: 3 }, { x: 11, y: -4 }, { x: 2, y: -9 }]) near(toWorld(toScreen(point, v), v), point, 1e-10);
    }
  }
  const three = createViewport(1000, 680, 'stacked3', { lowerHeight: 6, zoom: 3 });
  assert.equal(three.bounds.yMin, -12); assert.ok(Math.abs(three.bounds.yMax - 6) < 1e-9, 'three rows are equally tall; zoom is ignored');
  assert.equal(toScreen({ x: 0, y: -12 }, three).y, three.plot.bottom);
  const grid = createViewport(1000, 680, 'grid', { lowerHeight: 6, leftWidth: 9 });
  assert.equal(grid.bounds.yMin, -6); assert.ok(grid.bounds.xMax >= 18, 'the right column is at least as wide as the left one');
  const narrow = createViewport(700, 680, 'grid', { lowerHeight: 6, leftWidth: 9 });
  assert.ok(Math.abs(narrow.bounds.xMax - 18) < 1e-9, 'a narrow view shrinks the scale so both columns fit');
});

test('each graph has its own origin and axes, ending short of the next graph', () => {
  const three = sheet('stacked3').getState(), threeBounds = { xMin: 0, xMax: 20, yMin: -12, yMax: 6 };
  assert.deepEqual(sheetPanels(three).map(p => [p.key, p.origin.y]), [['upper', 0], ['middle', -6], ['lower', -12]]);
  const a = axisMap(three, threeBounds);
  assert.deepEqual(Object.keys(a), ['axis-x', 'axis-y', 'axis-middle-x', 'axis-middle-y', 'axis-lower-x', 'axis-lower-y']);
  assert.deepEqual(a['axis-middle-y'].map(p => p.y), [-6, -0.5]); assert.deepEqual(a['axis-lower-y'].map(p => p.y), [-12, -6.5]);
  assert.deepEqual(coordinateOrigins(three, threeBounds).map(o => o.label), ['원점', '가운데 원점', '아래 원점']);

  const grid = sheet('grid').getState(), bounds = { xMin: 0, xMax: 20, yMin: -6, yMax: 6 };
  assert.deepEqual(sheetPanels(grid).map(p => [p.key, p.origin.x, p.origin.y]), [['upper', 0, 0], ['right', 9, 0], ['lower', 0, -6], ['lower-right', 9, -6]]);
  const g = axisMap(grid, bounds);
  assert.deepEqual(g['axis-x'].map(p => p.x), [0, 8.5], 'the left graph x axis stops before the right graph');
  assert.deepEqual(g['axis-right-x'].map(p => p.x), [9, 20]); assert.deepEqual(g['axis-right-y'].map(p => p.y), [0, 6]);
  assert.deepEqual(g['axis-lower-right-y'].map(p => [p.x, p.y]), [[9, -6], [9, -0.5]]);
  assert.deepEqual(coordinateOrigins(grid, bounds).map(o => o.label), ['원점', '오른쪽 원점', '아래 원점', '오른쪽 아래 원점']);
});

test('points read their coordinates from the graph they are in', () => {
  const three = { lowerHeight: 6 }, grid = { lowerHeight: 6, leftWidth: 9 };
  assert.equal(panelAt({ x: 1, y: -6 }, { quadrantMode: 'stacked3', ...three }).key, 'middle');
  assert.equal(panelAt({ x: 1, y: -6.01 }, { quadrantMode: 'stacked3', ...three }).key, 'lower');
  assert.equal(panelAt({ x: 1, y: -40 }, { quadrantMode: 'stacked3', ...three }).key, 'lower');
  assert.equal(pointCoordinatesLabel({ x: 1, y: -8 }, 'stacked3', three), '(1, 4)');
  assert.equal(pointCoordinatesLabel({ x: 1, y: -2 }, 'stacked3', three), '(1, 4)');
  assert.equal(panelAt({ x: 9, y: 2 }, { quadrantMode: 'grid', ...grid }).key, 'right');
  assert.equal(pointCoordinatesLabel({ x: 11, y: -2 }, 'grid', grid), '(2, 4)');
  assert.equal(pointCoordinatesLabel({ x: 3, y: 2 }, 'grid', grid), '(3, 2)');
  assert.equal(snapFeedbackModel({ point: { x: 12, y: 1 }, kind: 'point' }, { coordinates: true, quadrantMode: 'grid', sheet: grid }).text, '점 맞춤 (3, 1)');
});

test('guides land on the other graphs’ axes through the shared magnets and relations', () => {
  const unit = 50;
  // 상하 3단: a dashed guide from the top graph down to the bottom x axis.
  const three = sheet('stacked3'), threeBounds = { xMin: 0, xMax: 20, yMin: -12, yMax: 6 };
  three.setToolMode('line'); three.addLine({ x: 3, y: 3 }, { x: 3, y: -12 }, { kind: 'segment', style: 'dashed' });
  const t = buildSnapTargets(three.getState(), threeBounds);
  const bottom = snapPoint({ x: 7, y: -11.9 }, t, unit); assert.ok(bottom.ids.includes('axis-lower-x')); assert.equal(bottom.point.y, -12);
  near(snapPoint({ x: 0.1, y: -6.05 }, t, unit).point, { x: 0, y: -6 });
  const threeRelations = serializeDocument(three.getState()).diagrams[0].relations;
  assert.ok(threeRelations.some(r => near1(r.at, { x: 3, y: -12 }) && r.on.includes('axis-lower-x')));
  // 2×2: a horizontal guide runs from the left graph to the right graph's y axis.
  const grid = sheet('grid'), bounds = { xMin: 0, xMax: 20, yMin: -6, yMax: 6 };
  grid.setToolMode('line'); grid.addLine({ x: 4, y: 3 }, { x: 9, y: 3 }, { kind: 'segment', style: 'dashed' });
  const g = buildSnapTargets(grid.getState(), bounds);
  const right = snapPoint({ x: 9.08, y: 4.5 }, g, unit); assert.ok(right.ids.includes('axis-right-y')); assert.equal(right.point.x, 9);
  const corner = snapPoint({ x: 9.05, y: -5.95 }, g, unit); near(corner.point, { x: 9, y: -6 }); assert.equal(snapFeedbackModel(corner).label, '오른쪽 아래 원점');
  const relations = serializeDocument(grid.getState()).diagrams[0].relations;
  assert.ok(relations.some(r => near1(r.at, { x: 9, y: 3 }) && r.on.includes('axis-right-y')), 'the guide ends on the right graph y axis');
});
const near1 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

test('the axis gap keeps lines off every graph’s axes and nothing else is clipped', () => {
  const grid = sheet('grid'), bounds = { xMin: 0, xMax: 20, yMin: -6, yMax: 6 };
  grid.addLine({ x: 1, y: 5 }, { x: 19, y: -5 });
  assert.equal(displayedLineSegments(grid.getState().lines[0], bounds, grid.getState()).length, 1, 'a line is drawn as drawn across graphs');
  grid.update({ axisGapEnabled: true, axisGap: 0.5 });
  assert.deepEqual(lineDisplayRegions(bounds, grid.getState()).map(r => [r.xMin, r.xMax, r.yMin, r.yMax]),
    [[0.5, 8.5, -5.5, -0.5], [9.5, 20, -5.5, -0.5], [0.5, 8.5, 0.5, 6], [9.5, 20, 0.5, 6]]);
  const three = sheet('stacked3'); three.update({ axisGapEnabled: true, axisGap: 0.5 });
  assert.deepEqual(lineDisplayRegions({ xMin: 0, xMax: 20, yMin: -12, yMax: 6 }, three.getState()).map(r => [r.yMin, r.yMax]), [[-11.5, -6.5], [-5.5, -0.5], [0.5, 6]]);
});

test('sizes, axis names, history and JSON of the new sheets', () => {
  const grid = sheet('grid');
  grid.update({ leftWidth: 7, panelAxisNames: { right: { x: 'Y' }, 'lower-right': { y: 'P' } } });
  grid.update({ leftWidth: 1 }); grid.update({ leftWidth: 41 });
  const state = grid.getState();
  assert.equal(state.leftWidth, 7); assert.deepEqual(state.panelAxisNames.right, { x: 'Y', y: 'y' }); assert.deepEqual(state.panelAxisNames['lower-right'], { x: 'x', y: 'P' });
  assert.deepEqual(sheetPanels(state).find(p => p.key === 'right').origin, { x: 7, y: 0 });
  grid.undo(); assert.equal(grid.getState().leftWidth, 9); grid.redo();
  const doc = serializeDocument(grid.getState()), system = doc.diagrams[0].coordinateSystem;
  assert.equal(system.type, 'grid-2x2'); assert.equal(system.leftWidth, 7); assert.equal(system.lowerHeight, 6); assert.equal(system.lower, undefined);
  assert.deepEqual(system.panels.find(p => p.id === 'lower-right'), { id: 'lower-right', origin: { x: 7, y: -6 }, axes: ['axis-lower-right-x', 'axis-lower-right-y'], axisNames: { x: 'x', y: 'P' }, own: { x: 'x-7', y: 'y+6' } });
  assert.equal(typeof doc.legend.panels, 'string');
  const three = sheet('stacked3'); three.update({ panelAxisNames: { middle: { y: 'r' } } });
  const threeSystem = serializeDocument(three.getState()).diagrams[0].coordinateSystem;
  assert.equal(threeSystem.type, 'stacked-3'); assert.equal(threeSystem.sharedAxis, 'x');
  assert.deepEqual(threeSystem.panels.map(p => [p.id, p.own.y, p.axisNames.y]), [['upper', 'y', 'y'], ['middle', 'y+6', 'r'], ['lower', 'y+12', 'y']]);
});
