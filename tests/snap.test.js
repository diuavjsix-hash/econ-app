import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { curvePoint } from '../src/graph/curve.js';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { sketchControls, quadraticPoint } from '../src/graph/sketch.js';
import { snapLineToTangency } from '../src/graph/tangency.js';

const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
const state = (lines = [], curves = []) => ({ lines, curves });
const line = (id, slope, x, y) => ({ id, slope, anchor: { x, y } });
const curve = (id, slope = -0.75, bend = 0.25, anchor = { x: 4, y: 4 }) => ({ id, slope, bend, span: 3, anchor });
const close = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8, JSON.stringify({ actual, expected }));

test('line snapping uses a consistent screen radius and leaves distant positions free', () => {
  const targets = buildSnapTargets(state([line('h', 0, 3, 2)]), bounds);
  for (const unit of [32, 56]) {
    const snapped = snapPoint({ x: 3, y: 2 + 15 / unit }, targets, unit);
    assert.equal(snapped.kind, 'shape');
    close(snapped.point, { x: 3, y: 2 });
    assert.equal(snapPoint({ x: 3, y: 2 + 17 / unit }, targets, unit), null);
  }
});

test('true vertical and extremely steep lines snap without finite-slope substitutions', () => {
  for (const slope of [null, 1e10, Number.MAX_VALUE]) {
    const targets = buildSnapTargets(state([line('v', slope, 3, 3)]), bounds);
    const snapped = snapPoint({ x: 3.1, y: 5 }, targets, 56);
    assert.equal(snapped.kind, 'shape');
    close(snapped.point, { x: 3 + (slope === null ? 0 : 2 / slope), y: 5 });
  }
});

test('intersections have priority within the common capture radius even on another stroke', () => {
  const targets = buildSnapTargets(state([line('h', 0, 4, 4), line('v', null, 4, 4)]), bounds);
  const snapped = snapPoint({ x: 4 + 15 / 56, y: 4 }, targets, 56);
  assert.equal(snapped.kind, 'intersection');
  close(snapped.point, { x: 4, y: 4 });
  assert.deepEqual(new Set(snapped.ids), new Set(['h', 'v']));
  const outside = snapPoint({ x: 4 + 17 / 56, y: 4 }, targets, 56);
  assert.equal(outside.kind, 'shape');
  close(outside.point, { x: 4 + 17 / 56, y: 4 });
});

test('curves snap to the exact quadratic and to the displayed tangent extensions', () => {
  const c = curve('c');
  const targets = buildSnapTargets(state([], [c]), bounds);
  const expected = curvePoint(c, 0.4);
  const tangent = c.slope + 2 * c.bend * 0.4;
  const normalLength = Math.hypot(-tangent, 1);
  const point = { x: expected.x - tangent / normalLength * 0.1, y: expected.y + 0.1 / normalLength };
  const snapped = snapPoint(point, targets, 56);
  assert.equal(snapped.kind, 'shape');
  close(snapped.point, expected);
  const extension = { x: 8, y: 2.25 };
  const tailSnap = snapPoint({ x: extension.x + 0.025 / Math.hypot(0.25, 1), y: extension.y + 0.1 / Math.hypot(0.25, 1) }, targets, 56);
  close(tailSnap.point, extension);
  const join = snapPoint({ x: 7.05, y: 2.5 }, targets, 56);
  assert.equal(join.kind, 'shape', 'a curve must not intersect its own connected pieces');
});

test('line/curve and curve/curve intersections include multiple roots and tangencies', () => {
  const c = curve('c');
  const expected = curvePoint(c, 0.4);
  let targets = buildSnapTargets(state([line('v', null, expected.x, 3)], [c]), bounds);
  close(snapPoint({ x: expected.x + 0.1, y: expected.y + 0.1 }, targets, 56).point, expected);
  const other = curve('other', 0.75);
  targets = buildSnapTargets(state([], [c, other]), bounds);
  close(snapPoint({ x: 4.1, y: 4.1 }, targets, 56).point, { x: 4, y: 4 });
  const a = curve('a', -0.75, 0.35), b = curve('b', -0.75, 0.1, { x: 4, y: 4.1 });
  targets = buildSnapTargets(state([], [a, b]), bounds);
  for (const t of [-Math.sqrt(0.1 / 0.75), Math.sqrt(0.1 / 0.75)]) {
    const crossing = curvePoint(a, t);
    const snapped = snapPoint({ x: crossing.x + 0.05, y: crossing.y + 0.05 }, targets, 56);
    assert.equal(snapped.kind, 'intersection');
    close(snapped.point, crossing);
  }
  const bowed = curve('bowed', 0, 0.25);
  targets = buildSnapTargets(state([line('tangent', 0, 4, 4)], [bowed]), bounds);
  close(snapPoint({ x: 4.1, y: 4.05 }, targets, 56).point, { x: 4, y: 4 });
});

test('axis intersections are selectable; coincident strokes and invisible objects add no false intersections', () => {
  const targets = buildSnapTargets(state([line('a', 0, 4, 4), line('b', 0, 4, 4), line('hidden', null, -2, 3)]), bounds);
  assert.ok(!targets.shapes.some((shape) => shape.id === 'hidden'));
  assert.ok(!targets.crossings.some((crossing) => crossing.ids.includes('a') && crossing.ids.includes('b')));
  const origin = snapPoint({ x: 0.15, y: 0.12 }, targets, 56);
  assert.equal(origin.kind, 'intercept');assert.equal(origin.label,'원점');
  close(origin.point, { x: 0, y: 0 });
  const projection = snapPoint({ x: 0.1, y: 4.1 }, targets, 56);
  assert.equal(projection.kind, 'intercept');assert.equal(projection.label,'y절편');
  close(projection.point, { x: 0, y: 4 });
});

test('toggling snap changes only the tool preference, and snapped coordinates remain mathematical in JSON', () => {
  const store = createStore();
  const id = store.addPoint({ x: 4.1, y: 4.1 });
  const original = store.getState().points[0];
  assert.equal(store.getState().pointSnap, true);
  store.update({ pointSnap: false });
  assert.equal(store.getState().pointSnap, false);
  store.update({ pointSnap: true });
  assert.equal(store.getState().pointSnap, true);
  assert.deepEqual(store.getState().points[0], original);
  store.update({ pointSnap: 'false' });
  assert.equal(store.getState().pointSnap, true);
  const snapped = snapPoint(original.anchor, buildSnapTargets(state([line('h', 0, 4, 4), line('v', null, 4, 4)]), bounds), 56);
  store.updateSelected({ anchor: snapped.point });
  store.update({ pointSnap: false });
  assert.equal(store.getState().selectedId, id);
  close(store.getState().points[0].anchor, { x: 4, y: 4 });
  const exported = serializeDocument(store.getState());
  assert.equal(exported.schemaVersion, 11);
  assert.equal('pointSnap' in exported, false);
  close(exported.points[0].anchor, { x: 4, y: 4 });
});

test('finite dashed strokes participate in snapping without extending and exclude their own segment', () => {
  const measured = { lines: [], curves: [], points: [], dashedLines: [{id:'dashed-1',anchor:{x:2,y:4.3},end:{x:6,y:4.3}}] };
  const snapped = snapPoint({x:3,y:4.4},buildSnapTargets(measured,bounds),56);
  assert.equal(snapped.kind,'shape'); close(snapped.point,{x:3,y:4.3});
  assert.equal(snapPoint({x:8,y:4.3},buildSnapTargets(measured,bounds),56),null);
  assert.equal(snapPoint({x:3,y:4.4},buildSnapTargets(measured,bounds,'dashed-1'),56),null);
});

test('a duplicated line moved onto an interior free-curve tangent becomes an exact point magnet',()=>{
  const store=createStore(),original=store.addLine();
  store.updateSelected({slope:-1,anchor:{x:4,y:3}});
  const sketchId=store.addSketch({x:1,y:8},{x:8,y:8},{x:4,y:3},{lineId:original});
  const sketch=store.getState().sketches[0];
  store.selectObject(original);const copyId=store.duplicateSelected({slopeFactor:0.5});
  const [a,b,c]=sketchControls(sketch)[1],slope=-0.5;
  const start=(b.y-a.y)-slope*(b.x-a.x),end=(c.y-b.y)-slope*(c.x-b.x);
  const expected=quadraticPoint([a,b,c],-start/(end-start));
  store.updateSelected({anchor:{x:expected.x,y:expected.y+0.1}});
  const moving=store.getState().lines.find(line=>line.id===copyId);
  const tangent=snapLineToTangency(moving,store.getState(),bounds,56);
  close(tangent.point,expected);store.updateSelected({anchor:tangent.anchor});
  const targets=buildSnapTargets(store.getState(),bounds);
  for (const offset of [-12,12]) {
    const snapped=snapPoint({x:expected.x,y:expected.y+offset/56},targets,56);
    assert.equal(snapped.kind,'tangent');close(snapped.point,expected);
    assert.deepEqual(new Set(snapped.ids),new Set([copyId,sketchId]));
  }
  const snapped=snapPoint({x:expected.x+0.12,y:expected.y+0.06},targets,56);
  store.addPoint(snapped.point);
  close(store.getState().points[0].anchor,expected);
  close(serializeDocument(store.getState()).points[0].anchor,expected);
  assert.deepEqual(store.getState().sketches[0],sketch);
});

test('free-curve vertical and oblique tangencies away from mesh vertices attract the point pointer',()=>{
  for (const slope of [null,1.3,-0.7]) {
    const store=createStore();
    store.addSketch({x:1,y:7},{x:8,y:7},{x:4,y:2},{tangent:{x:1,y:0.3}});
    const pieces=sketchControls(store.getState().sketches[0]);
    // Choose a true interior tangent using the piece derivative, including a rotated vertical case.
    if (slope===null) {
      const state=store.getState();
      state.sketches[0]={...state.sketches[0],start:{x:7,y:1},end:{x:7,y:8},anchor:{x:2,y:4},tangent:{x:0,y:1}};
      state.lines=[{id:'vertical',slope:null,anchor:{x:2,y:4}}];
      const result=snapPoint({x:2.1,y:4.1},buildSnapTargets(state,bounds),56);
      assert.equal(result.kind,'tangent');close(result.point,{x:2,y:4});
      continue;
    }
    const points=pieces[slope<0?0:1],[a,b,c]=points;
    const u=(b.y-a.y)-slope*(b.x-a.x),v=(c.y-b.y)-slope*(c.x-b.x),t=-u/(v-u);
    assert.ok(t>0 && t<1);const expected=quadraticPoint(points,t);
    store.addLine();store.updateSelected({slope,anchor:expected});
    const result=snapPoint({x:expected.x+0.15,y:expected.y+0.08},buildSnapTargets(store.getState(),bounds),56);
    assert.equal(result.kind,'tangent');close(result.point,expected);
  }
});

test('exact free-curve line intersections retain both crossings and reject hidden or stale contacts',()=>{
  const store=createStore();store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{mode:'horizontal'});
  store.addLine();store.updateSelected({slope:0,anchor:{x:4,y:3}});
  const sketch=store.getState().sketches[0],points=sketchControls(sketch)[1],expected=quadraticPoint(points,0.5);
  const targets=buildSnapTargets(store.getState(),bounds);
  const snapped=snapPoint({x:expected.x+0.1,y:expected.y+0.05},targets,56);
  assert.equal(snapped.kind,'intersection');close(snapped.point,expected);
  assert.equal(targets.crossings.filter(c=>c.ids.includes(sketch.id)&&c.ids.includes('line-1')).length,2);
  assert.equal(buildSnapTargets(store.getState(),{...bounds,yMin:3.1}).crossings.some(c=>c.ids.includes(sketch.id)&&c.ids.includes('line-1')),false);
  assert.equal(buildSnapTargets(store.getState(),bounds,sketch.id).crossings.some(c=>c.ids.includes(sketch.id)),false);
  store.updateSelected({anchor:{x:4,y:1}});
  assert.equal(buildSnapTargets(store.getState(),bounds).crossings.some(c=>c.ids.includes(sketch.id)&&c.ids.includes('line-1')),false);
});

test('axis-gap-hidden tangencies and coincident straight free pieces create no point magnets',()=>{
  const store=createStore();store.addSketch({x:1,y:5},{x:7,y:5},{x:4,y:1},{mode:'horizontal'});
  store.addLine();store.updateSelected({slope:0,anchor:{x:4,y:1}});store.update({axisGapEnabled:true,axisGap:2});
  assert.equal(buildSnapTargets(store.getState(),bounds).crossings.some(c=>c.ids.includes('sketch-1')),false);
  const flat=createStore();flat.addSketch({x:1,y:3},{x:7,y:3},{x:4,y:3},{mode:'horizontal'});
  flat.addLine();flat.updateSelected({slope:0,anchor:{x:4,y:3}});
  assert.equal(buildSnapTargets(flat.getState(),bounds).crossings.some(c=>c.ids.includes('sketch-1')&&c.ids.includes('line-1')),false);
});
