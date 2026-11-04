import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { buildSnapTargets, buildInterceptTargets, SnapTargetCache, snapPoint } from '../src/graph/snap.js';
import { snapDashedPoint } from '../src/graph/dashed-magnets.js';
import { dependentIds, canAttach } from '../src/relations.js';

const bounds = { xMin: 0, xMax: 12, yMin: 0, yMax: 12 };
const referenced = (targets, id) => targets.shapes?.some(s => s.id === id) || targets.crossings?.some(c => c.ids.includes(id));

test('dependency traversal stays iterative for long chains and rejects cycles and missing sources', () => {
  const lines = Array.from({ length: 10000 }, (_, i) => ({ id: `line-${i}`, type: 'line', ...(i ? { binding: { sourceId: `line-${i - 1}` } } : {}) }));
  const state = { lines };
  assert.equal(canAttach(state, 'new-object', 'line-9999'), true);
  assert.equal(canAttach(state, 'line-0', 'line-9999'), false);
  assert.equal(dependentIds(state, 'line-0').size, 10000);
  lines[0].binding = { sourceId: 'line-9999' }; assert.equal(canAttach(state, 'new-object', 'line-9999'), false);
  lines[0].binding = { sourceId: 'missing' }; assert.equal(canAttach(state, 'new-object', 'line-9999'), false);
});

test('the common target registry excludes a moving line or basic/analytic/free curve from every candidate path', () => {
  const store = createStore(), ids = [store.addLine(), store.addCurve(), store.addIndifference('ppc'),
    store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 })];
  for (const id of ids) {
    const targets = buildSnapTargets(store.getState(), bounds, id);
    assert.ok(!referenced(targets, id), `Excluded object leaked into shared targets: ${id}`);
  }
});

test('sum dependencies share the exclusion graph while folder membership stays independent', () => {
  const store = createStore(), a = store.addLine(), b = store.addLine(), sum = store.addSum([a, b]);
  const state = store.getState(); state.lines.find(l => l.id === b).parentId = a;
  state.sums.push({ ...state.sums[0], id: 'sum-nested', sourceIds: [sum, b] });
  assert.deepEqual(dependentIds(state, a), new Set([a, sum, 'sum-nested']));
  const targets = buildSnapTargets(state, bounds, a);
  for (const id of [a, sum, 'sum-nested']) assert.ok(!referenced(targets, id));
  assert.ok(targets.shapes.some(s => s.id === b));
  assert.equal(canAttach(state, a, 'sum-nested'), false);
  assert.equal(canAttach(state, 'new-shape', 'sum-nested'), true, 'shared dependency branches are not cycles');
  state.sums[0].sourceIds = ['sum-nested']; assert.equal(canAttach(state, 'new-shape', 'sum-nested'), false);
});

test('one target cache serves point and dashed consumers without rebuilding for tool or pointer preferences', () => {
  const store = createStore(); store.addLine(); store.updateSelected({ slope: 0, anchor: { x: 4, y: 4 } });
  const cache = new SnapTargetCache(), state = store.getState(), targets = cache.get(state, bounds);
  assert.equal(cache.get({ ...state, mouseSelected: true, dashedSelected: false, selectedId: null, points: [{ id: 'p', anchor: { x: 2, y: 3 } }] }, bounds), targets);
  const pointer = { x: 4.2, y: 4.1 };
  assert.deepEqual(snapPoint(pointer, targets, 50), snapDashedPoint(pointer, cache.get(state, bounds), 50));
  cache.clear(); assert.notEqual(cache.get(state, bounds), targets);
});

test('target cache invalidation includes format, box axes, clipping, bounds and geometry even with an unchanged viewport', () => {
  const store = createStore(); store.addLine(); store.updateSelected({ slope: 0, anchor: { x: 4, y: 4 } });
  const state = store.getState(), cache = new SnapTargetCache(), original = cache.get(state, bounds);
  const edge = { ...state, quadrantMode: 'edgeworth', boxSize: { width: 10, height: 8 } };
  const box = cache.get(edge, bounds); assert.notEqual(box, original); assert.ok(box.shapes.some(s => s.id === 'axis-b-x'));
  const resized = cache.get({ ...edge, boxSize: { width: 9, height: 7 } }, bounds);
  assert.notEqual(resized, box); assert.equal(resized.shapes.find(s => s.id === 'axis-b-x').a.y, 7);
  const gap = cache.get({ ...edge, axisGapEnabled: true, axisGap: 5 }, bounds);
  assert.notEqual(gap, box); assert.ok(!gap.shapes.some(s => s.id === state.lines[0].id));
  assert.notEqual(cache.get(edge, { ...bounds, xMax: 8 }), gap);
  const previous = cache.get(state, bounds); state.lines[0].anchor.y = 5;
  const changed = cache.get(state, bounds); assert.notEqual(changed, previous);
  assert.equal(changed.shapes.find(s => s.id === state.lines[0].id).a.y, 5);
});

test('switching excluded objects and returning to hover never reuses a filtered target set', () => {
  const store = createStore(), a = store.addLine(), b = store.addCurve(), cache = new SnapTargetCache();
  const state = store.getState();
  assert.ok(!referenced(cache.get(state, bounds, a), a));
  assert.ok(!referenced(cache.get(state, bounds, b), b));
  const hover = cache.get(state, bounds); assert.ok(referenced(hover, a)); assert.ok(referenced(hover, b));
});

test('cached targets refresh after undo, redo, deletion and graph switching', () => {
  const store = createStore(), line = store.addLine(), cache = new SnapTargetCache();
  store.updateSelected({ slope: 0, anchor: { x: 4, y: 4 } });
  const before = cache.get(store.getState(), bounds);
  store.updateSelected({ anchor: { x: 4, y: 5 } }); const moved = cache.get(store.getState(), bounds); assert.notEqual(moved, before);
  store.undo(); assert.deepEqual(cache.get(store.getState(), bounds), before);
  store.redo(); assert.deepEqual(cache.get(store.getState(), bounds), moved);
  store.removeSelected(); assert.ok(!referenced(cache.get(store.getState(), bounds), line));
  store.undo(); assert.ok(referenced(cache.get(store.getState(), bounds), line));
  store.configureLayout('horizontal2'); store.selectDiagram(store.getState().diagrams[1].id);
  assert.ok(!referenced(cache.get(store.getState(), bounds), line));
});

test('moving points and curves never snap to geometry that follows their own movement', () => {
  const store = createStore(), point = store.addPoint({ x: 4, y: 2 }), followed = store.lineThroughSelectedPoint();
  const curve = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { lineId: followed });
  const independent = store.addLine();
  for (const excluded of [point, followed]) {
    assert.ok(!referenced(buildSnapTargets(store.getState(), bounds, excluded), curve));
    assert.ok(!referenced(buildSnapTargets(store.getState(), bounds, excluded), followed));
    assert.ok(buildSnapTargets(store.getState(), bounds, excluded).shapes.some(s => s.id === independent));
    assert.ok(!buildInterceptTargets(store.getState(), bounds, excluded).some(t => t.sourceId === followed));
  }
});
