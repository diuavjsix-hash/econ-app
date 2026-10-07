import test from 'node:test';
import assert from 'node:assert/strict';
import { angleFromSlope, clipLine, equation, interceptOf, lineEndpoints, lineEquation, normalizeSlope, slopeFromAngle } from '../src/graph/math.js';
import { createViewport, visibleAnchor } from '../src/graph/viewport.js';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';

test('positive, negative and horizontal lines stay inside the viewport and satisfy y = mx', () => {
  for (const slope of [-3, -1, -0.1, 0, 0.1, 1, 3]) {
    for (const [width, height] of [[400, 250], [120, 350]]) {
      const points = lineEndpoints(slope, width, height);
      for (const point of points) {
        assert.ok(Math.abs(point.x) <= width);
        assert.ok(Math.abs(point.y) <= height);
        assert.ok(Math.abs(point.y - slope * point.x) < 1e-9);
        assert.ok(Math.abs(point.x) === width || Math.abs(point.y) === height);
      }
    }
  }
});
test('finite slopes are unrestricted, preserve precision and support vertical lines', () => {
  assert.equal(normalizeSlope(100000), 100000);
  assert.equal(normalizeSlope(-100000), -100000);
  assert.equal(normalizeSlope(1.26), 1.26);
  assert.equal(normalizeSlope(-0.01), -0.01);
  assert.equal(normalizeSlope(-0), 0);
  assert.equal(normalizeSlope(null), null);
  assert.equal(normalizeSlope(Infinity), null);
  assert.equal(normalizeSlope(NaN), 1);
});
test('equation handles signs, horizontal lines and unit slopes', () => {
  assert.equal(equation(-1), 'y = −x');
  assert.equal(equation(1), 'y = x');
  assert.equal(equation(0), 'y = 0');
  assert.equal(equation(-2.3), 'y = −2.3x');
});
test('editing one selected line preserves other lines and detached snapshots', () => {
  const store = createStore();
  const snapshots = [];
  const stop = store.subscribe((state) => snapshots.push(state));
  const first = store.addLine();
  const second = store.addLine();
  store.selectObject(first);
  store.updateSelected({ slope: -2, anchor: { x: 1.5, y: 2 } });
  const state = store.getState();
  assert.equal(state.lines[0].slope, -2);
  assert.deepEqual(state.lines[0].anchor, { x: 1.5, y: 2 });
  assert.equal(state.lines[1].id, second);
  assert.equal(state.lines[1].slope, -1);
  assert.equal(snapshots[1].lines[0].slope, 1);
  state.lines[0].anchor.x = 900;
  assert.equal(store.getState().lines[0].anchor.x, 1.5);
  stop();
  const count = snapshots.length;
  store.updateSelected({ slope: 0 });
  assert.equal(snapshots.length, count);
});

test('translated lines clip correctly, including horizontal and invisible lines', () => {
  for (const slope of [-3, -1, 0, 0.5, 3]) {
    for (const intercept of [-4, 0, 2, 6]) {
      const points = lineEndpoints(slope, 5, 4, intercept);
      if (slope === 0 && intercept === 6) { assert.equal(points, null); continue; }
      assert.ok(points);
      for (const point of points) {
        assert.ok(Math.abs(point.x) <= 5 + 1e-9 && Math.abs(point.y) <= 4 + 1e-9);
        assert.ok(Math.abs(point.y - slope * point.x - intercept) < 1e-9);
      }
    }
  }
  assert.equal(equation(1, 2), 'y = x + 2');
  assert.equal(equation(0, -2), 'y = −2');
});

test('JSON captures every line and internal coordinates after moving and changing slope', () => {
  const store = createStore();
  store.addLine();
  store.addLine();
  store.updateSelected({ slope: 2, anchor: { x: 1, y: 3 } });
  store.update({ showGrid: false });
  const exported = JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(exported.schemaVersion, 3);
  assert.equal(exported.coordinateSystem.axesVisible, true);
  assert.equal(exported.showGrid, false);
  assert.equal(exported.lines.length, 2);
  assert.equal(exported.lines[1].slope, 2);
  assert.equal(exported.lines[1].intercept, 1);
  assert.equal(interceptOf(exported.lines[1]), 1);
  exported.lines[1].anchor.x = 20;
  assert.equal(store.getState().lines[1].anchor.x, 1);
});

test('quadrant modes map pixels to the correct mathematical domain without moving existing lines', () => {
  const first = createViewport(640, 480, 'first');
  const upper = createViewport(640, 480, 'upper');
  const all = createViewport(640, 480, 'all');
  assert.equal(first.cx, first.plot.left);
  assert.equal(first.cy, first.plot.bottom);
  assert.equal(first.bounds.xMin, 0);
  assert.equal(first.bounds.yMin, 0);
  assert.ok(upper.bounds.xMin < 0 && upper.bounds.xMax > 0 && upper.bounds.yMin === 0);
  assert.ok(all.bounds.xMin < 0 && all.bounds.yMin < 0);
  const store = createStore();
  store.addLine();
  const original = store.getState().lines[0];
  store.update({ quadrantMode: 'upper' });
  assert.deepEqual(store.getState().lines[0], original);
  assert.deepEqual(serializeDocument(store.getState()).coordinateSystem.quadrants, [1, 2]);
  store.update({ quadrantMode: 'all' });
  assert.deepEqual(serializeDocument(store.getState()).coordinateSystem.quadrants, [1, 2, 3, 4]);
  store.update({ quadrantMode: 'invalid' });
  assert.equal(store.getState().quadrantMode, 'all');
});

test('angle control reaches vertical at both ends and covers steep positive and negative slopes', () => {
  assert.equal(slopeFromAngle(90), null);
  assert.equal(slopeFromAngle(-90), null);
  assert.equal(slopeFromAngle(0), 0);
  assert.equal(slopeFromAngle(45), 1);
  assert.ok(slopeFromAngle(89.99) > 5000);
  assert.ok(slopeFromAngle(-89.99) < -5000);
  for (const slope of [-1e6, -100, -1, 0, 1, 100, 1e6]) {
    const restored = slopeFromAngle(angleFromSlope(slope));
    assert.ok(Math.abs(restored - slope) / Math.max(1, Math.abs(slope)) < 1e-8);
  }
});

test('parametric clipping handles vertical and extremely steep lines in every quadrant mode', () => {
  for (const mode of ['first', 'upper', 'all']) {
    const { bounds } = createViewport(640, 480, mode);
    for (const slope of [null, 1e8, -1e8, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const line = { slope, anchor: { x: 2, y: 3 } };
      const points = clipLine(line, bounds);
      assert.ok(points);
      for (const point of points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(point.x >= bounds.xMin && point.x <= bounds.xMax);
        assert.ok(point.y >= bounds.yMin && point.y <= bounds.yMax);
        if (slope === null) assert.equal(point.x, 2);
      }
    }
  }
  const invisible = clipLine({ slope: null, anchor: { x: -2, y: 3 } }, createViewport(640, 480, 'first').bounds);
  assert.equal(invisible, null);
});

test('vertical and huge slopes export valid, recoverable JSON without Infinity', () => {
  const store = createStore();
  store.addLine();
  store.updateSelected({ slope: null, anchor: { x: 2, y: 3 } });
  const vertical = JSON.parse(JSON.stringify(serializeDocument(store.getState()))).lines[0];
  assert.equal(vertical.vertical, true);
  assert.equal(vertical.slope, null);
  assert.equal(vertical.intercept, null);
  assert.equal(vertical.xIntercept, 2);
  assert.equal(lineEquation(vertical), 'x = 2');
  assert.equal(vertical.implicit.a * 2 + vertical.implicit.b * 3 + vertical.implicit.c, 0);
  store.updateSelected({ slope: Number.MAX_VALUE });
  const steep = JSON.parse(JSON.stringify(serializeDocument(store.getState()))).lines[0];
  assert.equal(steep.slope, Number.MAX_VALUE);
  assert.ok(Object.values(steep.implicit).every(Number.isFinite));
  assert.ok(!lineEquation(steep).includes('Infinity'));
});

test('an offscreen anchor rebases along the same line for visible editing handles', () => {
  const bounds = createViewport(640, 480, 'first').bounds;
  const line = { slope: 1, anchor: { x: -2, y: -1 } };
  const points = clipLine(line, bounds);
  const anchor = visibleAnchor(line, points, bounds);
  assert.ok(anchor.x > 0 && anchor.y > 0);
  assert.ok(Math.abs(anchor.y - anchor.x - 1) < 1e-9);
});

test('deleting selected lines preserves unique IDs and handles an empty drawing', () => {
  const store = createStore();
  const first = store.addLine();
  const second = store.addLine();
  store.removeSelected();
  assert.equal(store.getState().selectedId, first);
  const third = store.addLine();
  assert.notEqual(third, second);
  store.removeSelected();
  store.removeSelected();
  store.updateSelected({ slope: 2 });
  assert.deepEqual(serializeDocument(store.getState()).lines, []);
  assert.equal(store.getState().selectedId, null);
});

test('axis names update independently, survive quadrant changes and export without altering lines', () => {
  const store = createStore();
  store.addLine();
  const original = store.getState().lines[0];
  store.update({ axisNames: { x: '소비량' } });
  assert.deepEqual(store.getState().axisNames, { x: '소비량', y: 'y' });
  store.update({ axisNames: { y: '효용' }, quadrantMode: 'all', showGrid: false });
  const document = serializeDocument(store.getState());
  assert.equal(document.coordinateSystem.axesVisible, true);
  assert.deepEqual(document.coordinateSystem.axisNames, { x: '소비량', y: '효용' });
  assert.deepEqual(store.getState().lines[0], original);
  document.coordinateSystem.axisNames.x = 'changed';
  assert.equal(store.getState().axisNames.x, '소비량');
  store.update({ axisNames: { x: '' } });
  assert.equal(store.getState().axisNames.x, '');
  assert.equal(store.getState().axisNames.y, '효용');
});
