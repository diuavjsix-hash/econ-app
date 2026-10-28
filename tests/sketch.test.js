import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { objectsOf } from '../src/objects.js';
import { sketchControls, sketchMinimum, quadraticPoint, displayedSketchSegments, projectOnLine } from '../src/graph/sketch.js';
import { directionOf } from '../src/graph/math.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { serializeDocument } from '../src/export.js';
import { canAttach } from '../src/relations.js';

const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const cup=store=>store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{mode:'horizontal'});
const sketch=store=>store.getState().sketches[0];
function addLine(store,slope=0) {const id=store.addLine();store.updateSelected({slope,anchor:{x:4,y:2}});return id;}

test('three exact points and a shared tangent determine an editable curve with independent sides',()=>{
  const store=createStore(), id=cup(store), curve=sketch(store), [left,right]=sketchControls(curve);
  assert.equal(id,'sketch-1');assert.deepEqual(left[0],curve.start);assert.deepEqual(left[2],curve.anchor);
  assert.deepEqual(right[0],curve.anchor);assert.deepEqual(right[2],curve.end);
  assert.deepEqual(sketchMinimum(curve),curve.anchor);
  store.updateSelected({leftReach:1.2,rightReach:0.2});
  const changed=sketchControls(sketch(store));
  assert.notDeepEqual(changed[0][1],left[1]);assert.notDeepEqual(changed[1][1],right[1]);
  assert.deepEqual(sketch(store).start,curve.start);assert.deepEqual(sketch(store).anchor,curve.anchor);
  store.updateSelected({tangent:{x:0,y:1}});
  const pieces=sketchControls(sketch(store));near(pieces[0][1].x,curve.anchor.x);near(pieces[1][1].x,curve.anchor.x);
});

test('invalid or coincident points reject without allocating IDs or history; translation moves all three',()=>{
  const store=createStore();
  assert.equal(store.addSketch({x:0,y:0},{x:0,y:0},{x:1,y:1}),null);
  assert.equal(store.addSketch({x:0,y:0},{x:1,y:1},{x:Infinity,y:2}),null);
  assert.equal(store.getState().canUndo,false);assert.equal(cup(store),'sketch-1');
  const original=sketch(store);
  store.updateSelected({start:{...original.anchor}});assert.deepEqual(sketch(store),original);
  store.updateSelected({anchor:{x:5,y:3},translate:true});
  for (const key of ['anchor','start','end']) {near(sketch(store)[key].x,original[key].x+1);near(sketch(store)[key].y,original[key].y+1);}
  store.undo();assert.deepEqual(sketch(store),original);
});

test('line tangency follows translation, rotation and true vertical slopes; detach preserves geometry',()=>{
  const store=createStore(), line=addLine(store,-1);
  const id=store.addSketch({x:1,y:7},{x:7,y:1},{x:4,y:2},{lineId:line});
  store.selectObject(line);store.updateSelected({anchor:{x:5,y:4},slope:null});
  let curve=sketch(store);assert.equal(curve.anchor.x,5);assert.equal(curve.tangent.x,0);
  const [left,right]=sketchControls(curve);near(left[1].x,5);near(right[1].x,5);
  store.selectObject(id);store.updateSelected({anchor:{x:100,y:6}});near(sketch(store).anchor.x,5);near(sketch(store).anchor.y,6);
  const before=sketch(store);store.detachSelected();
  store.selectObject(line);store.updateSelected({anchor:{x:2,y:3},slope:1});
  assert.deepEqual(sketch(store).anchor,before.anchor);assert.deepEqual(sketch(store).tangent,before.tangent);
  store.selectObject(id);store.updateSelected({tangent:{x:1,y:0}});near(sketch(store).tangent.y,0);
});

test('attached whole-curve translation slides along the line without distorting endpoints',()=>{
  const store=createStore(), line=addLine(store,1);
  store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{lineId:line});
  const before=sketch(store);
  store.updateSelected({anchor:{x:8,y:2},translate:true});
  const after=sketch(store), delta={x:after.anchor.x-before.anchor.x,y:after.anchor.y-before.anchor.y};
  near(delta.x,2);near(delta.y,2);
  for(const key of ['start','end']) {near(after[key].x-before[key].x,delta.x);near(after[key].y-before[key].y,delta.y);}
});

test('minimum is the true finite-curve global minimum, including interior extrema away from middle',()=>{
  const store=createStore();cup(store);store.updateSelected({tangent:{x:1,y:0.7},leftReach:1.7,rightReach:1.1});
  const curve=sketch(store), min=sketchMinimum(curve);
  assert.ok(min.y<curve.anchor.y);
  for(const points of sketchControls(curve)) for(let i=0;i<=1000;i++) assert.ok(quadraticPoint(points,i/1000).y>=min.y-1e-8);
  store.updateSelected({start:{x:1,y:-5},tangent:{x:1,y:0}});near(sketchMinimum(sketch(store)).y,-5);
});

test('minimum point and a line follow curve edits in dependency order, with independent line slope',()=>{
  const store=createStore(), curve=cup(store), point=store.markMinimum(), line=store.lineThroughSelectedPoint();
  store.selectObject(curve);store.updateSelected({anchor:{x:3,y:1}});
  let state=store.getState();assert.deepEqual(state.points[0].anchor,{x:3,y:1});assert.deepEqual(state.lines[0].anchor,state.points[0].anchor);
  store.selectObject(line);store.updateSelected({slope:null});assert.equal(store.getState().lines[0].slope,null);
  store.selectObject(point);store.detachSelected();
  store.selectObject(curve);store.updateSelected({anchor:{x:4,y:0}});
  state=store.getState();assert.deepEqual(state.points[0].anchor,{x:3,y:1});assert.deepEqual(state.lines[0].anchor,{x:3,y:1});
  store.selectObject(line);store.detachSelected();store.updateSelected({anchor:{x:8,y:8}});assert.deepEqual(store.getState().lines[0].anchor,{x:8,y:8});
});

test('point-through-line optionally freezes and dependency cycles are rejected without document edits',()=>{
  const store=createStore(), curve=cup(store), point=store.markMinimum();
  const frozen=store.lineThroughSelectedPoint({follow:false});
  store.selectObject(point);const following=store.lineThroughSelectedPoint();
  assert.equal(canAttach(store.getState(),curve,following),false);
  store.selectObject(curve);const before=serializeDocument(store.getState());
  assert.equal(store.attachSelectedToLine(following),false);assert.deepEqual(serializeDocument(store.getState()),before);
  assert.equal(store.attachSelectedToLine(frozen),true);
});

test('deleting relation sources freezes surviving geometry and undo restores the full relation chain',()=>{
  const store=createStore(), line=addLine(store), curve=store.addSketch({x:1,y:5},{x:7,y:5},{x:4,y:2},{lineId:line});
  const point=store.markMinimum(), through=store.lineThroughSelectedPoint();
  store.selectObject(line);const original=serializeDocument(store.getState());store.removeSelected();
  assert.equal(sketch(store).binding,null);store.undo();assert.deepEqual(serializeDocument(store.getState()),original);
  store.selectObject(curve);const min={...store.getState().points[0].anchor};store.removeSelected();
  assert.equal(store.getState().points[0].binding,null);assert.deepEqual(store.getState().points[0].anchor,min);
  store.selectObject(point);store.removeSelected();assert.equal(store.getState().lines.find(l=>l.id===through).binding,null);
});

test('sketches copy independently, preserve hierarchy and export full internal geometry and relations',()=>{
  const store=createStore(), source=addLine(store), id=store.addSketch({x:1,y:6},{x:7,y:6},{x:4,y:2},{lineId:source});
  const copy=store.duplicateSelected({placement:'right'}), state=store.getState();
  assert.equal(copy,'sketch-2');assert.equal(state.sketches[1].binding,null);
  for(const key of ['start','anchor','end']) near(state.sketches[1][key].x,state.sketches[0][key].x+1);
  const group=store.addGroup();store.moveObject(id,group);
  const exportedState=store.getState(), doc=serializeDocument(exportedState);assert.equal(doc.schemaVersion,8);assert.deepEqual(doc.sketches,doc.diagrams[0].sketches);
  assert.equal(doc.sketches[0].parentId,group);assert.equal(doc.sketches[0].binding.sourceId,source);
  assert.equal(doc.sketches[0].geometry.type,'piecewise-quadratic-bezier');assert.ok(!('collapsed' in doc.sketches[0]));
  doc.sketches[0].start.x=999;assert.equal(sketch(store).start.x,1);
  doc.sketches[0].geometry.controlPoints[0][0].x=998;assert.equal(exportedState.sketches[0].start.x,1);
});

test('diagram isolation, hidden layouts, whole-document history, clear and monotone IDs include sketches',()=>{
  const store=createStore(), id=cup(store);store.configureLayout('face2');const first=store.getState().activeDiagramId;
  store.selectDiagram(store.getState().diagrams[1].id);assert.equal(store.getState().sketches.length,0);cup(store);
  store.configureLayout('single');assert.equal(sketch(store).id,id);
  assert.equal(serializeDocument(store.getState()).diagrams[1].sketches.length,1);
  store.clearAll();assert.equal(store.getState().sketches.length,0);store.undo();assert.equal(sketch(store).id,id);
  store.selectObject(id);store.removeSelected();assert.equal(cup(store),'sketch-3');
  assert.equal(store.getState().activeDiagramId,first);
});

test('creation mode is exclusive and returning to hand or selecting a shape cancels creation without history',()=>{
  const store=createStore();
  for(const mode of ['sketchSelected','mouseSelected','dashedSelected','duplicatePanel','handSelected','sketchSelected']) {
    store.update({[mode]:true});const state=store.getState();
    assert.equal(['sketchSelected','mouseSelected','dashedSelected','duplicatePanel','handSelected'].filter(key=>state[key]).length,1);
  }
  assert.equal(store.getState().canUndo,false);const id=cup(store);assert.equal(store.getState().handSelected,true);
  store.update({sketchSelected:true});store.selectObject(id);assert.equal(store.getState().sketchSelected,false);
});

test('visible sketch snapping and axis gaps use the same finite geometry, with no infinite extensions',()=>{
  const store=createStore();cup(store);const bounds={xMin:0,xMax:10,yMin:0,yMax:10};
  let state=store.getState(), targets=buildSnapTargets(state,bounds);
  const snapped=snapPoint({x:4.03,y:2.04},targets,56);assert.ok(snapped.ids.includes('sketch-1'));assert.ok(snapped.point.y>=2);
  assert.ok(!targets.shapes.filter(s=>s.id==='sketch-1').some(s=>s.a.x<1 || s.a.x>7));
  store.update({axisGapEnabled:true,axisGap:2});state=store.getState();
  for(const segment of displayedSketchSegments(sketch(store),bounds,state)) for(const p of segment) assert.ok(p.x>=2-1e-8 && p.y>=2-1e-8);
  const line={slope:null,anchor:{x:5,y:1}};assert.deepEqual(projectOnLine({x:9,y:6},line).point,{x:5,y:6});
  assert.deepEqual(directionOf(null),{x:0,y:1});
});

test('one drag transaction restores curve, tracked minimum and through-line together without reusing IDs',()=>{
  const store=createStore(), id=cup(store);store.markMinimum();store.lineThroughSelectedPoint();store.selectObject(id);
  const before=serializeDocument(store.getState());
  store.beginHistory();store.updateSelected({anchor:{x:5,y:1}});store.updateSelected({anchor:{x:6,y:0}});store.endHistory();
  const after=serializeDocument(store.getState());
  store.undo();assert.deepEqual(serializeDocument(store.getState()),before);
  store.redo();assert.deepEqual(serializeDocument(store.getState()),after);
  store.undo();assert.equal(cup(store),'sketch-2');assert.equal(store.getState().canRedo,false);
});

test('extreme finite input that would overflow controls is rejected and leaves valid geometry unchanged',()=>{
  const store=createStore();
  assert.equal(store.addSketch({x:-Number.MAX_VALUE,y:0},{x:Number.MAX_VALUE,y:0},{x:0,y:1}),null);
  assert.equal(cup(store),'sketch-1');const before=sketch(store);
  store.updateSelected({start:{x:-Number.MAX_VALUE,y:0},end:{x:Number.MAX_VALUE,y:0}});
  assert.deepEqual(sketch(store),before);
});

test('a tangent point stays on the same side as a line rotates across the vertical direction seam',()=>{
  const store=createStore(), line=addLine(store,1000);
  const anchor={x:4.001,y:3};
  store.addSketch({x:1,y:5},{x:8,y:5},anchor,{lineId:line});
  const original=sketch(store);
  store.selectObject(line);store.updateSelected({slope:null});
  near(sketch(store).anchor.y,3,0.00001);
  store.updateSelected({slope:-1000});
  const after=sketch(store);
  assert.ok(Math.hypot(after.anchor.x-original.anchor.x,after.anchor.y-original.anchor.y)<0.003);
  store.undo();near(sketch(store).anchor.y,3,0.00001);
  store.undo();assert.deepEqual(sketch(store),original);
});
