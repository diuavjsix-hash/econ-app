import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';
import { buildInterceptTargets, buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapLineToIntercept, snapMovingLine } from '../src/graph/intercepts.js';
import { quadraticPoint, sketchControls } from '../src/graph/sketch.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds={xMin:0,xMax:10,yMin:0,yMax:10};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const pointNear=(a,b)=>{near(a.x,b.x);near(a.y,b.y);};
function line(store,slope,anchor) {const id=store.addLine();store.updateSelected({slope,anchor});return store.getState().lines.find(item=>item.id===id);}

test('point snapping prioritizes exact x/y intercepts even when axis gaps hide their strokes',()=>{
  const store=createStore();const source=line(store,-1,{x:3,y:3});store.update({axisGapEnabled:true,axisGap:0.75});
  const targets=buildSnapTargets(store.getState(),bounds);
  for(const expected of [{x:0,y:6},{x:6,y:0}]) {
    const snapped=snapPoint({x:expected.x+0.1,y:expected.y+0.1},targets,56);
    assert.equal(snapped.kind,'intercept');pointNear(snapped.point,expected);assert.ok(snapped.ids.includes(source.id));
  }
});

test('basic quadratic cores and tangent tails provide exact axis crossings',()=>{
  const curve={id:'curve',type:'curve',anchor:{x:4,y:0},slope:0,bend:0.25,span:3};
  const targets=buildInterceptTargets({lines:[],curves:[curve],axisGapEnabled:true,axisGap:0.75},bounds);
  pointNear(targets.find(t=>t.sourceId==='curve'&&t.axis==='x').point,{x:4,y:0});
  pointNear(targets.find(t=>t.sourceId==='curve'&&t.axis==='y').point,{x:0,y:1.25});
});

test('both free quadratic pieces expose exact finite intercepts without invented extensions',()=>{
  const store=createStore();store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:-1},{mode:'horizontal'});
  const curve=store.getState().sketches[0],targets=buildInterceptTargets(store.getState(),bounds).filter(t=>t.sourceId===curve.id);
  assert.equal(targets.length,2);assert.ok(targets.every(t=>t.axis==='x'));
  const pieces=sketchControls(curve),expected=[quadraticPoint(pieces[0],1-Math.sqrt(1/7)),quadraticPoint(pieces[1],Math.sqrt(1/7))];
  for(const point of expected) assert.ok(targets.some(t=>Math.hypot(t.point.x-point.x,t.point.y-point.y)<1e-8));
});

test('offscreen or fully hidden shapes, excluded objects and axes outside the view supply no intercepts',()=>{
  const store=createStore();line(store,0,{x:3,y:0.2});store.update({axisGapEnabled:true,axisGap:0.75});
  assert.ok(buildInterceptTargets(store.getState(),bounds).every(t=>t.sourceId===null));
  const other=line(store,-1,{x:3,y:3});
  assert.ok(buildInterceptTargets(store.getState(),bounds,other.id).every(t=>t.sourceId!==other.id));
  assert.equal(buildInterceptTargets(store.getState(),{xMin:1,xMax:10,yMin:1,yMax:10}).length,0);
});

test('moving a line matches another line y or x intercept without rotating or moving the target',()=>{
  for(const axis of ['x','y']) {
    const store=createStore(),target=axis==='y'?line(store,-0.5,{x:4,y:4}):line(store,-1,{x:4,y:4});
    const moving=axis==='y'?line(store,-1,{x:3,y:3.1}):line(store,-0.5,{x:2,y:3.05});
    const before=serializeActive(store.getState()),snap=snapLineToIntercept(moving,store.getState(),bounds,56);
    assert.equal(snap.axis,axis);assert.equal(snap.sourceId,target.id);
    if(axis==='y')near(snap.anchor.y-moving.slope*snap.anchor.x,6);else near(snap.anchor.x-snap.anchor.y/moving.slope,8);
    assert.deepEqual(serializeActive(store.getState()),before);
    store.updateSelected({anchor:snap.anchor});assert.equal(store.getState().lines[1].slope,moving.slope);
    assert.deepEqual(store.getState().lines[0],target);
  }
});

test('horizontal and true vertical lines match their unique intercept and keep null slopes exact',()=>{
  for(const vertical of [false,true]) {
    const store=createStore();line(store,-1,{x:2,y:2});
    const moving=line(store,vertical?null:0,vertical?{x:4.1,y:3}:{x:3,y:4.1});
    const snap=snapLineToIntercept(moving,store.getState(),bounds,56);assert.ok(snap);
    assert.equal(snap.axis,vertical?'x':'y');near(snap.anchor[vertical?'x':'y'],4);
    store.updateSelected({anchor:snap.anchor});assert.equal(store.getState().lines[1].slope,vertical?null:0);
  }
});

test('line intercept magnets capture at 16px, retain to 24px, release and obey Alt',()=>{
  for(const unit of [8,32,56]) {
    const store=createStore();line(store,-0.5,{x:4,y:4});const moving=line(store,-1,{x:3,y:3});
    const at=px=>({...moving,anchor:{x:3,y:3+px/unit}}),first=snapLineToIntercept(at(15),store.getState(),bounds,unit);
    assert.ok(first);assert.equal(first.axis,'y');
    assert.equal(snapLineToIntercept(at(17),store.getState(),bounds,unit),null);
    const held=snapLineToIntercept(at(23),store.getState(),bounds,unit,{previous:first});assert.ok(held);
    assert.equal(snapLineToIntercept(at(25),store.getState(),bounds,unit,{previous:held}),null);
    assert.equal(snapLineToIntercept(at(0),store.getState(),bounds,unit,{previous:first,altKey:true}),null);
  }
});

test('Shift intercept correction respects the locked axis and cannot jump in a parallel direction',()=>{
  const store=createStore();line(store,-0.5,{x:4,y:4});const moving=line(store,-1,{x:3,y:3.1});
  for(const axis of ['x','y']) {
    const snap=snapLineToIntercept(moving,store.getState(),bounds,56,{axis});assert.ok(snap);
    assert.equal(snap.anchor[axis==='x'?'y':'x'],moving.anchor[axis==='x'?'y':'x']);near(snap.anchor.x+snap.anchor.y,6);
  }
  const horizontal=line(store,0,{x:4,y:6.2});
  assert.equal(snapLineToIntercept(horizontal,store.getState(),bounds,56,{axis:'x'}),null);
});

test('intercepts of dependent curves and sums cannot pull their own moving source',()=>{
  const store=createStore(),moving=line(store,0,{x:3,y:4});
  store.addSketch({x:-2,y:5},{x:8,y:5},{x:3,y:4},{lineId:moving.id});
  assert.equal(snapLineToIntercept(moving,store.getState(),bounds,8),null);
  const other=line(store,0,{x:3,y:0.1});store.addSum([moving.id,other.id]);
  assert.equal(snapLineToIntercept(moving,store.getState(),bounds,8),null);
});

test('the line chooses the nearer magnet and keeps an already captured tangent stable',()=>{
  const store=createStore();store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{mode:'horizontal'});
  const moving=line(store,0,{x:4,y:2.1}),first=snapMovingLine(moving,store.getState(),bounds,56);
  assert.equal(first.kind,'tangent');
  line(store,0,{x:3,y:2.15});
  assert.equal(snapMovingLine(moving,store.getState(),bounds,56).kind,'intercept');
  assert.equal(snapMovingLine(moving,store.getState(),bounds,56,{previous:first}).kind,'tangent');
});

test('origin and coincident-axis shapes do not create arbitrary intercept points',()=>{
  const store=createStore();const source=line(store,0,{x:3,y:0});
  const targets=buildInterceptTargets(store.getState(),bounds);
  assert.ok(targets.every(t=>t.point.x===0 && t.point.y===0));
  const moving=line(store,-1,{x:3,y:-2.9}),snap=snapLineToIntercept(moving,store.getState(),{xMin:-10,xMax:10,yMin:-10,yMax:10},56);
  assert.ok(snap);assert.equal(snap.label,'원점');near(snap.anchor.x+snap.anchor.y,0);
  assert.ok(targets.some(t=>t.sourceId===source.id));
});

test('axis reflection, point creation and undo preserve exact mathematical intercept coordinates',()=>{
  const store=createStore();line(store,-0.5,{x:4,y:4});const moving=line(store,-1,{x:3,y:3.1}),before=serializeActive(store.getState());
  store.beginHistory();
  for(const flipX of [false,true])for(const flipY of [false,true]) {
    const viewport=createViewport(800,600,'first',{flipX,flipY});
    const snap=snapLineToIntercept(moving,store.getState(),viewport.bounds,viewport.unit);store.updateSelected({anchor:snap.anchor});
  }
  store.endHistory();const after=serializeActive(store.getState());store.undo();assert.deepEqual(serializeActive(store.getState()),before);store.redo();assert.deepEqual(serializeActive(store.getState()),after);
  const snapped=snapPoint({x:0.1,y:6.1},buildSnapTargets(store.getState(),bounds),56);store.addPoint(snapped.point);
  pointNear(serializeActive(store.getState()).points[0].anchor,{x:0,y:6});
});
