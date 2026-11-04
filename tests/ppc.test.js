import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { ppcRadii } from '../src/graph/ppc.js';
import { indifferenceValue, indifferenceContact, indifferenceOnLine, indifferenceThroughPoint, indifferenceLineIntersections, indifferenceShapeHandle, shapeIndifference, moveIndifference } from '../src/graph/indifference.js';
import { displayedCurveSegments } from '../src/graph/display.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';
import { buildFillRegions, findFillRegion } from '../src/graph/fill.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const c={id:'curve-1',type:'curve',family:'ppc',anchor:{x:4/Math.SQRT2,y:3/Math.SQRT2},shape:1};
const bounds={xMin:0,xMax:12,yMin:0,yMax:10};
const onEllipse=(curve,p)=>{const r=ppcRadii(curve);close((p.x/r.x)**2+(p.y/r.y)**2,1);};
const stateOf=curve=>({lines:[],curves:[curve],sketches:[],sums:[],points:[],dashedLines:[],axisGapEnabled:false});

test('PPC is a finite quarter ellipse with exact intercepts and inverse values',()=>{
  for (const x of [0,0.2,1,2.4,4]) {
    const y=indifferenceValue(c,x);onEllipse(c,{x,y});close(indifferenceValue(c,y,'horizontal'),x);
  }
  close(indifferenceValue(c,0),3);close(indifferenceValue(c,4),0);
  for (const x of [-1,4.01,10]) assert.ok(Number.isNaN(indifferenceValue(c,x)));
  assert.ok(displayedCurveSegments(c,bounds,{}).length>10);
  const visible=displayedCurveSegments(c,bounds,{axisGapEnabled:true,axisGap:0.75});
  for (const [a,,b] of visible) for (const p of [a,b]) assert.ok(p.x>=0.75-1e-9&&p.y>=0.75-1e-9);
  assert.ok(findFillRegion(buildFillRegions(stateOf(c),bounds),{x:1,y:1}));
});

test('PPC body scaling preserves aspect ratio and shape handle reshapes without jumping',()=>{
  const anchor=moveIndifference(c,{x:1,y:2},{x:2,y:4});close(anchor.x/c.anchor.x,2);close(anchor.y/c.anchor.y,2);
  const handle=indifferenceShapeHandle(c),still=shapeIndifference(c,handle).anchor;
  close(still.x,c.anchor.x);close(still.y,c.anchor.y);onEllipse(c,handle);
  const reshaped=shapeIndifference(c,{x:handle.x,y:handle.y*1.2}).anchor;
  close(reshaped.x*reshaped.y,c.anchor.x*c.anchor.y);close(reshaped.y/reshaped.x,1.2*c.anchor.y/c.anchor.x);
  assert.deepEqual(shapeIndifference(c,{x:-1,y:1}),{});
  const fitted=indifferenceThroughPoint(c,{x:6,y:2});onEllipse({...c,anchor:fitted},{x:6,y:2});
  close(fitted.y/fitted.x,c.anchor.y/c.anchor.x);assert.equal(indifferenceThroughPoint(c,{x:0,y:0}),null);
});

test('PPC analytic line contacts include two crossings, tangency and exact endpoint tangents',()=>{
  for (const slope of [-0.1,-1,-10,0,null]) {
    const p=indifferenceContact(c,slope);onEllipse(c,p);
    if (slope!==null&&slope!==0) close(-(9*p.x)/(16*p.y),slope);
    const line={slope,anchor:p};
    const matches=indifferenceLineIntersections(c,line,bounds);
    assert.equal(matches.length,1);assert.equal(matches[0].kind,'tangent');
    close(matches[0].point.x,p.x);close(matches[0].point.y,p.y);
    const fit=indifferenceOnLine(c,{slope,anchor:{x:p.x*1.5,y:p.y*1.5}});
    assert.ok(fit);onEllipse({...c,anchor:fit.anchor},fit.point);close(fit.anchor.x/c.anchor.x,1.5);
  }
  const points=indifferenceLineIntersections(c,{slope:-0.75,anchor:{x:0,y:3.5}},bounds);
  assert.equal(points.length,2);
  for (const {point,kind} of points) {onEllipse(c,point);close(point.y,3.5-0.75*point.x);assert.equal(kind,'intersection');}
  assert.equal(indifferenceContact(c,1),null);
});

test('PPC shares exact tangent snaps, point snaps, Alt and axis-gap exclusion',()=>{
  const p=indifferenceContact(c,-1),line={id:'line-1',type:'line',slope:-1,anchor:p},state={...stateOf(c),lines:[line]};
  const snap=snapPoint({x:p.x+0.02,y:p.y+0.02},buildSnapTargets(state,bounds),40);
  assert.equal(snap.kind,'tangent');close(snap.point.x,p.x);close(snap.point.y,p.y);
  const moved={...c,anchor:{x:c.anchor.x*1.02,y:c.anchor.y*1.02}};
  const fit=snapMovingCurve(moved,state,bounds,40);assert.ok(fit);close(fit.anchor.x,c.anchor.x);close(fit.anchor.y,c.anchor.y);
  assert.equal(snapMovingCurve(moved,state,bounds,40,{altKey:true}),null);
  assert.equal(snapMovingCurve(moved,{...state,axisGapEnabled:true,axisGap:5},bounds,40),null);
  const intercept=snapPoint({x:4.02,y:0.01},buildSnapTargets(state,bounds),40);
  assert.equal(intercept.kind,'intercept');close(intercept.point.x,4);close(intercept.point.y,0);
});

test('PPC independent radii, copies, grouped undo, graph isolation and export preserve ellipse geometry',()=>{
  const store=createStore(),id=store.addIndifference('ppc',{anchor:c.anchor});
  const before=serializeDocument(store.getState());store.beginHistory();
  store.updateSelected({anchor:{x:6/Math.SQRT2,y:c.anchor.y},reshape:true});
  store.updateSelected({anchor:{x:8/Math.SQRT2,y:c.anchor.y},reshape:true});store.endHistory();
  close(ppcRadii(store.getState().curves[0]).x,8);close(ppcRadii(store.getState().curves[0]).y,3);
  store.undo();assert.deepEqual(serializeDocument(store.getState()),before);store.redo();
  store.duplicateSelected();store.selectObject(id);store.duplicateSelected();
  const curves=store.getState().curves;assert.equal(curves.length,3);assert.notDeepEqual(curves[1].anchor,curves[2].anchor);
  for (const curve of curves) close(curve.anchor.y/curve.anchor.x,3/8);
  const doc=JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(doc.curves[0].geometry.type,'ellipse-arc');close(doc.curves[0].geometry.radii.x,8);
  store.configureLayout('horizontal2');store.selectDiagram(store.getState().diagrams[1].id);assert.equal(store.getState().curves.length,0);
});
