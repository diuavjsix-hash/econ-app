import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { directionOf } from '../src/graph/math.js';
import { curvePoint } from '../src/graph/curve.js';
import { sketchControls, quadraticPoint, translatedSketch } from '../src/graph/sketch.js';
import { nearestQuadraticPoint } from '../src/graph/snap.js';
import { snapShapeToPoint, snapMovingCurve } from '../src/graph/point-magnets.js';
import { snapMovingLine } from '../src/graph/intercepts.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds={xMin:0,xMax:12,yMin:0,yMax:10};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const pointNear=(a,b)=>{near(a.x,b.x);near(a.y,b.y);};
function line(store,slope=0,anchor={x:3,y:3}) {const id=store.addLine();store.updateSelected({slope,anchor});return store.getState().lines.find(o=>o.id===id);}
function cup(store) {store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{mode:'horizontal'});return store.getState().sketches[0];}
const pose=(curve,delta)=>({...curve,...translatedSketch(curve,delta)});
function target(store,point) {const id=store.addPoint(point);return store.getState().points.find(o=>o.id===id);}
function distanceToSketch(curve,point) {return Math.min(...sketchControls(curve).map(points=>{const nearest=nearestQuadraticPoint(points,point);return Math.hypot(nearest.x-point.x,nearest.y-point.y);}));}

test('horizontal, true vertical and oblique lines translate through a marked point with slope unchanged',()=>{
  for(const slope of [0,null,-0.7,1e12]) {
    const store=createStore(),shape=line(store,slope),d=directionOf(slope),n={x:-d.y,y:d.x};
    const point=target(store,{x:shape.anchor.x+2*d.x+0.1*n.x,y:shape.anchor.y+2*d.y+0.1*n.y});
    const before=serializeDocument(store.getState()),snap=snapShapeToPoint(shape,store.getState(),bounds,56);assert.ok(snap);
    assert.equal(snap.kind,'point');assert.equal(snap.sourceId,point.id);pointNear(snap.point,point.anchor);
    near((point.anchor.x-snap.anchor.x)*n.x+(point.anchor.y-snap.anchor.y)*n.y,0);
    near((snap.anchor.x-shape.anchor.x)*d.x+(snap.anchor.y-shape.anchor.y)*d.y,0);
    assert.deepEqual(serializeDocument(store.getState()),before);
    store.selectObject(shape.id);store.updateSelected({anchor:snap.anchor});assert.equal(store.getState().lines[0].slope,slope);
    assert.deepEqual(store.getState().points[0],point);
  }
});

test('either free quadratic piece can pass a point between mesh vertices without changing shape',()=>{
  for(const index of [0,1]) {
    const store=createStore(),curve=cup(store),points=sketchControls(curve)[index],t=0.373,[a,b,c]=points,foot=quadraticPoint(points,t);
    const dx=(1-t)*(b.x-a.x)+t*(c.x-b.x),dy=(1-t)*(b.y-a.y)+t*(c.y-b.y),length=Math.hypot(dx,dy);
    const point=target(store,{x:foot.x-dy/length*0.1,y:foot.y+dx/length*0.1});
    const result=snapShapeToPoint(curve,store.getState(),bounds,56);assert.ok(result);
    const moved=pose(curve,{x:result.anchor.x-curve.anchor.x,y:result.anchor.y-curve.anchor.y});
    near(distanceToSketch(moved,point.anchor),0);
    for(const key of ['start','end']) pointNear({x:moved[key].x-moved.anchor.x,y:moved[key].y-moved.anchor.y},{x:curve[key].x-curve.anchor.x,y:curve[key].y-curve.anchor.y});
    assert.deepEqual(moved.tangent,curve.tangent);assert.equal(moved.leftReach,curve.leftReach);assert.equal(moved.rightReach,curve.rightReach);
  }
});

test('basic quadratic cores and their existing tangent tails pass marked points exactly',()=>{
  for(const extension of [false,true]) {
    const store=createStore();store.addCurve({variant:'descending'});const curve=store.getState().curves[0],t=extension?1:0.37;
    const start=curvePoint(curve,t),slope=curve.slope+2*curve.bend*t,d=directionOf(slope),n={x:-d.y,y:d.x};
    const foot=extension?{x:start.x+1,y:start.y+slope}:start;
    const point=target(store,{x:foot.x+n.x*0.1,y:foot.y+n.y*0.1});
    const snap=snapShapeToPoint(curve,store.getState(),bounds,56);assert.ok(snap);
    pointNear({x:snap.anchor.x-curve.anchor.x,y:snap.anchor.y-curve.anchor.y},{x:n.x*0.1,y:n.y*0.1});
    const moved={...curve,anchor:snap.anchor},expected=curvePoint(moved,t);
    if(extension){expected.x+=1;expected.y+=slope;}
    pointNear(expected,point.anchor);assert.equal(moved.bend,curve.bend);assert.equal(moved.span,curve.span);
  }
});

test('Shift moves lines and free curves through points without changing the locked coordinate',()=>{
  for(const axis of ['x','y']) {
    const store=createStore(),curve=cup(store),foot=quadraticPoint(sketchControls(curve)[1],0.37);
    const point=target(store,{...foot,[axis]:foot[axis]+0.12});
    const snap=snapShapeToPoint(curve,store.getState(),bounds,56,{axis});assert.ok(snap);
    assert.equal(snap.anchor[axis==='x'?'y':'x'],curve.anchor[axis==='x'?'y':'x']);
    const moved=pose(curve,{x:snap.anchor.x-curve.anchor.x,y:snap.anchor.y-curve.anchor.y});near(distanceToSketch(moved,point.anchor),0);
    const other=createStore(),straight=line(other,-1),marked=target(other,{x:4,y:2.1});
    const lineSnap=snapShapeToPoint(straight,other.getState(),bounds,56,{axis});assert.ok(lineSnap);
    assert.equal(lineSnap.anchor[axis==='x'?'y':'x'],straight.anchor[axis==='x'?'y':'x']);near(lineSnap.anchor.x+lineSnap.anchor.y,marked.anchor.x+marked.anchor.y);
  }
});

test('Shift does not deform a curve to reach an unavailable coordinate or jump a parallel line',()=>{
  const store=createStore(),curve=cup(store);target(store,{x:4,y:1.9});
  assert.equal(snapShapeToPoint(curve,store.getState(),bounds,56,{axis:'x'}),null);
  assert.ok(snapShapeToPoint(curve,store.getState(),bounds,56,{axis:'y'}));
  const other=createStore(),horizontal=line(other);target(other,{x:6,y:3.1});
  assert.equal(snapShapeToPoint(horizontal,other.getState(),bounds,56,{axis:'x'}),null);
});

test('straight free pieces handle coincident coordinates and move a finite endpoint onto a point',()=>{
  const store=createStore();store.addSketch({x:1,y:3},{x:7,y:3},{x:4,y:3},{mode:'horizontal'});
  const curve=store.getState().sketches[0],point=target(store,{x:7.1,y:3});
  const result=snapShapeToPoint(curve,store.getState(),bounds,56,{axis:'x'});assert.ok(result);
  const moved=pose(curve,{x:result.anchor.x-curve.anchor.x,y:0});pointNear(moved.end,point.anchor);near(moved.start.x,1.1);
});

test('marked-point magnets capture at 16px, retain to 24px, release and obey Alt for both shapes',()=>{
  for(const unit of [8,32,56])for(const isCurve of [false,true]) {
    const store=createStore(),shape=isCurve?cup(store):line(store),anchor={x:shape.anchor.x,y:shape.anchor.y};
    target(store,anchor);const at=px=>isCurve?pose(shape,{x:0,y:px/unit}):({...shape,anchor:{x:anchor.x,y:anchor.y+px/unit}});
    const initial=snapShapeToPoint(at(15),store.getState(),bounds,unit);assert.ok(initial);
    assert.equal(snapShapeToPoint(at(17),store.getState(),bounds,unit),null);
    const held=snapShapeToPoint(at(23),store.getState(),bounds,unit,{previous:initial});assert.ok(held);near(held.anchor.y,anchor.y);
    assert.equal(snapShapeToPoint(at(25),store.getState(),bounds,unit,{previous:held}),null);
    assert.equal(snapShapeToPoint(at(0),store.getState(),bounds,unit,{previous:held,altKey:true}),null);
  }
});

test('points remain usable inside axis gaps, but offscreen and self-derived points are excluded',()=>{
  const store=createStore(),shape=line(store,0,{x:3,y:0.1});target(store,{x:4,y:0});store.update({axisGapEnabled:true,axisGap:0.75});
  assert.ok(snapShapeToPoint(shape,store.getState(),bounds,56));
  assert.equal(snapShapeToPoint(shape,store.getState(),{...bounds,xMax:3},56),null);
  const other=createStore(),curve=cup(other);other.markMinimum();
  assert.equal(snapShapeToPoint(curve,other.getState(),bounds,56),null);
  const targetLine=other.lineThroughSelectedPoint();
  assert.equal(snapShapeToPoint(other.getState().lines.find(l=>l.id===targetLine),other.getState(),bounds,56),null);
});

test('explicit closer points take over from a captured origin or tangent rather than getting stuck',()=>{
  const store=createStore(),moving=line(store,1);target(store,{x:5,y:5.2});
  const origin=snapMovingLine(moving,store.getState(),bounds,56);assert.equal(origin.kind,'intercept');
  const point=snapMovingLine({...moving,anchor:{x:3,y:3.2}},store.getState(),bounds,56,{previous:origin});assert.equal(point.kind,'point');
  const other=createStore(),curve=cup(other);line(other,0,{x:4,y:2.1});
  const tangent=snapMovingCurve(curve,other.getState(),bounds,56);assert.equal(tangent.kind,'tangent');
  target(other,{x:curve.anchor.x,y:curve.anchor.y+0.04});
  assert.equal(snapMovingCurve(curve,other.getState(),bounds,56,{previous:tangent}).kind,'point');
});

test('a captured point stays stable among nearby points and deletion releases that target',()=>{
  const store=createStore(),shape=line(store,0,{x:3,y:4.03}),a=target(store,{x:4,y:4}),b=target(store,{x:7,y:4.2});
  const initial=snapShapeToPoint(shape,store.getState(),bounds,56);assert.equal(initial.sourceId,a.id);
  const raw={...shape,anchor:{x:3,y:4.19}};assert.equal(snapShapeToPoint(raw,store.getState(),bounds,56,{previous:initial}).sourceId,a.id);
  const state=store.getState();state.points=state.points.filter(p=>p.id!==a.id);
  assert.equal(snapShapeToPoint(raw,state,bounds,56,{previous:initial}).sourceId,b.id);
});

test('point magnets use only the active graph and keep mathematical coordinates under reflection',()=>{
  const store=createStore(),shape=line(store,0,{x:3,y:3}),point=target(store,{x:5,y:3.1});
  for(const flipX of [false,true])for(const flipY of [false,true]) {
    const viewport=createViewport(800,600,'first',{flipX,flipY}),snap=snapShapeToPoint(shape,store.getState(),viewport.bounds,viewport.unit);
    assert.ok(snap);near(snap.anchor.y,point.anchor.y);
  }
  store.configureLayout('face2');store.selectDiagram(store.getState().diagrams[1].id);const other=line(store);
  assert.equal(snapShapeToPoint(other,store.getState(),bounds,56),null);
});

test('a curve drag through a marked point is one undo with source points and shape metadata intact',()=>{
  const store=createStore(),curve=cup(store),point=target(store,{x:4,y:2.1});store.selectObject(curve.id);
  const before=serializeDocument(store.getState()),result=snapMovingCurve(curve,store.getState(),bounds,56);assert.equal(result.kind,'point');
  store.beginHistory();store.updateSelected({...translatedSketch(curve,{x:result.anchor.x-curve.anchor.x,y:result.anchor.y-curve.anchor.y}),translate:true});store.endHistory();
  const after=serializeDocument(store.getState());near(distanceToSketch(store.getState().sketches[0],point.anchor),0);
  assert.deepEqual(store.getState().points[0],point);assert.equal(store.getState().sketches[0].binding,null);
  store.undo();assert.deepEqual(serializeDocument(store.getState()),before);store.redo();assert.deepEqual(serializeDocument(store.getState()),after);
});
