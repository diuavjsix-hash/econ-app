import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { curvePoint } from '../src/graph/curve.js';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';
import { sketchControls, quadraticPoint, sketchAnchorIndex } from '../src/graph/sketch.js';
import { snapLineToTangency } from '../src/graph/tangency.js';
import { segmentLine } from './fixtures/segments.js';

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
  const exported = serializeActive(store.getState());
  assert.equal(exported.schemaVersion, 15);
  assert.equal('pointSnap' in exported, false);
  close(exported.points[0].anchor, { x: 4, y: 4 });
});

test('finite segments participate in snapping without extending and exclude their own segment', () => {
  const measured = { lines: [segmentLine('dashed-1',{x:2,y:4.3},{x:6,y:4.3})], curves: [], points: [] };
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
  close(serializeActive(store.getState()).points[0].anchor,expected);
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
  assert.equal(buildSnapTargets(store.getState(),bounds).crossings.some(c=>c.ids.includes('sketch-1')&&c.kind!=='endpoint'),false); // only its drawn ends
  const flat=createStore();flat.addSketch({x:1,y:3},{x:7,y:3},{x:4,y:3},{mode:'horizontal'});
  flat.addLine();flat.updateSelected({slope:0,anchor:{x:4,y:3}});
  assert.equal(buildSnapTargets(flat.getState(),bounds).crossings.some(c=>c.ids.includes('sketch-1')&&c.ids.includes('line-1')),false);
});

test('placed points come first for every point consumer: in range they beat crossings and lines, and take over a captured one', async () => {
  const { pointSnapCandidates } = await import('../src/graph/snap.js');
  const store = createStore();
  store.addLine({ x: 0, y: 2 }, { x: 10, y: 2 });
  store.addLine({ x: 3, y: 0 }, { x: 3, y: 10 });
  const placed = { id: 'point-a', anchor: { x: 3.2, y: 2.1 } };
  const targets = buildSnapTargets(store.getState(), bounds), unit = 50;
  const crossing = snapPoint({ x: 3.02, y: 2.02 }, targets, unit);
  assert.equal(crossing.kind, 'intersection', 'without points the crossing is chosen');
  const hit = snapPoint({ x: 3.02, y: 2.02 }, targets, unit, { points: [placed], bounds });
  assert.equal(hit.kind, 'point', 'a point inside 16px beats a nearer crossing');
  assert.deepEqual(hit.point, placed.anchor);
  assert.equal(snapPoint({ x: 3.1, y: 2.05 }, targets, unit, { points: [placed], bounds, previous: crossing }).kind, 'point', 'and takes over a captured crossing');
  assert.equal(snapPoint({ x: 3.6, y: 2.02 }, targets, unit, { points: [placed], bounds }).kind, 'shape', 'outside 16px the line stays');
  assert.equal(snapPoint({ x: 3.02, y: 2.02 }, targets, unit, { points: [{ ...placed, anchor: { x: 11, y: 2.1 } }], bounds }).kind, 'intersection', 'a point out of view is no target');
  // Shift's axis and a guide keep only the points on them.
  assert.equal(pointSnapCandidates({ x: 3, y: 2.1 }, [placed], unit, { axis: 'x' }).length, 1);
  assert.equal(pointSnapCandidates({ x: 3, y: 2 }, [placed], unit, { axis: 'x' }).length, 0);
  assert.equal(pointSnapCandidates({ x: 3, y: 2 }, [placed], unit, { guide: { anchor: { x: 0, y: 0 }, slope: 2.1 / 3.2 } }).length, 1);
});

test('a free curve is drawn click by click: inner points touch lines or snap to points, a double click or Enter ends it', async () => {
  const { CREATION_TOOLS } = await import('../src/graph/creation-tools.js');
  const tool = CREATION_TOOLS.sketch, added = [];
  const s = createStore(), lineId = s.addLine({ x: 0, y: 4 }, { x: 10, y: 4 });
  const base = { ...s.getState(), sketchSelected: true, pointSnap: true, sketchMode: 'free' };
  const ctx = {
    state: base, viewport: { bounds, unit: 50 }, snapTarget: null,
    worldPoint: event => ({ x: event.x, y: event.y }), inside: () => true,
    snappedPosition(point) { this.snapTarget = this.placed ? { point: this.placed, kind: 'point', ids: ['p'] } : null; return this.placed ?? point; },
    store: { addSketch: (start, end, anchor, options) => (added.push({ start, end, anchor, options }), 'sketch-1') },
    redraw() {}, updateSnapFeedback() {},
  };
  let clock = 0;
  const event = (x, y, gap = 1000) => ({ x, y, clientX: x * 50, clientY: y * 50, timeStamp: (clock += gap), target: { closest: () => null }, preventDefault() {} });
  const click = (x, y) => tool.pointerDown(session, event(x, y), ctx);
  const double = (x, y) => { tool.pointerDown(session, event(x, y), ctx); tool.pointerDown(session, event(x, y, 120), ctx); };
  const session = tool.createSession();
  // Start, one point on the line, double-click end: the original three-point curve touching the line.
  click(1, 6); click(4, 4.05); double(7, 6);
  const touched = added.pop();
  assert.deepEqual([touched.start, touched.end, touched.anchor], [{ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 4 }]);
  assert.equal(touched.options.lineId, undefined, 'drawing a tangent curve creates no following relation');
  assert.deepEqual(touched.options.tangent, { x: 1, y: 0 });
  assert.deepEqual([touched.options.before, touched.options.after], [[], []]);
  assert.deepEqual({ kind: touched.options.snaps.anchor.kind, ids: touched.options.snaps.anchor.ids }, { kind: 'tangent', ids: [lineId] });
  assert.deepEqual(session.clicks, [], 'the double click ends the drawing');
  // A placed point within reach wins over the line: the curve passes the point, no tangent.
  click(1, 6); ctx.placed = { x: 4.1, y: 4 };
  tool.pointerMove(session, event(4, 4.05), ctx);
  assert.equal(session.hover.target, null, 'hover shows the point, not the line');
  click(4, 4.05); ctx.placed = null; double(7, 6);
  const result = added.pop();
  assert.deepEqual(result.anchor, { x: 4.1, y: 4 }); assert.equal(result.options.tangent, null, 'a snapped point passes through it without touching the line');
  // More points: Backspace takes the last back, Enter ends at the last one, the middle point is the anchor.
  click(1, 6); click(2, 5); click(5, 4.05); click(6, 5.5); click(9, 7);
  assert.equal(added.length, 0, 'left clicks never finish the curve');
  assert.equal(tool.keyDown(session, { key: 'Backspace' }, ctx), true); assert.equal(session.clicks.length, 4, 'Backspace takes back the last point');
  assert.equal(tool.keyDown(session, { key: 'Delete' }, ctx), false);
  click(8, 6);
  assert.equal(tool.keyDown(session, { key: 'Enter' }, ctx), true);
  const many = added.pop();
  assert.deepEqual([many.start, many.end, many.anchor], [{ x: 1, y: 6 }, { x: 8, y: 6 }, { x: 5, y: 4 }]);
  assert.deepEqual(many.options.tangent, { x: 1, y: 0 }, 'the point on the line keeps the line direction');
  assert.deepEqual([many.options.before.map(knot => knot.point), many.options.after.map(knot => knot.point)], [[{ x: 2, y: 5 }], [{ x: 6, y: 5.5 }]]);
  // Too few points: the curve is not made and the drawing stays.
  click(1, 6); double(3, 3);
  assert.equal(added.length, 0); assert.equal(session.clicks.length, 2); assert.ok(session.notice);
  assert.equal(tool.keyDown(session, { key: 'Enter' }, ctx), true); assert.equal(added.length, 0);
  click(3, 3); assert.equal(session.clicks.length, 2, 'a slow click on the last point adds nothing');
  assert.equal(tool.keyDown(session, { key: 'Escape' }, ctx), false, 'Esc is left to the tool switch');
});

test('a drawn curve passes its points in the order drawn, smoothly, with the middle direction on one point', () => {
  const s = createStore();
  const marked = s.addPoint({ x: 6, y: 3 });
  const id = s.addSketch({ x: 1, y: 6 }, { x: 8, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal',
    before: [{ point: { x: 2, y: 4 } }], after: [{ point: { x: 6, y: 3 }, snap: { kind: 'point', point: { x: 6, y: 3 }, ids: [marked] } }] });
  const curve = s.getState().sketches.find(sketch => sketch.id === id);
  assert.deepEqual(curve.through.map(point => [point.id, point.side, point.point]), [['p1', 'start', { x: 2, y: 4 }], ['p2', 'end', { x: 6, y: 3 }]]);
  assert.deepEqual(curve.tangent, { x: 1, y: 0 }, 'the anchor keeps the chosen middle direction');
  assert.deepEqual(s.getState().links.filter(link => link.ids[0] === id).map(link => [link.type, link.role, link.ids[1]]), [['point', 'through:p2', marked]],
    'a through point records what it was aligned to under its own role');
  // A through point's direction runs between its neighbours: (4,2) − (1,6) for p1.
  const expected = { x: 3 / 5, y: -4 / 5 };
  assert.ok(Math.hypot(curve.through[0].tangent.x - expected.x, curve.through[0].tangent.y - expected.y) < 1e-12);
  for (const knot of [curve.through[0].point, curve.through[1].point, curve.anchor])
    assert.ok(sketchControls(curve).some(piece => Math.hypot(piece[2].x - knot.x, piece[2].y - knot.y) < 1e-12), 'the curve passes every clicked point');
  // One inner point: the original three-point curve.
  const threeId = s.addSketch({ x: 1, y: 6 }, { x: 8, y: 6 }, { x: 4, y: 2 }, { mode: 'free' }), three = s.getState().sketches.find(sketch => sketch.id === threeId);
  assert.equal(three.through, undefined);
  assert.deepEqual([three.tangent, three.leftReach, three.rightReach], [{ x: 1, y: 0 }, 0.5, 0.5]);
  // Drawn right to left, a horizontal middle still runs from start to end.
  const backId = s.addSketch({ x: 8, y: 6 }, { x: 1, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' }), back = s.getState().sketches.find(sketch => sketch.id === backId);
  assert.ok(back.tangent.x === -1 && Math.abs(back.tangent.y) < 1e-12);
});

test('the middle direction goes to the point farthest from the start–end line; 자동 names the middle point', () => {
  const start = { x: 1, y: 6 }, end = { x: 9, y: 6 }, points = [{ x: 2, y: 4 }, { x: 4, y: 2 }, { x: 6, y: 3 }];
  assert.equal(sketchAnchorIndex(start, end, points, 'horizontal'), 1);
  assert.equal(sketchAnchorIndex(start, end, points.slice(1), 'vertical'), 0);
  assert.equal(sketchAnchorIndex(start, end, points, 'auto'), 1);
  assert.equal(sketchAnchorIndex(start, end, points.slice(0, 2), 'auto'), 0);
  assert.equal(sketchAnchorIndex(start, end, [{ x: 5, y: 1 }], 'horizontal'), 0);
});
