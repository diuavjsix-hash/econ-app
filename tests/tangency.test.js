import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';
import { directionOf } from '../src/graph/math.js';
import { curvePoint } from '../src/graph/curve.js';
import { quadraticPoint, sketchControls } from '../src/graph/sketch.js';
import { snapLineToTangency } from '../src/graph/tangency.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds = {xMin:0,xMax:10,yMin:0,yMax:10};
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const samePoint = (a,b) => {near(a.x,b.x);near(a.y,b.y);};
function cup(store) { return store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{mode:'horizontal'}); }
function line(store,slope=0,anchor={x:4,y:2.1}) {
  store.addLine();store.updateSelected({slope,anchor});return store.getState().lines.at(-1);
}

test('horizontal line snaps exactly to a free curve without changing slope or source geometry',()=>{
  const store=createStore();const source=cup(store), moving=line(store);
  const before=serializeActive(store.getState()),original=structuredClone(store.getState().sketches[0]);
  const result=snapLineToTangency(moving,store.getState(),bounds,56);
  assert.equal(result.sourceId,source);samePoint(result.point,{x:4,y:2});samePoint(result.anchor,{x:4,y:2});
  assert.deepEqual(serializeActive(store.getState()),before);
  store.updateSelected({anchor:result.anchor});assert.equal(store.getState().lines[0].slope,0);
  assert.deepEqual(store.getState().sketches[0],original);
  assert.equal(store.getState().lines[0].binding,undefined);
});

test('an oblique tangent inside either quadratic piece is solved analytically',()=>{
  for (const pieceIndex of [0,1]) {
    const store=createStore();cup(store);
    const points=sketchControls(store.getState().sketches[0])[pieceIndex],t=0.4;
    const expected=quadraticPoint(points,t),[a,b,c]=points;
    const derivative={x:(1-t)*(b.x-a.x)+t*(c.x-b.x),y:(1-t)*(b.y-a.y)+t*(c.y-b.y)};
    const slope=derivative.y/derivative.x,d=directionOf(slope);
    const moving=line(store,slope,{x:expected.x-d.y*0.1+d.x,y:expected.y+d.x*0.1+d.y});
    const result=snapLineToTangency(moving,store.getState(),bounds,56);
    samePoint(result.point,expected);
    near((result.point.x-result.anchor.x)*d.y-(result.point.y-result.anchor.y)*d.x,0);
    near((result.anchor.x-moving.anchor.x)*d.x+(result.anchor.y-moving.anchor.y)*d.y,0);
  }
});

test('basic curves and their visible tangent continuations are snap targets',()=>{
  const store=createStore();store.addCurve({variant:'ascending'});
  const curve=store.getState().curves[0],expected=curvePoint(curve,0.4),slope=curve.slope+2*curve.bend*0.4;
  let moving=line(store,slope,{x:expected.x,y:expected.y+0.1});
  samePoint(snapLineToTangency(moving,store.getState(),bounds,56).point,expected);
  store.updateSelected({slope:curve.slope+2*curve.bend,anchor:{x:8,y:curvePoint(curve,1).y+(curve.slope+2*curve.bend)+0.1}});
  moving=store.getState().lines[0];
  const result=snapLineToTangency(moving,store.getState(),bounds,56,{reference:{x:8,y:8}});
  assert.ok(result);assert.ok(result.point.x>=7);
  near(result.anchor.y-curvePoint(curve,1).y,(result.anchor.x-7)*moving.slope);
});

test('true vertical tangency preserves null; extremely steep finite slopes remain finite',()=>{
  for (const slope of [null,1e12]) {
    const store=createStore();store.addSketch({x:6,y:1},{x:6,y:7},{x:2,y:4},{mode:'vertical'});
    const moving=line(store,slope,{x:2.1,y:4});
    const result=snapLineToTangency(moving,store.getState(),bounds,56);
    assert.ok(result);near(result.anchor.x,2);near(result.point.x,2);
    store.updateSelected({anchor:result.anchor});assert.equal(store.getState().lines[0].slope,slope);
  }
});

test('capture uses 16 screen pixels, retains to 24 pixels, then releases using the raw anchor',()=>{
  for (const unit of [8,32,56]) {
    const store=createStore();cup(store);const moving=line(store);
    const at=pixels=>({...moving,anchor:{x:4,y:2+pixels/unit}});
    const initial=snapLineToTangency(at(15),store.getState(),bounds,unit);
    assert.ok(initial);
    assert.equal(snapLineToTangency(at(17),store.getState(),bounds,unit),null);
    const held=snapLineToTangency(at(23),store.getState(),bounds,unit,{previous:initial});
    assert.ok(held);near(held.anchor.y,2);
    assert.equal(snapLineToTangency(at(25),store.getState(),bounds,unit,{previous:held}),null);
    assert.equal(snapLineToTangency(at(0),store.getState(),bounds,unit,{previous:held,altKey:true}),null);
  }
});

test('crossing a curve without a matching tangent direction does not attract a line',()=>{
  const store=createStore();store.addCurve({variant:'ascending'});const moving=line(store,-1,{x:4,y:4});
  assert.equal(snapLineToTangency(moving,store.getState(),bounds,56),null);
});

test('offscreen tangencies and contacts hidden by the axis gap are excluded',()=>{
  const store=createStore();cup(store);const moving=line(store);
  assert.equal(snapLineToTangency(moving,store.getState(),{...bounds,yMin:3},56),null);
  store.update({axisGapEnabled:true,axisGap:2});
  const state=store.getState();state.sketches[0].anchor.y=1;
  assert.equal(snapLineToTangency({...moving,anchor:{x:4,y:1.1}},state,bounds,56),null);
});

test('finite free curves do not invent tangencies beyond their endpoints or at zero derivatives',()=>{
  const store=createStore();store.addSketch({x:1,y:1},{x:7,y:7},{x:4,y:4},{tangent:{x:0,y:1}});
  const moving=line(store,0,{x:4,y:4});
  // Neither piece has a horizontal tangent in [0,1].
  assert.equal(snapLineToTangency(moving,store.getState(),bounds,56),null);
  const state=store.getState();
  state.sketches=[{...state.sketches[0],start:{x:1,y:2},anchor:{x:1,y:2},end:{x:1,y:2}}];
  assert.equal(snapLineToTangency(moving,state,bounds,56),null);
});

test('straight free pieces attract only parallel lines and choose a visible contact near the pointer',()=>{
  const store=createStore();store.addSketch({x:-20,y:2},{x:20,y:2},{x:4,y:2},{mode:'horizontal'});
  const moving=line(store);const result=snapLineToTangency(moving,store.getState(),bounds,56,{reference:{x:6,y:2.1}});
  samePoint(result.point,{x:6,y:2});near(result.anchor.y,2);
  assert.equal(snapLineToTangency({...moving,slope:0.1},store.getState(),bounds,56),null);
});

test('nearest tangent wins; a captured target stays stable when another curve gets closer',()=>{
  const store=createStore();const first=cup(store);
  store.addSketch({x:1,y:6.2},{x:7,y:6.2},{x:4,y:2.2},{mode:'horizontal'});
  const moving=line(store,0,{x:4,y:2.03}),state=store.getState();
  const initial=snapLineToTangency(moving,state,bounds,56);assert.equal(initial.sourceId,first);
  const retained=snapLineToTangency({...moving,anchor:{x:4,y:2.19}},state,bounds,56,{previous:initial});
  assert.equal(retained.sourceId,first);near(retained.anchor.y,2);
});

test('dependent curves and point-bound lines are excluded; other graphs never contribute magnets',()=>{
  const store=createStore();const moving=line(store);
  store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{lineId:moving.id});
  assert.equal(snapLineToTangency(moving,store.getState(),bounds,56),null);
  store.selectObject(store.getState().sketches[0].id);store.detachSelected();
  assert.equal(snapLineToTangency({...moving,binding:{kind:'through-point',sourceId:'point-1'}},store.getState(),bounds,56),null);
  store.configureLayout('face2');store.selectDiagram(store.getState().diagrams[1].id);
  const other=line(store);assert.equal(snapLineToTangency(other,store.getState(),bounds,56),null);
});

test('axis flips keep the same mathematical tangent and a snapped drag is one undo/redo step',()=>{
  const store=createStore();cup(store);const moving=line(store,0,{x:4,y:3});
  const before=serializeActive(store.getState());
  store.beginHistory();
  for (const flipX of [false,true]) for (const flipY of [false,true]) {
    const viewport=createViewport(800,600,'first',{flipX,flipY});
    const result=snapLineToTangency({...moving,anchor:{x:4,y:2.1}},store.getState(),viewport.bounds,viewport.unit);
    samePoint(result.anchor,{x:4,y:2});store.updateSelected({anchor:result.anchor});
  }
  store.endHistory();const after=serializeActive(store.getState());
  store.undo();assert.deepEqual(serializeActive(store.getState()),before);
  store.redo();assert.deepEqual(serializeActive(store.getState()),after);
});

test('Shift-constrained tangency corrects only the moving axis and measures the actual correction',()=>{
  const store=createStore();cup(store);
  const points=sketchControls(store.getState().sketches[0])[1],t=0.4,[a,b,c]=points,expected=quadraticPoint(points,t);
  const slope=((1-t)*(b.y-a.y)+t*(c.y-b.y))/((1-t)*(b.x-a.x)+t*(c.x-b.x));
  const moving=line(store,slope,{x:expected.x+0.1,y:expected.y});
  const result=snapLineToTangency(moving,store.getState(),bounds,56,{axis:'x'});
  assert.ok(result);assert.equal(result.anchor.y,moving.anchor.y);near(result.anchor.x,expected.x);near(result.distance,5.6);
  const steepCorrection={...moving,anchor:{x:expected.x+17/56,y:expected.y}};
  assert.equal(snapLineToTangency(steepCorrection,store.getState(),bounds,56,{axis:'x'}),null);
});

test('Shift movement parallel to the line cannot jump sideways onto a tangent',()=>{
  const store=createStore();cup(store);const moving=line(store,0,{x:4,y:2.1});
  assert.equal(snapLineToTangency(moving,store.getState(),bounds,56,{axis:'x'}),null);
  const result=snapLineToTangency(moving,store.getState(),bounds,56,{axis:'y'});
  assert.equal(result.anchor.x,4);near(result.anchor.y,2);
});
