import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { objectsOf, canReparent } from '../src/objects.js';
import { sourceValue, sumValue, sumBreakpoints, displayedSumSegments, SUM_TOLERANCE } from '../src/graph/sum.js';
import { curvePoint } from '../src/graph/curve.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { serializeDocument } from '../src/export.js';
import { createViewport, toScreen } from '../src/graph/viewport.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
function line(store, slope, x, y) {
  const id = store.addLine(); store.updateSelected({ slope, anchor: { x, y } }); return id;
}
const sumOf = store => store.getState().sums.at(-1);
const bounds = { xMin: 0, xMax: 20, yMin: 0, yMax: 20 };

test('vertical and horizontal sums use the correct independent variable and preserve originals', () => {
  const store = createStore(), a = line(store, -1, 0, 6), b = line(store, -2, 0, 8);
  const originals = structuredClone(store.getState().lines);
  store.addSum([a, b]);
  close(sumValue(sumOf(store), store.getState(), 2), 8);
  store.addSum([a, b], { direction: 'horizontal' });
  close(sumValue(sumOf(store), store.getState(), 2), 7);
  assert.deepEqual(store.getState().lines, originals);
  assert.equal(sumOf(store).anchor, undefined);
});

test('unequal demand intercepts produce exact zero-contribution kinks instead of negative demand', () => {
  const store = createStore(), a = line(store, -1, 0, 6), b = line(store, -2, 0, 8);
  store.addSum([a, b], { direction: 'horizontal' });
  const sum = sumOf(store), state = store.getState();
  close(sumValue(sum, state, 0), 10); close(sumValue(sum, state, 6), 1);
  close(sumValue(sum, state, 7), 0.5); close(sumValue(sum, state, 9), 0);
  assert.equal(sumValue(sum, state, -1), null);
  assert.deepEqual(sumBreakpoints(sum, state, 0, 10), [0, 6, 8, 10]);
  const segments = displayedSumSegments(sum, state, bounds);
  assert.ok(segments.flat().some(point => point.x === 1 && point.y === 6));
  store.updateSelected({ nonnegative: false });
  close(sumValue(sumOf(store), store.getState(), 9), -3.5);
  close(sumValue(sumOf(store), store.getState(), -2), 13);
  store.undo(); assert.equal(sumOf(store).nonnegative, true);
});

test('supply activation and vertical sums respect each contribution and allow ordinary signed sums', () => {
  const store = createStore(), a = line(store, 1, 2, 0), b = line(store, 2, 4, 0), c = line(store, 0, 0, -3);
  store.addSum([a, b, c]);
  for (const [x, expected] of [[0,0], [3,1], [5,5]]) close(sumValue(sumOf(store), store.getState(), x), expected);
  assert.deepEqual(sumBreakpoints(sumOf(store), store.getState(), 0, 8), [0,2,4,8]);
  store.addSum([a, b, c], { nonnegative: false });
  close(sumValue(sumOf(store), store.getState(), 0), -13);
});

test('curve inverse agrees with the quadratic core and both tangent rays for all supported bends', () => {
  for (const slope of [-0.75, 0.75]) for (const bend of [0, 0.00000001, 0.25, 0.35]) {
    const curve = { type: 'curve', slope, bend, span: 3, anchor: { x: 4, y: 5 } };
    for (const t of [-20, -1, -0.99, -0.25, 0, 0.000000001, 0.75, 1, 20]) {
      const x = curve.anchor.x + t * curve.span, y = sourceValue(curve, x, 'vertical');
      close(sourceValue(curve, y, 'horizontal'), x, 1e-7);
      if (Math.abs(t) <= 1) close(y, curvePoint(curve, t).y);
    }
  }
});

test('mixed curves sum accurately, and rendering approximates horizontal inverse sums within tolerance', () => {
  const store = createStore(), a = store.addCurve({ anchor: { x: 4, y: 5 }, span: 3 });
  const b = store.addCurve({ anchor: { x: 2, y: 3 }, span: 2 });
  const c = line(store, -1.5, 0, 7);
  for (const direction of ['vertical', 'horizontal']) {
    store.addSum([a,b,c], { direction, nonnegative: false });
    const state = store.getState(), sum = sumOf(store);
    for (const input of [-5,0,2,5,15]) close(sumValue(sum, state, input), [...state.curves, ...state.lines].reduce((total, source) => total + sourceValue(source, input, direction), 0));
    const segments = displayedSumSegments(sum, state, { xMin:-30, xMax:30, yMin:-30, yMax:30 });
    assert.ok(segments.length > 10);
    for (const [a, b] of segments) {
      const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
      const value = sumValue(sum, state, direction === 'vertical' ? mid.x : mid.y);
      close(value, direction === 'vertical' ? mid.y : mid.x, SUM_TOLERANCE * 1.01);
    }
  }
});

test('vertical lines work in horizontal sums, horizontal lines in vertical sums; ambiguous operations reject atomically', () => {
  const store = createStore(), a = line(store, null, 3, 0), b = line(store, null, 4, 0);
  const before = serializeDocument(store.getState());
  for (const ids of [[a,b], [a], [a,a], [a,'missing']]) assert.equal(store.addSum(ids), null);
  assert.deepEqual(serializeDocument(store.getState()), before);
  assert.equal(store.addSum([a,b], { direction:'horizontal' }), 'sum-1');
  close(sumValue(sumOf(store), store.getState(), 4), 7);
  const c = line(store, 0, 0, 2), d = line(store, 0, 0, 3);
  assert.equal(store.addSum([c,d], { direction:'horizontal' }), null);
  store.addSum([c,d]); close(sumValue(sumOf(store), store.getState(), 4), 5);
  assert.equal(store.addSum([c,d], { direction:'other' }), null);
  assert.equal(store.getState().lines[0].slope, null);
});

test('live updates follow sources, invalid source edits hide the sum and undo recovers it', () => {
  const store = createStore(), a = line(store,-1,0,6), b = line(store,-1,0,4);
  store.addSum([a,b]); const sum = sumOf(store);
  store.selectObject(a); store.updateSelected({ anchor:{ x:0,y:8 } });
  close(sumValue(sum, store.getState(), 1), 10);
  store.updateSelected({ slope:null });
  assert.equal(sumValue(sum, store.getState(), 1), null);
  assert.deepEqual(displayedSumSegments(sum, store.getState(), bounds), []);
  store.undo(); close(sumValue(sum, store.getState(), 1), 10);
  store.undo(); close(sumValue(sum, store.getState(), 1), 8);
  store.redo(); close(sumValue(sum, store.getState(), 1), 10);
});

test('source deletion removes dependent sums in one undo step and retains nested children with valid parents', () => {
  const store = createStore(), a = line(store,-1,0,6), b = line(store,-1,0,4);
  const first = store.addSum([a,b]), second = store.addSum([a,b],{ direction:'horizontal' });
  const group = store.addGroup(), point = store.addPoint({x:2,y:3});
  store.moveObject(first, group); store.moveObject(a, first); store.moveObject(point, second);
  assert.equal(canReparent(objectsOf(store.getState()), first, a), false);
  store.selectObject(a); const before = serializeDocument(store.getState());
  store.removeSelected();
  assert.equal(store.getState().sums.length, 0);
  assert.equal(store.getState().points[0].parentId, null);
  assert.equal(store.getState().selectedId, group);
  store.undo(); assert.deepEqual(serializeDocument(store.getState()), before);
  store.redo(); assert.equal(store.getState().sums.length, 0);
});

test('sum identity, history, hierarchy, clear and diagram-local references survive JSON and layout changes', () => {
  const store = createStore(), a = line(store,1,0,1), b = line(store,2,0,1);
  const id = store.addSum([a,b]);
  store.undo(); assert.equal(store.getState().sums.length,0);
  store.redo(); assert.equal(sumOf(store).id,id);
  store.updateSelected({ name:'ΣD', anchor:{x:20,y:20} });
  assert.equal(sumOf(store).anchor, undefined);
  const doc = serializeDocument(store.getState());
  assert.equal(doc.schemaVersion,8); assert.deepEqual(doc.sums,doc.diagrams[0].sums);
  assert.deepEqual(doc.sums[0].sourceIds,[a,b]); assert.equal(doc.sums[0].name,'ΣD');
  assert.ok(!('collapsed' in doc.sums[0])); assert.ok(!('segments' in doc.sums[0]));
  doc.sums[0].sourceIds.push('bad'); assert.deepEqual(sumOf(store).sourceIds,[a,b]);
  store.configureLayout('face2'); const diagram1 = store.getState().activeDiagramId;
  store.selectDiagram(store.getState().diagrams[1].id);
  assert.equal(store.getState().sums.length,0);
  assert.equal(store.addSum([a,b]),null);
  store.selectDiagram(diagram1);
  store.clearAll(); assert.equal(store.getState().sums.length,0);
  store.undo(); assert.equal(sumOf(store).id,id);
  store.selectObject(id); store.removeSelected();
  assert.equal(store.getState().lines.length,2);
  assert.equal(store.addSum([a,b]),'sum-2');
});

test('axis gaps, reflections and snap targets share the displayed sum geometry', () => {
  const store = createStore(), a = line(store,-1,0,6), b = line(store,-2,0,8);
  const id = store.addSum([a,b],{direction:'horizontal'});
  store.update({axisGapEnabled:true,axisGap:0.75});
  const state = store.getState(), segments = displayedSumSegments(sumOf(store),state,bounds);
  for (const segment of segments) for (const point of segment) {
    assert.ok(point.x>=0.75-1e-9 && point.y>=0.75-1e-9);
  }
  const targets = buildSnapTargets(state,bounds);
  const snapped = snapPoint({x:2.52,y:5.02},targets,56);
  assert.ok(snapped.ids.includes(id)); close(snapped.point.x,10-1.5*snapped.point.y,1e-9);
  assert.ok(targets.crossings.some(crossing=>crossing.ids.includes(id)));
  const viewport = createViewport(600,400,'first',{flipX:true,flipY:true});
  for (const segment of displayedSumSegments(sumOf(store),state,viewport.bounds)) for (const point of segment) {
    const pixel = toScreen(point,viewport);
    assert.ok(pixel.x>=viewport.plot.left-1e-7 && pixel.x<=viewport.plot.right+1e-7);
    assert.ok(pixel.y>=viewport.plot.top-1e-7 && pixel.y<=viewport.plot.bottom+1e-7);
  }
});

test('numeric overflow never produces non-finite geometry or corrupts JSON', () => {
  const store=createStore(), a=line(store,Number.MAX_VALUE,0,0), b=line(store,Number.MAX_VALUE,0,0);
  store.addSum([a,b],{nonnegative:false});
  assert.equal(sumValue(sumOf(store),store.getState(),2),null);
  assert.deepEqual(displayedSumSegments(sumOf(store),store.getState(),{xMin:2,xMax:3,yMin:0,yMax:5}),[]);
  assert.ok(!JSON.stringify(serializeDocument(store.getState())).includes('Infinity'));
});
