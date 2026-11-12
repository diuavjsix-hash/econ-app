import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapSegmentPoint } from '../src/graph/segment-magnets.js';
import { snapMovingSegment } from './fixtures/segments.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';

const bounds={xMin:0,xMax:10,yMin:0,yMax:10},unit=50;
const curve={id:'curve-1',type:'curve',family:'complements',anchor:{x:3,y:4},shape:1};
const state={lines:[],curves:[curve],sketches:[],sums:[],points:[],axisGapEnabled:false};

test('point placement captures the exact kink instead of sliding on an adjacent arm',()=>{
  const targets=buildSnapTargets(state,bounds),result=snapPoint({x:3.1,y:4.15},targets,unit);
  assert.equal(result.kind,'kink');assert.deepEqual(result.point,curve.anchor);assert.deepEqual(result.ids,[curve.id]);
  assert.equal(snapFeedbackModel(result).label,'꺾임 맞춤');
  const store=createStore();store.addPoint(result.point);
  const doc=serializeActive(store.getState());assert.deepEqual(doc.points[0].anchor,curve.anchor);assert.equal(doc.schemaVersion,13);
});

test('an approaching kink takes over from a captured arm then holds to the shared release radius',()=>{
  const targets=buildSnapTargets(state,bounds);
  const arm=snapPoint({x:3,y:4.7},targets,unit);assert.equal(arm.kind,'shape');
  const captured=snapPoint({x:3,y:4.28},targets,unit,{previous:arm});assert.equal(captured.kind,'kink');
  const held=snapPoint({x:3,y:4.44},targets,unit,{previous:captured});assert.equal(held.kind,'kink');assert.deepEqual(held.point,curve.anchor);
  assert.equal(snapPoint({x:3,y:4.5},targets,unit,{previous:held}).kind,'shape');
  assert.equal(snapPoint({x:3,y:4.44},targets,unit).kind,'shape');
});

test('dashed endpoints and Shift drawing capture the kink without violating a locked coordinate',()=>{
  const targets=buildSnapTargets(state,bounds);
  for(const [point,axis]of [[{x:2.72,y:4},'x'],[{x:3,y:3.72},'y']]) {
    const result=snapSegmentPoint(point,targets,unit,{axis,bounds});assert.equal(result.kind,'kink');assert.deepEqual(result.point,curve.anchor);
  }
  const offset=snapSegmentPoint({x:2.72,y:4.1},targets,unit,{axis:'x',bounds});
  assert.equal(offset.kind,'shape');assert.equal(offset.point.y,4.1);
  assert.equal(snapSegmentPoint({x:2.72,y:4},targets,unit,{altKey:true}),null);
  assert.equal(snapSegmentPoint({x:2.72,y:4},targets,unit,{enabled:false}),null);
});

test('a whole dashed stroke snaps an endpoint to the kink without stretching or changing the curve',()=>{
  const before=structuredClone(state),segment={anchor:{x:1,y:4},end:{x:2.72,y:4}};
  const result=snapMovingSegment(segment,buildSnapTargets(state,bounds),unit,{axis:'x',bounds});
  assert.equal(result.kind,'kink');assert.equal(result.endpoint,'end');assert.deepEqual(result.geometry.end,curve.anchor);
  assert.ok(Math.abs(result.geometry.end.x-result.geometry.anchor.x-1.72)<1e-9);
  assert.equal(result.geometry.anchor.y,4);assert.deepEqual(state,before);
});

test('offscreen, axis-gap hidden and excluded kinks are not targets even when an arm is visible',()=>{
  for(const targets of [buildSnapTargets(state,{...bounds,xMin:3.1}),buildSnapTargets({...state,axisGapEnabled:true,axisGap:3.5},bounds),buildSnapTargets(state,bounds,curve.id)])
    assert.ok(!targets.crossings.some(target=>target.kind==='kink'));
  const nearby=buildSnapTargets({...state,curves:[{...curve,family:'substitutes'}]},bounds);
  assert.ok(!nearby.crossings.some(target=>target.kind==='kink'));
});

test('a line crossing the kink preserves the explicit kink target and both pointer tools use it',()=>{
  const targets=buildSnapTargets({...state,lines:[{id:'line-1',type:'line',slope:-1,anchor:{x:3,y:4}}]},bounds);
  const result=snapPoint({x:3.1,y:4.1},targets,unit);assert.equal(result.kind,'kink');assert.deepEqual(result.point,curve.anchor);
  assert.equal(snapSegmentPoint({x:3.1,y:4.1},targets,unit,{bounds}).kind,'kink');
});
