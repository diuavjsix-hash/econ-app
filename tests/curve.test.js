import test from 'node:test';
import assert from 'node:assert/strict';
import { bendFromPoint, clipCurve, clipCurveWithExtensions, CURVE_PRESETS, curveControlPoints, curvePoint, curveTangentRays, MAX_BEND } from '../src/graph/curve.js';
import { createViewport } from '../src/graph/viewport.js';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';

test('descending and ascending curves remain monotone across the supported bending range', () => {
  for (const variant of ['descending', 'ascending']) {
    for (const bend of [0, 0.25, MAX_BEND]) {
      const curve = { anchor: { x: 4, y: 4 }, span: 3, slope: CURVE_PRESETS[variant].slope, bend };
      let previous = curvePoint(curve, -1);
      for (let i = 1; i <= 100; i++) {
        const point = curvePoint(curve, -1 + i / 50);
        assert.ok(point.x > previous.x);
        assert.ok(variant === 'descending' ? point.y < previous.y : point.y > previous.y);
        previous = point;
      }
      assert.ok(curvePoint(curve, -1).y > 0 && curvePoint(curve, 1).y > 0);
    }
  }
});

test('exported Bezier controls exactly reproduce the curve and preserve translation', () => {
  const curve = { anchor: { x: -2, y: 5 }, span: 3, slope: -0.75, bend: 0.25 };
  const [a, b, c] = curveControlPoints(curve);
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const point = curvePoint(curve, 2 * u - 1);
    for (const axis of ['x', 'y']) {
      const fromBezier = (1 - u) ** 2 * a[axis] + 2 * u * (1 - u) * b[axis] + u ** 2 * c[axis];
      assert.ok(Math.abs(point[axis] - fromBezier) < 1e-10);
    }
  }
  const handle = curvePoint(curve, 0.6);
  assert.ok(Math.abs(bendFromPoint(curve, handle) - 0.25) < 1e-10);
  assert.equal(bendFromPoint(curve, { x: handle.x, y: 1000 }), MAX_BEND);
  assert.equal(bendFromPoint(curve, { x: handle.x, y: -1000 }), 0);
});

test('mixed drawings edit and delete only the selected curve and export all geometry', () => {
  const store = createStore();
  const lineId = store.addLine();
  const demandId = store.addCurve();
  const supplyId = store.addCurve();
  assert.equal(store.getState().curves[0].variant, 'descending');
  assert.equal(store.getState().curves[1].variant, 'ascending');
  store.selectObject(demandId);
  store.updateSelected({ variant: 'ascending', bend: 0.3, anchor: { x: 2, y: 6 } });
  let state = store.getState();
  assert.equal(state.lines[0].id, lineId);
  assert.equal(state.lines[0].slope, 1);
  assert.equal(state.curves[0].slope, 0.75);
  assert.equal(state.curves[0].bend, 0.3);
  assert.equal(state.curves[1].id, supplyId);
  assert.equal(state.curves[1].bend, 0.25);
  store.updateSelected({ bend: 900, slope: null });
  assert.equal(store.getState().curves[0].bend, MAX_BEND);
  assert.equal(store.getState().curves[0].slope, 0.75);
  const exported = JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(exported.lines.length, 1);
  assert.equal(exported.curves.length, 2);
  assert.equal(exported.curves[0].geometry.type, 'quadratic-bezier');
  assert.deepEqual(exported.curves[0].anchor, { x: 2, y: 6 });
  assert.equal(exported.curves[0].bend, MAX_BEND);
  exported.curves[0].geometry.controlPoints[0].x = 900;
  assert.equal(curveControlPoints(store.getState().curves[0])[0].x, -1);
  store.removeSelected();
  state = store.getState();
  assert.equal(state.curves.length, 1);
  assert.equal(state.curves[0].id, supplyId);
  assert.equal(state.selectedId, supplyId);
  const newId = store.addCurve();
  assert.notEqual(newId, demandId);
  assert.notEqual(newId, supplyId);
});

test('clipped curves reach both axes exactly and preserve the original quadratic', () => {
  const curve = { anchor: { x: 1, y: 0.5 }, span: 3, slope: -0.75, bend: 0.25 };
  const original = structuredClone(curve);
  const bounds = { xMin: 0, xMax: 5, yMin: 0, yMax: 5 };
  const segments = clipCurve(curve, bounds);
  assert.equal(segments.length, 1);
  const [a, b, c] = segments[0];
  assert.ok(Math.abs(a.x) < 1e-12);
  assert.ok(Math.abs(c.y) < 1e-12);
  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    const point = {};
    for (const axis of ['x', 'y']) point[axis] = (1 - u) ** 2 * a[axis] + 2 * u * (1 - u) * b[axis] + u ** 2 * c[axis];
    const expected = curvePoint(curve, (point.x - curve.anchor.x) / curve.span);
    assert.ok(Math.abs(point.y - expected.y) < 1e-10);
    assert.ok(point.x >= -1e-10 && point.y >= -1e-10);
  }
  assert.deepEqual(curve, original);
});

test('curve clipping handles all quadrants, mobile sizes, straight curves and invisible curves', () => {
  for (const mode of ['first', 'upper', 'all']) {
    for (const [width, height] of [[640, 480], [320, 300]]) {
      const { bounds } = createViewport(width, height, mode);
      for (const slope of [-0.75, 0.75]) {
        for (const bend of [0, 0.25, MAX_BEND]) {
          const curve = { anchor: { x: 0, y: 0.5 }, span: 10, slope, bend };
          const segments = clipCurve(curve, bounds);
          assert.equal(segments.length, 1);
          const [a, b, c] = segments[0];
          for (let i = 0; i <= 100; i++) {
            const u = i / 100;
            const point = {};
            for (const axis of ['x', 'y']) point[axis] = (1 - u) ** 2 * a[axis] + 2 * u * (1 - u) * b[axis] + u ** 2 * c[axis];
            assert.ok(point.x >= bounds.xMin - 1e-10 && point.x <= bounds.xMax + 1e-10);
            assert.ok(point.y >= bounds.yMin - 1e-10 && point.y <= bounds.yMax + 1e-10);
            assert.ok(Math.abs(point.y - curvePoint(curve, point.x / curve.span).y) < 1e-10);
          }
        }
      }
      assert.deepEqual(clipCurve({ anchor: { x: -100, y: -100 }, span: 3, slope: -0.75, bend: 0.25 }, bounds), []);
    }
  }
  const bounds = { xMin: 0, xMax: 5, yMin: 0, yMax: 5 };
  const onAxis = { anchor: { x: 2, y: 0 }, span: 1, slope: 0, bend: 0 };
  assert.deepEqual(clipCurve(onAxis, bounds), [curveControlPoints(onAxis)]);
  const inside = { anchor: { x: 2, y: 2 }, span: 1, slope: -0.75, bend: 0.25 };
  assert.deepEqual(clipCurve(inside, bounds), [curveControlPoints(inside)]);
});

test('new descending and ascending curves reach plot boundaries at every bend and viewport size', () => {
  for (const mode of ['first', 'upper', 'all']) {
    for (const [width, height] of [[951, 606], [320, 300], [1600, 700]]) {
      const { bounds } = createViewport(width, height, mode);
      const placement = {
        anchor: { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 },
        span: Math.min((bounds.xMax - bounds.xMin) * 0.38, (bounds.yMax - bounds.yMin) * 0.36),
      };
      for (const slope of [-0.75, 0.75]) {
        for (const bend of [0, 0.25, MAX_BEND]) {
          const curve = { ...placement, slope, bend };
          const original = structuredClone(curve);
          const segments = clipCurveWithExtensions(curve, bounds);
          assert.ok(segments.length);
          const onBoundary = (point) => Object.entries(bounds).some(([key, value]) => Math.abs(point[key[0]] - value) < 1e-9);
          assert.ok(onBoundary(segments[0][0]), 'left end must reach an axis or plot boundary');
          assert.ok(onBoundary(segments.at(-1)[2]), 'right end must reach an axis or plot boundary');
          let previous = null;
          for (const [a, b, c] of segments) {
            if (previous) assert.ok(Math.hypot(a.x - previous.x, a.y - previous.y) < 1e-9, 'no gap at the join');
            for (let i = 0; i <= 100; i++) {
              const u = i / 100;
              const point = {};
              for (const axis of ['x', 'y']) point[axis] = (1 - u) ** 2 * a[axis] + 2 * u * (1 - u) * b[axis] + u ** 2 * c[axis];
              assert.ok(point.x >= bounds.xMin - 1e-9 && point.x <= bounds.xMax + 1e-9);
              assert.ok(point.y >= bounds.yMin - 1e-9 && point.y <= bounds.yMax + 1e-9);
              if (previous) {
                assert.ok(point.x >= previous.x - 1e-9);
                assert.ok(slope < 0 ? point.y <= previous.y + 1e-9 : point.y >= previous.y - 1e-9);
              }
              previous = point;
            }
          }
          assert.deepEqual(curve, original);
        }
      }
    }
  }
});

test('translated and offscreen curve cores still show their outward extensions', () => {
  const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
  const curve = { anchor: { x: 15, y: 3 }, span: 1, slope: -0.75, bend: 0.25 };
  assert.deepEqual(clipCurve(curve, bounds), []);
  const segments = clipCurveWithExtensions(curve, bounds);
  assert.equal(segments.length, 1);
  assert.ok(Math.abs(segments[0][0].y - bounds.yMax) < 1e-9);
  assert.ok(Math.abs(segments[0][2].x - bounds.xMax) < 1e-9);
  const low = { ...curve, anchor: { x: 5, y: -20 } };
  assert.deepEqual(clipCurveWithExtensions(low, bounds), []);
  const moved = { ...curve, anchor: { x: 1, y: 0.5 }, span: 3 };
  const visible = clipCurveWithExtensions(moved, bounds);
  assert.ok(Math.abs(visible[0][0].x) < 1e-9);
  assert.ok(Math.abs(visible.at(-1)[2].y) < 1e-9);
});

test('exported extensions follow the endpoint derivatives and preserve original Bezier controls', () => {
  const store = createStore();
  store.addCurve();
  for (const variant of ['descending', 'ascending']) {
    for (const bend of [0, 0.25, MAX_BEND]) {
      store.updateSelected({ variant, bend });
      const curve = store.getState().curves[0];
      const [a, b, c] = curveControlPoints(curve);
      const geometry = serializeDocument(store.getState()).curves[0].geometry;
      assert.deepEqual(geometry.controlPoints, [a, b, c]);
      assert.equal(geometry.extensions.type, 'tangent-rays');
      assert.deepEqual(geometry.extensions.rays, curveTangentRays(curve));
      const [left, right] = geometry.extensions.rays;
      assert.deepEqual(left.anchor, a);
      assert.deepEqual(right.anchor, c);
      assert.equal(left.direction.x, -1);
      assert.equal(right.direction.x, 1);
      assert.ok(Math.abs(left.direction.y / left.direction.x - (b.y - a.y) / (b.x - a.x)) < 1e-9);
      assert.ok(Math.abs(right.direction.y / right.direction.x - (c.y - b.y) / (c.x - b.x)) < 1e-9);
      left.anchor.x = 1000;
      assert.deepEqual(curveControlPoints(store.getState().curves[0]), [a, b, c]);
    }
  }
});
