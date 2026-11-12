import test from 'node:test';
import assert from 'node:assert/strict';
import { snapFeedbackModel, snapFeedbackTargets } from '../src/graph/snap-feedback.js';
import { SNAP_CAPTURE_PX, SNAP_RELEASE_PX } from '../src/graph/snap-policy.js';
import { SEGMENT_CAPTURE_PX, SEGMENT_RELEASE_PX } from '../src/graph/segment-magnets.js';
import { TANGENT_CAPTURE_PX, TANGENT_RELEASE_PX } from '../src/graph/tangency.js';
import { buildSnapTargets, snapPoint, SNAP_RADIUS } from '../src/graph/snap.js';
import { snapSketchTangent } from '../src/graph/sketch-magnets.js';
import { createViewport } from '../src/graph/viewport.js';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';
import { drawSegment, segmentEnds } from './fixtures/segments.js';

const bounds={xMin:0,xMax:10,yMin:0,yMax:10},unit=50;
const state={lines:[{id:'line-1',type:'line',anchor:{x:5,y:4},slope:null}],curves:[],sketches:[],sums:[],points:[],axisGapEnabled:false};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('point, dashed, tangency and sketch magnets obey one 16/24 pixel policy',()=>{
  assert.equal(SNAP_CAPTURE_PX,16);assert.equal(SNAP_RELEASE_PX,24);
  assert.equal(SNAP_RADIUS,SNAP_CAPTURE_PX);assert.equal(SEGMENT_CAPTURE_PX,SNAP_CAPTURE_PX);assert.equal(TANGENT_CAPTURE_PX,SNAP_CAPTURE_PX);
  assert.equal(SEGMENT_RELEASE_PX,SNAP_RELEASE_PX);assert.equal(TANGENT_RELEASE_PX,SNAP_RELEASE_PX);
  const targets=buildSnapTargets(state,bounds);
  const first=snapPoint({x:4.7,y:4},targets,unit);assert.ok(first);
  assert.equal(snapPoint({x:4.6,y:4},targets,unit),null);
  assert.ok(snapPoint({x:4.6,y:4},targets,unit,{previous:first}));
  assert.equal(snapPoint({x:4.5,y:4},targets,unit,{previous:first}),null);
});

test('shared point snapping intersects the Shift axis rather than rejecting an oblique projection',()=>{
  const targets=buildSnapTargets({...state,lines:[{...state.lines[0],slope:-1}]},bounds);
  const result=snapPoint({x:4.7,y:4},targets,unit,{axis:'x'});
  close(result.point.x,5);assert.equal(result.point.y,4);
  assert.equal(snapPoint({x:4.7,y:4},buildSnapTargets({...state,lines:[{...state.lines[0],slope:0,anchor:{x:5,y:4.1}}]},bounds),unit,{axis:'x'}),null);
});

test('curve creation has stable target retention, release and Alt without moving the target line',()=>{
  const before=structuredClone(state),first=snapSketchTangent({x:4.7,y:4},state,bounds,unit);
  assert.ok(first);assert.equal(first.kind,'tangent');assert.deepEqual(first.ids,['line-1']);
  assert.equal(snapSketchTangent({x:4.6,y:4},state,bounds,unit),null);
  assert.ok(snapSketchTangent({x:4.6,y:4},state,bounds,unit,{previous:first}));
  assert.equal(snapSketchTangent({x:4.5,y:4},state,bounds,unit,{previous:first}),null);
  assert.equal(snapSketchTangent({x:5,y:4},state,bounds,unit,{previous:first,altKey:true}),null);
  assert.deepEqual(state,before);
});

test('curve creation honors its snap preference, direct line hit, visibility and reversed viewports',()=>{
  assert.equal(snapSketchTangent({x:4.8,y:4},state,bounds,unit,{enabled:false}),null);
  assert.ok(snapSketchTangent({x:4.8,y:4},state,bounds,unit,{enabled:false,directId:'line-1'}));
  assert.equal(snapSketchTangent({x:4.8,y:0.3},{...state,axisGapEnabled:true,axisGap:1},bounds,unit),null);
  assert.equal(snapSketchTangent({x:4.8,y:12},state,bounds,unit),null);
  for(const flipX of [false,true])for(const flipY of [false,true]) {
    const view=createViewport(800,600,'first',{flipX,flipY});
    const result=snapSketchTangent({x:5-15/view.unit,y:4},state,view.bounds,view.unit);assert.ok(result);close(result.point.x,5);
  }
});

test('the third-click candidate retains the real tangent binding and creates only one history step',()=>{
  const store=createStore(),id=store.addLine();store.updateSelected({slope:-1,anchor:{x:0,y:8}});
  const before=serializeActive(store.getState()),candidate=snapSketchTangent({x:4.1,y:4.1},store.getState(),bounds,unit);
  assert.ok(candidate);
  store.addSketch({x:1,y:7},{x:7,y:1},candidate.point,{lineId:candidate.line.id});
  assert.equal(store.getState().sketches[0].binding.sourceId,id);
  store.undo();assert.deepEqual(serializeActive(store.getState()),before);
});

test('shared feedback normalizes target ids and wording without changing geometry results',()=>{
  const point={x:3,y:4};
  for(const [candidate,label]of [
    [{kind:'shape',ids:['line-1']},'선 맞춤'],[{kind:'shape',ids:['axis-x']},'축 맞춤'],
    [{kind:'point',sourceId:'point-1'},'점 맞춤'],[{kind:'tangent',sourceId:'line-1'},'접점 맞춤'],
    [{kind:'intersection',ids:['a','b']},'교점 맞춤'],[{kind:'intercept',axis:'x'},'x절편'],
    [{kind:'intercept',axis:'origin'},'원점'],[{kind:'tangent',label:'꺾임 맞춤'},'꺾임 맞춤'],
  ])assert.equal(snapFeedbackModel({...candidate,point}).label,label);
  const original={kind:'tangent',point,ids:['line-1'],sourceId:'line-1'},before=structuredClone(original);
  const result=snapFeedbackModel(original,{coordinates:true});assert.deepEqual(result.ids,['line-1']);assert.match(result.text,/접점 맞춤/);assert.match(result.text,/3/);
  assert.deepEqual(original,before);assert.equal(snapFeedbackModel(null),null);
});

test('source highlights cover lines, axes, curves, sketches, sums, points and finite dashed geometry',()=>{
  const store=createStore(),line=store.addLine();store.updateSelected({slope:0,anchor:{x:3,y:3}});
  const second=store.addLine(),curve=store.addCurve(),sketch=store.addSketch({x:1,y:5},{x:7,y:5},{x:4,y:2});
  const sum=store.addSum([line,second]),point=store.addPoint({x:3,y:3}),dashed=drawSegment(store,{x:2,y:2},{x:5,y:2});
  const ids=[line,curve,sketch,sum,point,dashed,'axis-x'];
  for(const flipX of [false,true])for(const flipY of [false,true]) {
    const view=createViewport(800,600,'first',{flipX,flipY}),targets=snapFeedbackTargets(ids,store.getState(),view);
    assert.deepEqual(new Set(targets.map(target=>target.id)),new Set(ids));
    assert.ok(targets.find(target=>target.id===point).attributes.cx>=view.plot.left);
    assert.equal(targets.find(target=>target.id===point).tag,'circle');
    assert.match(targets.find(target=>target.id===curve).attributes.d,/Q/);
  }
});

test('feedback highlights never revive hidden axis-gap strokes or offscreen segments',()=>{
  const view=createViewport(800,600,'first'),hidden={...state,axisGapEnabled:true,axisGap:1,
    lines:[{...state.lines[0],slope:0,anchor:{x:2,y:0.5}}],dashedLines:[{id:'outside',anchor:{x:-4,y:2},end:{x:-2,y:2}}]};
  assert.deepEqual(snapFeedbackTargets(['line-1','outside'],hidden,view),[]);
});
