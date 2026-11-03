import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { directionOf } from '../src/graph/math.js';
import { curvePoint } from '../src/graph/curve.js';
import { sketchControls, quadraticPoint, translatedSketch } from '../src/graph/sketch.js';
import { snapCurveToTangency } from '../src/graph/tangency.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds={xMin:0,xMax:10,yMin:0,yMax:10};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const pointNear=(a,b)=>{near(a.x,b.x);near(a.y,b.y);};
const cup=store=>store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{mode:'horizontal'});
const pose=(curve,delta)=>({...curve,...translatedSketch(curve,delta)});
function addLine(store,slope,anchor) {const id=store.addLine();store.updateSelected({slope,anchor});return store.getState().lines.find(line=>line.id===id);}
function contact(curve,pieceIndex,t) {
  const points=sketchControls(curve)[pieceIndex],[a,b,c]=points;
  const direction={x:(1-t)*(b.x-a.x)+t*(c.x-b.x),y:(1-t)*(b.y-a.y)+t*(c.y-b.y)};
  return {point:quadraticPoint(points,t),slope:direction.x===0?null:direction.y/direction.x};
}

test('a copied curve finds a different interior tangent on a copied line with a changed slope',()=>{
  const store=createStore(),originalLine=addLine(store,-1,{x:4,y:3});
  const originalId=store.addSketch({x:1,y:8},{x:8,y:8},{x:4,y:3},{lineId:originalLine.id});
  const originalCurve=store.getState().sketches[0];
  store.selectObject(originalLine.id);const lineId=store.duplicateSelected({slopeFactor:0.5});
  store.selectObject(originalId);const copyId=store.duplicateSelected();
  const copy=store.getState().sketches.find(curve=>curve.id===copyId),line=store.getState().lines.find(line=>line.id===lineId);
  const [a,b,c]=sketchControls(copy)[1],slope=line.slope;
  const from=(b.y-a.y)-slope*(b.x-a.x),to=(c.y-b.y)-slope*(c.x-b.x);
  const rawContact=quadraticPoint([a,b,c],-from/(to-from)),d=directionOf(slope),n={x:-d.y,y:d.x};
  const offset=(line.anchor.x-rawContact.x)*n.x+(line.anchor.y-rawContact.y)*n.y;
  const raw=pose(copy,{x:n.x*(offset+0.1),y:n.y*(offset+0.1)});
  const before=serializeDocument(store.getState());
  const result=snapCurveToTangency(raw,store.getState(),bounds,56,{reference:rawContact});
  assert.equal(result.sourceId,lineId);assert.ok(Math.hypot(result.point.x-raw.anchor.x,result.point.y-raw.anchor.y)>0.1);
  near((result.point.x-line.anchor.x)*n.x+(result.point.y-line.anchor.y)*n.y,0);
  assert.deepEqual(serializeDocument(store.getState()),before);
  store.updateSelected({...translatedSketch(copy,{x:result.anchor.x-copy.anchor.x,y:result.anchor.y-copy.anchor.y}),translate:true});
  const after=store.getState().sketches.find(curve=>curve.id===copyId);
  for(const key of ['start','end']) pointNear({x:after[key].x-after.anchor.x,y:after[key].y-after.anchor.y},{x:copy[key].x-copy.anchor.x,y:copy[key].y-copy.anchor.y});
  assert.equal(after.binding,null);assert.deepEqual(after.tangent,copy.tangent);
  assert.deepEqual(store.getState().sketches.find(curve=>curve.id===originalId),originalCurve);
  assert.deepEqual(store.getState().lines.find(item=>item.id===lineId),line);
  const point=snapPoint({x:result.point.x+0.08,y:result.point.y+0.1},buildSnapTargets(store.getState(),bounds),56);
  assert.equal(point.kind,'tangent');pointNear(point.point,result.point);
});

test('moving horizontal and vertical free curves snaps with no rotation or shape change',()=>{
  for(const vertical of [false,true]) {
    const store=createStore();
    if(vertical) store.addSketch({x:6,y:1},{x:6,y:7},{x:2,y:4},{mode:'vertical'});else cup(store);
    const curve=store.getState().sketches[0],line=addLine(store,vertical?null:0,vertical?{x:2.1,y:4}:{x:4,y:2.1});
    const result=snapCurveToTangency(curve,store.getState(),bounds,56);
    assert.ok(result);pointNear(result.point,line.anchor);
    pointNear(result.anchor,line.anchor);assert.equal(curve.binding,null);
  }
});

test('both quadratic pieces support exact oblique tangency under free and Shift movement',()=>{
  for(const piece of [0,1]) for(const axis of [null,'x','y']) {
    const store=createStore();cup(store);const curve=store.getState().sketches[0],target=contact(curve,piece,0.37),d=directionOf(target.slope),n={x:-d.y,y:d.x};
    const line=addLine(store,target.slope,{x:target.point.x+n.x*0.06,y:target.point.y+n.y*0.06});
    const result=snapCurveToTangency(curve,store.getState(),bounds,56,{axis});assert.ok(result);
    near((result.point.x-line.anchor.x)*n.x+(result.point.y-line.anchor.y)*n.y,0);
    if(axis) assert.equal(result.anchor[axis==='x'?'y':'x'],curve.anchor[axis==='x'?'y':'x']);
    else near((result.anchor.x-curve.anchor.x)*d.x+(result.anchor.y-curve.anchor.y)*d.y,0);
  }
});

test('curve magnets capture at 16px, retain to 24px, release, and Alt bypasses all candidates',()=>{
  for(const unit of [8,32,56]) {
    const store=createStore();cup(store);const curve=store.getState().sketches[0];addLine(store,0,{x:4,y:2});
    const at=pixels=>pose(curve,{x:0,y:pixels/unit});
    const first=snapCurveToTangency(at(15),store.getState(),bounds,unit);assert.ok(first);
    assert.equal(snapCurveToTangency(at(17),store.getState(),bounds,unit),null);
    const held=snapCurveToTangency(at(23),store.getState(),bounds,unit,{previous:first});assert.ok(held);near(held.anchor.y,2);
    assert.equal(snapCurveToTangency(at(25),store.getState(),bounds,unit,{previous:held}),null);
    assert.equal(snapCurveToTangency(at(0),store.getState(),bounds,unit,{previous:held,altKey:true}),null);
  }
});

test('Shift keeps its axis and cannot snap a curve along a direction parallel to the line',()=>{
  const store=createStore();cup(store);const curve=store.getState().sketches[0];addLine(store,0,{x:4,y:2.1});
  assert.equal(snapCurveToTangency(curve,store.getState(),bounds,56,{axis:'x'}),null);
  const result=snapCurveToTangency(curve,store.getState(),bounds,56,{axis:'y'});
  assert.equal(result.anchor.x,4);near(result.anchor.y,2.1);
});

test('contacts are clipped after correction, including axis gaps and initially offscreen contacts',()=>{
  const store=createStore();cup(store);const base=store.getState().sketches[0],raw=pose(base,{x:0,y:-2.1});
  addLine(store,0,{x:4,y:0});
  const result=snapCurveToTangency(raw,store.getState(),bounds,56);assert.ok(result);near(result.point.y,0);
  assert.equal(snapCurveToTangency(raw,store.getState(),{...bounds,yMin:0.2},56),null);
  store.update({axisGapEnabled:true,axisGap:1});
  assert.equal(snapCurveToTangency(raw,store.getState(),bounds,56),null);
});

test('a finite curve with no matching tangent stays free without shape changes or invented extensions',()=>{
  const store=createStore();store.addSketch({x:1,y:1},{x:7,y:7},{x:4,y:4},{mode:'vertical'});
  const curve=store.getState().sketches[0];addLine(store,0,{x:4,y:4});
  const before=serializeDocument(store.getState());
  assert.equal(snapCurveToTangency(curve,store.getState(),bounds,56),null);
  assert.deepEqual(serializeDocument(store.getState()),before);
});

test('bound curves and lines derived from the moving curve do not become new magnets',()=>{
  const store=createStore(),source=addLine(store,0,{x:4,y:2});
  store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{lineId:source.id});
  const bound=store.getState().sketches[0];
  assert.equal(snapCurveToTangency(bound,store.getState(),bounds,56),null);
  store.detachSelected();store.markMinimum();const dependent=store.lineThroughSelectedPoint();
  const state=store.getState();state.lines=state.lines.filter(line=>line.id===dependent);
  assert.equal(snapCurveToTangency(state.sketches[0],state,bounds,56),null);
});

test('nearest target is retained while dragging, and removing that target releases it',()=>{
  const store=createStore();cup(store);const curve=store.getState().sketches[0];
  const first=addLine(store,0,{x:4,y:2.02}),second=addLine(store,0,{x:4,y:2.15});
  const initial=snapCurveToTangency(curve,store.getState(),bounds,56);assert.equal(initial.sourceId,first.id);
  const raw=pose(curve,{x:0,y:0.14});
  assert.equal(snapCurveToTangency(raw,store.getState(),bounds,56,{previous:initial}).sourceId,first.id);
  const state=store.getState();state.lines=state.lines.filter(line=>line.id!==first.id);
  assert.equal(snapCurveToTangency(raw,state,bounds,56,{previous:initial}).sourceId,second.id);
});

test('basic curve cores and their existing tangent continuations can move onto lines',()=>{
  for(const extension of [false,true]) {
    const store=createStore();store.addCurve({variant:'ascending'});const curve=store.getState().curves[0];
    const t=extension?1:0.37,slope=curve.slope+2*curve.bend*t,base=curvePoint(curve,t),d=directionOf(slope),n={x:-d.y,y:d.x};
    const expected=extension?{x:base.x+1,y:base.y+slope}:base;
    const line=addLine(store,slope,{x:expected.x+n.x*0.1,y:expected.y+n.y*0.1});
    const result=snapCurveToTangency(curve,store.getState(),bounds,56,{reference:line.anchor});assert.ok(result);
    near((result.point.x-line.anchor.x)*n.x+(result.point.y-line.anchor.y)*n.y,0);
    near(Math.hypot(result.anchor.x-curve.anchor.x,result.anchor.y-curve.anchor.y),0.1);
  }
});

test('straight free pieces choose a visible contact near the pointer after translation',()=>{
  const store=createStore();store.addSketch({x:-20,y:2},{x:20,y:2},{x:4,y:2},{mode:'horizontal'});
  const curve=store.getState().sketches[0];addLine(store,0,{x:4,y:2.1});
  const result=snapCurveToTangency(curve,store.getState(),bounds,56,{reference:{x:6,y:2.1}});
  pointNear(result.point,{x:6,y:2.1});pointNear(result.anchor,{x:4,y:2.1});
});

test('a snapped curve drag, its dependent minimum and JSON undo together in reflected axes',()=>{
  const store=createStore(),id=cup(store);store.markMinimum();const target=addLine(store,0,{x:4,y:2.1});store.selectObject(id);
  const curve=store.getState().sketches[0],before=serializeDocument(store.getState());store.beginHistory();
  for(const flipX of [false,true]) for(const flipY of [false,true]) {
    const viewport=createViewport(800,600,'first',{flipX,flipY});
    const result=snapCurveToTangency(curve,store.getState(),viewport.bounds,viewport.unit);
    store.updateSelected({...translatedSketch(curve,{x:result.anchor.x-curve.anchor.x,y:result.anchor.y-curve.anchor.y}),translate:true});
    near(store.getState().points[0].anchor.y,2.1);
  }
  store.endHistory();const after=serializeDocument(store.getState());
  assert.deepEqual(store.getState().lines.find(line=>line.id===target.id),target);
  store.undo();assert.deepEqual(serializeDocument(store.getState()),before);store.redo();assert.deepEqual(serializeDocument(store.getState()),after);
});
