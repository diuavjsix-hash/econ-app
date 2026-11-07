import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { INDIFFERENCE_FAMILIES, moveIndifference, indifferenceValue, indifferenceContact, indifferenceOnLine, indifferenceThroughPoint, indifferenceLineIntersections, indifferenceShapeHandle, shapeIndifference, clipIndifference } from '../src/graph/indifference.js';
import { displayedCurveSegments } from '../src/graph/display.js';
import { snapMovingCurve, snapShapeToPoint } from '../src/graph/point-magnets.js';
import { snapLineToTangency } from '../src/graph/tangency.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';

const bounds={xMin:0,xMax:16,yMin:0,yMax:16};
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const curve=(family,extra={})=>({id:'curve-1',type:'curve',family,anchor:{x:3,y:4},shape:1.4,linearAxis:'y',...extra});
const stateOf=c=>({lines:[],curves:[c],sketches:[],sums:[],points:[],dashedLines:[],axisGapEnabled:false});

test('Cobb-Douglas movement is a homothety about the origin, including a grab away from the anchor',()=>{
  const c=curve('cobb-douglas'),start={x:2,y:indifferenceValue(c,2)},point={x:start.x*1.7,y:start.y*1.7};
  const anchor=moveIndifference(c,start,point),moved={...c,anchor};
  close(anchor.x/c.anchor.x,1.7);close(anchor.y/c.anchor.y,1.7);
  for (const x of [0.3,1,3,8]) close(indifferenceValue(moved,1.7*x),1.7*indifferenceValue(c,x));
  assert.ok(moveIndifference(c,start,{x:-20,y:-30}).x>0);
});

test('complement kinks stay on a ray and their arms remain exactly horizontal and vertical',()=>{
  const c=curve('complements'),anchor=moveIndifference(c,{x:5,y:4},{x:10,y:8});
  close(anchor.x/c.anchor.x,anchor.y/c.anchor.y);
  const segments=clipIndifference({...c,anchor},bounds);
  assert.equal(segments.length,2);
  assert.ok(segments.some(([a,,b])=>a.x===b.x));assert.ok(segments.some(([a,,b])=>a.y===b.y));
  const changed=shapeIndifference(c,{x:2,y:8});close(changed.anchor.y/changed.anchor.x,4);
});

test('substitutes move in parallel and quasi-linear curves translate only on the chosen linear axis',()=>{
  const c=curve('substitutes'),anchor=moveIndifference(c,{x:2,y:3},{x:4,y:7});
  close(indifferenceValue({...c,anchor},6)-indifferenceValue({...c,anchor},5),-c.shape);
  for (const linearAxis of ['x','y']) {
    const q=curve('quasilinear',{linearAxis}),a=moveIndifference(q,{x:2,y:3},{x:6,y:8});
    assert.equal(a[linearAxis==='x'?'y':'x'],q.anchor[linearAxis==='x'?'y':'x']);
    for (const input of [1,3,9]) close(indifferenceValue({...q,anchor:a},input,linearAxis==='x'?'horizontal':'vertical')-indifferenceValue(q,input,linearAxis==='x'?'horizontal':'vertical'),linearAxis==='x'?4:5);
  }
});

test('all analytic families clip to nonnegative coordinates and axis-gap regions without changing source data',()=>{
  for (const family of Object.keys(INDIFFERENCE_FAMILIES)) for (const linearAxis of ['x','y']) {
    const c=curve(family,{linearAxis}),before=structuredClone(c);
    const segments=displayedCurveSegments(c,{xMin:-8,xMax:16,yMin:-8,yMax:16},{axisGapEnabled:true,axisGap:0.75});
    assert.ok(segments.length);
    for (const piece of segments) for (const p of piece) assert.ok(p.x>=0.75-1e-8 && p.x<=16+1e-8 && p.y>=0.75-1e-8 && p.y<=16+1e-8);
    assert.deepEqual(c,before);
  }
});

test('Cobb-Douglas and quasi-linear curves match new budget slopes exactly while preserving preferences',()=>{
  for (const family of ['cobb-douglas','quasilinear','complements']) for (const linearAxis of ['x','y']) for (const slope of [-0.3,-1,-3]) {
    const c=curve(family,{linearAxis}),line={anchor:{x:0,y:12},slope},result=indifferenceOnLine(c,line);
    assert.ok(result);close(result.point.y,12+slope*result.point.x);
    if (family==='cobb-douglas'||family==='complements') close(result.anchor.x/c.anchor.x,result.anchor.y/c.anchor.y);
    else assert.equal(result.anchor[linearAxis==='x'?'y':'x'],c.anchor[linearAxis==='x'?'y':'x']);
    const moved={...c,anchor:result.anchor};
    if (family!=='complements') {
      const dx=1e-5;
      close((indifferenceValue(moved,result.point.x+dx)-indifferenceValue(moved,result.point.x-dx))/(2*dx),slope,1e-6);
    }
  }
});

test('perfect substitutes support either corner or coincident parallel budgets',()=>{
  const c=curve('substitutes',{shape:1});
  for (const slope of [-0.5,-1,-2]) {
    const result=indifferenceOnLine(c,{anchor:{x:0,y:8},slope});assert.ok(result);
    close(result.point.y,8+slope*result.point.x);
    if (slope===-0.5) {close(result.point.x,16);close(result.point.y,0);}
    if (slope===-2) {close(result.point.x,0);close(result.point.y,8);}
  }
  assert.equal(indifferenceOnLine(c,{anchor:{x:0,y:8},slope:1}),null);
  assert.equal(indifferenceOnLine(c,{anchor:{x:0,y:8},slope:null}),null);
});

test('point fitting changes level only and exactly passes through the requested nonnegative point',()=>{
  const p={x:6,y:5};
  for (const family of Object.keys(INDIFFERENCE_FAMILIES)) for (const linearAxis of ['x','y']) {
    const c=curve(family,{linearAxis}),anchor=indifferenceThroughPoint(c,p),moved={...c,anchor};assert.ok(anchor);
    if (family==='complements') {assert.ok(p.x>=anchor.x-1e-9 && p.y>=anchor.y-1e-9);close(Math.min(p.x/anchor.x,p.y/anchor.y),1);}
    else close(indifferenceValue(moved,p.x),p.y);
  }
});

test('curve and line magnets retain analytic contacts and obey Alt, capture, release and clipping',()=>{
  const c=curve('cobb-douglas'),contact=indifferenceContact(c,-1),line={id:'line-1',type:'line',slope:-1,anchor:{x:contact.x,y:contact.y+0.1}},state={...stateOf(c),lines:[line]};
  const snapped=snapMovingCurve(c,state,bounds,40);assert.ok(snapped);close(snapped.point.y,line.anchor.y-(snapped.point.x-line.anchor.x));
  assert.equal(snapMovingCurve(c,state,bounds,40,{altKey:true}),null);
  const distant={...c,anchor:{x:10,y:12}};assert.equal(snapMovingCurve(distant,state,bounds,40),null);
  const lineSnap=snapLineToTangency(line,state,bounds,40);assert.ok(lineSnap);close(lineSnap.point.x,contact.x);
  const hidden={...state,axisGapEnabled:true,axisGap:5};assert.equal(snapMovingCurve(c,hidden,bounds,40),null);
  const drifted={...c,anchor:{x:c.anchor.x+0.25,y:c.anchor.y+0.25}};
  assert.ok(snapMovingCurve(drifted,state,bounds,40,{previous:snapped}));
});

test('existing-point magnets respect radial and quasi-linear movement and never change the point',()=>{
  for (const family of ['cobb-douglas','quasilinear','complements','substitutes']) {
    const c=curve(family),point={id:'point-1',type:'point',anchor:{x:c.anchor.x,y:c.anchor.y+0.05}},state={...stateOf(c),points:[point]};
    const before=structuredClone(point),snap=snapShapeToPoint(c,state,bounds,40);assert.ok(snap);
    if (family==='cobb-douglas'||family==='complements') close(snap.anchor.x/c.anchor.x,snap.anchor.y/c.anchor.y);
    if (family==='quasilinear') assert.equal(snap.anchor.x,c.anchor.x);
    assert.deepEqual(point,before);
  }
});

test('point placement finds analytic tangencies and two true crossings rather than display chord intersections',()=>{
  for (const family of ['cobb-douglas','quasilinear']) for (const linearAxis of ['x','y']) {
    const c=curve(family,{linearAxis}),point=indifferenceContact(c,-1),line={id:'line-1',type:'line',anchor:point,slope:-1};
    const hits=indifferenceLineIntersections(c,line,bounds);assert.equal(hits.length,1);assert.equal(hits[0].kind,'tangent');close(hits[0].point.x,point.x);
    const targets=buildSnapTargets({...stateOf(c),lines:[line]},bounds),snap=snapPoint({x:point.x+0.01,y:point.y+0.01},targets,40);
    assert.equal(snap.kind,'tangent');close(snap.point.x,point.x);close(snap.point.y,point.y);
    const crossings=indifferenceLineIntersections(c,{...line,anchor:{...point,y:point.y+0.8}},bounds);
    assert.equal(crossings.length,2);for (const hit of crossings) close(indifferenceValue(c,hit.point.x),hit.point.y);
  }
});

test('creation, preference edits, repeated copies, history, graph isolation, deletion and JSON preserve each family',()=>{
  const store=createStore();
  for (const family of Object.keys(INDIFFERENCE_FAMILIES)) {
    const id=store.addIndifference(family),before=store.getState().curves.find(c=>c.id===id);
    store.updateSelected({shape:2});const original=store.getState().curves.find(c=>c.id===id);
    const first=store.duplicateSelected();store.selectObject(id);const second=store.duplicateSelected();
    const copies=store.getState().curves.filter(c=>[first,second].includes(c.id));assert.equal(copies.length,2);
    assert.notDeepEqual(copies[0].anchor,copies[1].anchor);
    for (const copy of copies) {assert.equal(copy.family,family);assert.equal(copy.shape,['rectangular-hyperbola','ppc'].includes(family)?1:2);
      if (family==='quasilinear') assert.equal(copy.anchor.x,original.anchor.x);
      if (family==='cobb-douglas'||family==='complements') close(copy.anchor.y/copy.anchor.x,original.anchor.y/original.anchor.x);
    }
    store.undo();assert.ok(!store.getState().curves.some(c=>c.id===second));store.redo();
    assert.deepEqual(store.getState().curves.find(c=>c.id===id),original);
    assert.equal(before.family,family);
  }
  const doc=serializeDocument(store.getState());assert.equal(doc.schemaVersion,11);
  assert.equal(doc.curves.length,3*Object.keys(INDIFFERENCE_FAMILIES).length);assert.deepEqual(doc.curves,doc.diagrams[0].curves);
  assert.ok(!JSON.stringify(doc).includes('quadratic-bezier'));
  for (const c of JSON.parse(JSON.stringify(doc)).curves) assert.ok(Number.isFinite(c.anchor.x) && Number.isFinite(c.anchor.y) && Number.isFinite(c.shape));
  store.configureLayout('horizontal2');store.selectDiagram(store.getState().diagrams[1].id);assert.equal(store.getState().curves.length,0);
  store.addIndifference('quasilinear');store.updateSelected({linearAxis:'x'});assert.equal(store.getState().curves[0].linearAxis,'x');
  const c=store.getState().curves[0];store.updateSelected({anchor:{x:-3,y:c.anchor.y}});assert.equal(store.getState().curves[0].anchor.x,-3);
  store.updateSelected({linearAxis:'y'});assert.equal(store.getState().curves[0].anchor.y,-3);
  store.clearAll();assert.equal(store.getState().curves.length,0);store.undo();assert.equal(store.getState().curves.length,1);
  store.removeSelected();assert.equal(store.getState().curves.length,0);
  store.addIndifference('quasilinear',{anchor:{x:1e100,y:2}});assert.equal(store.getState().curves[0].shape,20);
});

test('indifference curves cannot silently enter the old quadratic sum evaluator',()=>{
  const store=createStore(),a=store.addIndifference('complements'),b=store.addLine();
  assert.equal(store.addSum([a,b]),null);
});

test('fixed preference levels support manual compensation and unchanged quasi-linear tangency coordinates',()=>{
  const c=curve('cobb-douglas'),before=structuredClone(c);
  const original=indifferenceContact(c,-1),compensated=indifferenceContact(c,-0.5);
  close(indifferenceValue(c,compensated.x),compensated.y);assert.notEqual(original.x,compensated.x);
  assert.deepEqual(c,before);
  const q=curve('quasilinear'),line={slope:-0.7,anchor:{x:0,y:10}};
  const low=indifferenceOnLine(q,line),high=indifferenceOnLine(q,{...line,anchor:{x:0,y:13}});
  close(low.point.x,high.point.x);close(high.point.y-low.point.y,3);
  const complement=curve('complements'),contact=indifferenceContact(complement,-3);
  assert.deepEqual(contact,indifferenceContact(complement,-0.2));
});

test('substitute corners stay intersections, and low levels plus shape editing stay in the positive domain',()=>{
  const c=curve('substitutes',{shape:2}),b=c.anchor.y+2*c.anchor.x;
  const hits=indifferenceLineIntersections(c,{anchor:{x:0,y:b},slope:-3},bounds);
  assert.equal(hits.length,1);assert.equal(hits[0].kind,'intersection');
  const anchor=moveIndifference(c,c.anchor,{x:-100,y:-100});assert.ok(anchor.x>0 && anchor.y>0);
  const reshaped={...c,anchor,shape:0.15};assert.ok(clipIndifference(reshaped,bounds).length);
  assert.equal(indifferenceThroughPoint(curve('cobb-douglas'),{x:0.0001,y:0.0001}),null);
});

test('shape handles stay on the exact visible curve after reflecting the quasi-linear axis',()=>{
  for (const family of Object.keys(INDIFFERENCE_FAMILIES)) for (const linearAxis of ['x','y']) {
    const c=curve(family,{anchor:{x:5,y:7},linearAxis}),view={xMin:0,xMax:12,yMin:0,yMax:9},p=indifferenceShapeHandle(c,view);
    assert.ok(p.x>=0 && p.x<=12 && p.y>=0 && p.y<=9);
    if (family!=='complements') close(indifferenceValue(c,p.x),p.y);
  }
});
