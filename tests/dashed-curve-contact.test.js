import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapTargets, SnapTargetCache, snapPoint } from '../src/graph/snap.js';
import { snapDashedPoint, snapMovingDashed } from '../src/graph/dashed-magnets.js';
import { DASHED_CURVE_CASES } from './fixtures/dashed-curve-cases.js';
import { CURVE_FAMILIES } from '../src/models/curve-families.js';

const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, unit = 56;
const close = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const pair = (targets, fixture) => targets.crossings.filter(c => c.ids.includes(fixture.curve) && c.ids.includes(fixture.dashed));

test('every registered analytic curve has a dashed crossing fixture', () => {
  assert.deepEqual(DASHED_CURVE_CASES.filter(f => !f.tangent && CURVE_FAMILIES[f.family]).map(f => f.family).sort(), Object.keys(CURVE_FAMILIES).sort());
});

test('a dashed endpoint snapped onto a curve remains an exact point target after drawing finishes', () => {
  for (const fixture of DASHED_CURVE_CASES.filter(f => !f.tangent && f.family !== 'complements')) {
    for (const axis of [null, 'x', 'y']) {
      const f = fixture.setup(); f.store.removeSelected();
      const pointer = axis ? { ...f.point, [axis]: f.point[axis] + 0.1 } : { x: f.point.x + 0.08, y: f.point.y + 0.06 };
      const snapped = snapDashedPoint(pointer, buildSnapTargets(f.store.getState(), bounds), unit, { axis });
      assert.equal(snapped.kind, 'shape');
      const start = axis === 'y' ? { x: snapped.point.x, y: 1 } : { x: 1, y: snapped.point.y };
      f.dashed = f.store.addDashedLine(start, snapped.point);
      const result = snapPoint({ x: snapped.point.x + 0.05, y: snapped.point.y + 0.05 }, buildSnapTargets(f.store.getState(), bounds), unit);
      assert.equal(result.kind, 'intersection', `${fixture.name}: snapped dashed endpoint must remain a shared crossing`);
      close(result.point, snapped.point);
    }
  }
});

for (const fixture of DASHED_CURVE_CASES) test(`dashed → point/endpoint round trip: ${fixture.name}`, () => {
  const f = fixture.setup(), cache = new SnapTargetCache(), targets = cache.get(f.store.getState(), bounds);
  assert.ok(pair(targets, f).some(c => c.kind === f.kind && Math.hypot(c.point.x - f.point.x, c.point.y - f.point.y) < 1e-7), 'Original finite curve/dashed contact must be in the shared registry');
  const pointer = { x: f.point.x + 0.12, y: f.point.y + 0.08 };
  for (const snap of [snapPoint, snapDashedPoint]) {
    const result = snap(pointer, targets, unit);
    assert.equal(result.kind, f.kind); close(result.point, f.point);
    for (const axis of ['x', 'y']) {
      const p = { ...f.point, [axis]: f.point[axis] + 0.1 };
      close(snap(p, targets, unit, { axis }).point, f.point);
    }
    const retained = snap({ x: f.point.x + 20 / unit, y: f.point.y }, targets, unit, { previous: result });
    close(retained.point, f.point);
  }
  for (const endpoint of ['anchor', 'end']) {
    const segment = { [endpoint]: pointer, [endpoint === 'end' ? 'anchor' : 'end']: { x: 1, y: 8 } };
    const result = snapMovingDashed(segment, targets, unit, { bounds });
    close(result.geometry[endpoint], f.point);
  }
  const point = f.store.addPoint(snapPoint(pointer, targets, unit).point);
  close(f.store.getState().points.find(p => p.id === point).anchor, f.point);
  f.store.undo(); assert.equal(f.store.getState().points.length, 0);
  f.store.redo(); close(f.store.getState().points[0].anchor, f.point);
});

test('analytic crossings use exact horizontal, vertical and reversed finite dashed segments', () => {
  for (const fixture of DASHED_CURVE_CASES.filter(f => !f.tangent && !['free', 'basic', 'complements'].includes(f.family))) {
    for (const orientation of ['horizontal', 'vertical']) {
      const f = fixture.setup(orientation);
      f.store.updateSelected({ anchor: f.store.getState().dashedLines[0].end, end: f.store.getState().dashedLines[0].anchor });
      const result = snapPoint({ x: f.point.x + 0.1, y: f.point.y + 0.05 }, buildSnapTargets(f.store.getState(), bounds), unit);
      assert.equal(result.kind, 'intersection'); close(result.point, f.point);
    }
  }
});

test('finite dashed contacts obey endpoints, visibility, exclusions, history and cache invalidation', () => {
  const fixture = DASHED_CURVE_CASES.find(f => f.name === 'ppc tangent'), f = fixture.setup(), cache = new SnapTargetCache();
  const targets = () => cache.get(f.store.getState(), bounds);
  assert.equal(pair(targets(), f).length, 1);
  const original = f.store.getState().dashedLines[0];
  const shifted = scale => ({ x: f.point.x + scale * f.direction.x, y: f.point.y + scale * f.direction.y });
  f.store.updateSelected({ anchor: shifted(0.3), end: shifted(1) });
  assert.equal(pair(targets(), f).length, 0, 'Do not extend a finite dashed segment to its supporting-line contact');
  f.store.updateSelected({ anchor: f.point, end: original.end });
  assert.equal(pair(targets(), f).length, 1, 'A contact at the finite endpoint is included');
  f.store.undo(); assert.equal(pair(targets(), f).length, 0);
  f.store.undo(); assert.equal(pair(targets(), f).length, 1);
  f.store.redo(); assert.equal(pair(targets(), f).length, 0);
  f.store.undo();
  for (const exclude of [f.curve, f.dashed]) assert.equal(pair(cache.get(f.store.getState(), bounds, exclude), f).length, 0);
  const hidden = { ...f.store.getState(), axisGapEnabled: true, axisGap: 4 };
  assert.equal(pair(buildSnapTargets(hidden, bounds), f).length, 0);
  assert.equal(pair(buildSnapTargets(f.store.getState(), { ...bounds, xMax: f.point.x - 0.1 }), f).length, 0);
  f.store.removeSelected(); assert.equal(pair(targets(), f).length, 0);
});

test('analytic secants retain both crossings and near misses produce no phantom contacts', () => {
  const f = DASHED_CURVE_CASES.find(f => f.name === 'ppc tangent').setup();
  f.store.updateSelected({ anchor: { x: 2, y: 3.9 }, end: { x: 3.9, y: 2 } });
  const crossings = pair(buildSnapTargets(f.store.getState(), bounds), f);
  assert.equal(crossings.length, 2);
  for (const c of crossings) {
    assert.equal(c.kind, 'intersection');
    assert.ok(Math.abs(c.point.x ** 2 + c.point.y ** 2 - 18) < 1e-8);
  }
  f.store.updateSelected({ anchor: { x: 2, y: 4.001 }, end: { x: 4.001, y: 2 } });
  assert.equal(pair(buildSnapTargets(f.store.getState(), bounds), f).length, 0);
});

test('original-curve nearest targets and Shift constraints stay inside visible domains', () => {
  for (const name of ['free crossing', 'ppc crossing', 'quasilinear crossing']) {
    const f = DASHED_CURVE_CASES.find(f => f.name === name).setup(); f.store.removeSelected();
    const state = { ...f.store.getState(), axisGapEnabled: true, axisGap: 2.4 };
    const targets = buildSnapTargets(state, bounds);
    for (const axis of [null, 'x', 'y']) for (const p of [{ x: 2.39, y: 3.2 }, { x: 3.4, y: 2.39 }]) {
      const result = snapPoint(p, targets, unit, { axis });
      if (result?.ids.includes(f.curve)) {
        assert.ok(result.point.x >= 2.4 - 1e-9 && result.point.y >= 2.4 - 1e-9);
        if (axis) assert.equal(result.point[axis === 'x' ? 'y' : 'x'], p[axis === 'x' ? 'y' : 'x']);
      }
    }
  }
});
