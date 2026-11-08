import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { indifferenceValue, moveIndifference, shapeIndifference, indifferenceShapeHandle, indifferenceContact, indifferenceOnLine } from '../src/graph/indifference.js';
import { displayedCurveSegments } from '../src/graph/display.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';

const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const bounds={xMin:0,xMax:14,yMin:0,yMax:14};
const curve={id:'curve-1',type:'curve',family:'rectangular-hyperbola',anchor:{x:3,y:4},shape:1};

test('rectangular hyperbolas keep xy constant with perpendicular axis asymptotes and no exponent edits',()=>{
  for (const x of [0.001,0.3,1,3,10,1000]) {
    const y=indifferenceValue({...curve,shape:8},x);
    close(x*y,12);close(indifferenceValue(curve,y,'horizontal'),x);
  }
  assert.ok(Number.isNaN(indifferenceValue(curve,0)));
  assert.ok(Number.isNaN(indifferenceValue(curve,-1)));
  const handle=indifferenceShapeHandle(curve,bounds);
  const stationary=shapeIndifference(curve,handle).anchor;
  close(stationary.x,3);close(stationary.y,4);
  const enlarged=shapeIndifference(curve,{x:6,y:8}).anchor;
  close(enlarged.x*enlarged.y,48);close(enlarged.y/enlarged.x,4/3);
  for (const axis of [null,'x','y']) {
    const start={x:2,y:6},anchor=moveIndifference(curve,start,{x:4,y:12},axis);
    close(anchor.x,6);close(anchor.y,8);
  }
  assert.deepEqual(shapeIndifference(curve,{x:0,y:2}),{});
  const pieces=displayedCurveSegments(curve,bounds,{axisGapEnabled:true,axisGap:0.75});
  assert.ok(pieces.length);
  for (const [a,,b] of pieces) for (const p of [a,b]) {close(p.x*p.y,12);assert.ok(p.x>=0.75 && p.y>=0.75);}
});

test('rectangular hyperbolas share exact point/tangent magnets, retention, Alt and hidden-contact rules',()=>{
  const point=indifferenceContact(curve,-1);close(point.x,Math.sqrt(12));close(point.x,point.y);
  const line={id:'line-1',type:'line',slope:-1,anchor:point};
  const state={lines:[line],curves:[curve],sketches:[],points:[],sums:[],axisGapEnabled:false};
  const targets=buildSnapTargets(state,bounds),snap=snapPoint({x:point.x+0.01,y:point.y+0.01},targets,40);
  assert.equal(snap.kind,'tangent');close(snap.point.x,point.x);close(snap.point.y,point.y);
  const moved={...curve,anchor:{x:3.05,y:4.05}},magnet=snapMovingCurve(moved,state,bounds,40);
  assert.ok(magnet);close(magnet.point.x+magnet.point.y,2*Math.sqrt(12));
  close(magnet.anchor.y/magnet.anchor.x,moved.anchor.y/moved.anchor.x);
  assert.ok(snapMovingCurve(moved,state,bounds,40,{previous:magnet}));
  assert.equal(snapMovingCurve(moved,state,bounds,40,{altKey:true}),null);
  assert.equal(snapMovingCurve(moved,{...state,axisGapEnabled:true,axisGap:5},bounds,40),null);
  for (const slope of [-0.25,-1,-4]) {
    const fit=indifferenceOnLine(curve,{slope,anchor:{x:0,y:12}});
    assert.ok(fit);close(fit.point.y,12+slope*fit.point.x);
    close(-fit.point.y/fit.point.x,slope);
  }
});

test('hyperbola size, copies, undo, graph isolation and JSON keep the exact curve identity',()=>{
  const store=createStore(),id=store.addIndifference('rectangular-hyperbola',{anchor:{x:3,y:4}});
  store.updateSelected({shape:8});assert.equal(store.getState().curves[0].shape,1);
  store.updateSelected(shapeIndifference(store.getState().curves[0],{x:6,y:8}));
  close(store.getState().curves[0].anchor.x*store.getState().curves[0].anchor.y,48);
  store.undo();close(store.getState().curves[0].anchor.x*store.getState().curves[0].anchor.y,12);
  store.redo();
  const original=structuredClone(store.getState().curves[0]);
  store.duplicateSelected();store.selectObject(id);store.duplicateSelected();
  const curves=store.getState().curves;assert.equal(curves.length,3);
  assert.deepEqual(curves[0],original);assert.notDeepEqual(curves[1].anchor,curves[2].anchor);
  for (const c of curves) {assert.equal(c.family,'rectangular-hyperbola');assert.equal(c.shape,1);close(indifferenceValue(c,2)*2,c.anchor.x*c.anchor.y);}
  const json=JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(json.schemaVersion,12);assert.equal(json.curves.length,3);
  assert.equal(json.curves[0].geometry.domain,'nonnegative');
  assert.equal(json.curves[0].family,'rectangular-hyperbola');
  store.configureLayout('horizontal2');store.selectDiagram(store.getState().diagrams[1].id);
  assert.equal(store.getState().curves.length,0);
});
