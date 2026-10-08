import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { createViewport } from '../src/graph/viewport.js';
import { clipLine } from '../src/graph/math.js';
import { clipCurveWithExtensions, curvePoint } from '../src/graph/curve.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { displayedLineSegments, displayedCurveSegments, isLinePointVisible, lineDisplayRegions, lineEditingGeometry } from '../src/graph/display.js';

const display = { axisGapEnabled: true, axisGap: 0.75 };
const bounds = { xMin: -8, xMax: 8, yMin: -6, yMax: 6 };
const curve = { id: 'curve', anchor: { x: 0, y: 0 }, span: 3, slope: -0.75, bend: 0.25 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('disabled gaps retain the original line and curve geometry', () => {
  const disabled = { ...display, axisGapEnabled: false };
  const line = { slope: 1, anchor: { x: 0, y: 0 } };
  assert.deepEqual(lineDisplayRegions(bounds, disabled), [bounds]);
  assert.deepEqual(displayedLineSegments(line, bounds, disabled), [clipLine(line, bounds)]);
  assert.deepEqual(displayedCurveSegments(curve, bounds, disabled), clipCurveWithExtensions(curve, bounds));
});

test('axis gaps cut straight lines in every quadrant and viewport size without changing equations', () => {
  for (const mode of ['first', 'upper', 'all']) {
    for (const [width, height] of [[1000, 700], [390, 500]]) {
      const { bounds } = createViewport(width, height, mode);
      for (const slope of [1, -1, 0, null, 1e100]) {
        const line = { slope, anchor: { x: 3, y: 3 } };
        const original = structuredClone(line);
        const segments = displayedLineSegments(line, bounds, display);
        assert.ok(segments.length);
        for (const [a, b] of segments) {
          for (let i = 0; i <= 10; i++) {
            const p = { x: a.x + (b.x - a.x) * i / 10, y: a.y + (b.y - a.y) * i / 10 };
            assert.ok(Math.abs(p.x) >= display.axisGap - 1e-9 && Math.abs(p.y) >= display.axisGap - 1e-9);
            if (slope === null || slope === 1e100) close(p.x, 3);
            else close(p.y, 3 + slope * (p.x - 3));
          }
        }
        assert.deepEqual(line, original);
      }
    }
  }
  assert.equal(displayedLineSegments({ slope: 1, anchor: { x: 0, y: 0 } }, bounds, display).length, 2);
  for (const slope of [0, null]) assert.deepEqual(displayedLineSegments({ slope, anchor: { x: 0, y: 0 } }, bounds, display), []);
  assert.deepEqual(lineDisplayRegions({ xMin: 0, xMax: 0.5, yMin: 0, yMax: 0.5 }, display), []);
});

test('clipped quadratic cores and tangent extensions keep their exact shape outside both axis bands', () => {
  for (const mode of ['first', 'upper', 'all']) {
    for (const [width, height] of [[1000, 700], [390, 500]]) {
      const { bounds } = createViewport(width, height, mode);
      for (const slope of [-0.75, 0.75]) {
        for (const bend of [0, 0.25, 0.35]) {
          const shape = { ...curve, slope, bend, anchor: { x: 3, y: 3 } };
          const original = structuredClone(shape);
          const segments = displayedCurveSegments(shape, bounds, display);
          assert.ok(segments.length);
          for (const [a, c, b] of segments) {
            for (let i = 0; i <= 20; i++) {
              const u = i / 20;
              const p = { x: (1-u)**2*a.x + 2*u*(1-u)*c.x + u*u*b.x, y: (1-u)**2*a.y + 2*u*(1-u)*c.y + u*u*b.y };
              assert.ok(Math.abs(p.x) >= display.axisGap - 1e-8 && Math.abs(p.y) >= display.axisGap - 1e-8);
              const t = (p.x - shape.anchor.x) / shape.span;
              const endpoint = Math.max(-1, Math.min(1, t));
              const core = curvePoint(shape, endpoint);
              close(p.y, core.y + (p.x - core.x) * (slope + 2*bend*endpoint));
            }
          }
          assert.deepEqual(shape, original);
        }
      }
    }
  }
});

test('editing anchors and curve handle visibility follow displayed sections', () => {
  const line = { slope: 1, anchor: { x: 0, y: 0 } };
  const editing = lineEditingGeometry(line, displayedLineSegments(line, bounds, display));
  assert.ok(isLinePointVisible(editing.anchor, bounds, display));
  close(editing.anchor.y, editing.anchor.x);
  assert.equal(isLinePointVisible(line.anchor, bounds, display), false);
  const edgeLine = { ...line, anchor: { x: 0.75, y: 0.75 } };
  const edgeEditing = lineEditingGeometry(edgeLine, displayedLineSegments(edgeLine, bounds, display));
  assert.ok(edgeEditing.anchor.x > edgeLine.anchor.x, 'endpoint anchors move handles inside the visible section');
  assert.equal(lineEditingGeometry(line, []), null);
});

test('hidden strokes and axis intersections do not attract snapping; guides and axes remain available', () => {
  const line = { id: 'line', slope: 0, anchor: { x: 3, y: 3 } };
  const state = { ...display, lines: [line], curves: [], points: [] };
  const targets = buildSnapTargets(state, bounds);
  assert.equal(snapPoint({ x: 0.35, y: 3 }, targets, 100), null);
  assert.ok(targets.crossings.every(({ ids }) => !ids.includes('line')));
  assert.ok(targets.shapes.some(({ id }) => id === 'axis-x'));
  assert.equal(snapPoint({ x: 0.02, y: 3 }, targets, 100).ids[0], 'axis-y');
  assert.ok(snapPoint({ x: 3, y: 3.02 }, targets, 100).ids.includes('line'));
  state.points.push({ id: 'point', anchor: { x: 0.3, y: 3 }, guides: { horizontal: 'dashed', vertical: 'solid', extent: 'axes' } });
  const guided = buildSnapTargets(state, bounds);
  assert.ok(guided.shapes.some(({ id }) => id === 'guide-point-horizontal'));
});

test('gap preferences export, undo and group slider changes without modifying objects', () => {
  const store = createStore();
  store.addLine();
  store.addCurve();
  const original = serializeDocument(store.getState());
  store.update({ axisGapEnabled: true });
  store.beginHistory();
  for (const axisGap of [0.8, 1, 1.25]) store.update({ axisGap });
  store.endHistory();
  const enabled = serializeDocument(store.getState());
  assert.deepEqual(enabled.lines, original.lines);
  assert.deepEqual(enabled.curves, original.curves);
  assert.deepEqual(enabled.coordinateSystem.lineAxisGap, { enabled: true, distance: 1.25 });
  store.undo();
  assert.equal(store.getState().axisGap, 0.75);
  store.undo();
  assert.equal(store.getState().axisGapEnabled, false);
  store.redo();
  store.redo();
  assert.deepEqual(serializeDocument(store.getState()), enabled);
  store.clearAll();
  assert.equal(store.getState().axisGapEnabled, true);
  assert.equal(store.getState().axisGap, 1.25);
  store.update({ axisGap: Infinity, axisGapEnabled: 'yes' });
  assert.equal(store.getState().axisGap, 1.25);
  store.update({ axisGap: -1 });
  assert.equal(store.getState().axisGap, 0.25);
  store.update({ axisGap: 100 });
  assert.equal(store.getState().axisGap, 2);
});
