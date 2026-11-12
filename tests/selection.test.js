import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';
import { objectsOf, selectedIdsOf } from '../src/objects.js';
import { objectsInRectangle, selectionRectangle } from '../src/graph/selection.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';
import { diagramState } from '../src/workspace.js';
import { editorContext } from '../src/editor-ui.js';
import { canDeleteSelection } from '../src/tools/selection.js';
import { drawSegment, segmentEnds } from './fixtures/segments.js';

const bounds={xMin:0,xMax:12,yMin:0,yMax:12};
const region={xMin:4,xMax:6,yMin:4,yMax:6};

test('rectangle selection touches visible strokes with anchors outside and excludes distant finite strokes and folders',()=>{
  const store=createStore(),line=store.addLine();store.updateSelected({slope:-1,anchor:{x:0,y:10}});
  const vertical=store.addLine();store.updateSelected({slope:null,anchor:{x:5,y:100}});
  const point=store.addPoint({x:5,y:5}),dashed=drawSegment(store,{x:3,y:5},{x:7,y:5});
  drawSegment(store,{x:0,y:5},{x:2,y:5});store.addPoint({x:9,y:9});store.addGroup();store.addRuler({x:4,y:5},{x:6,y:5});
  assert.deepEqual(objectsInRectangle(store.getState(),region),[line,vertical,point,dashed]);
  assert.deepEqual(objectsInRectangle(store.getState(),{...region,xMax:4}),[]);
});

test('rectangle selection includes exact basic curves, finite sketches, sums and every indifference family',()=>{
  const store=createStore();
  const basic=store.addCurve({anchor:{x:5,y:5},variant:'descending',span:2});
  const sketch=store.addSketch({x:1,y:8},{x:9,y:2},{x:5,y:5});
  const line=store.addLine();store.updateSelected({slope:0,anchor:{x:0,y:0}});
  const sum=store.addSum([basic,line],{direction:'vertical',nonnegative:false});
  const families=['cobb-douglas','substitutes','complements','quasilinear'].map(f=>store.addIndifference(f,{anchor:{x:5,y:5}}));
  const hits=objectsInRectangle(store.getState(),region);
  for (const id of [basic,sketch,sum,...families]) assert.ok(hits.includes(id),id);
  assert.ok(!hits.includes(line));
});

test('axis-gap-hidden strokes and segments do not select but visible points inside the gap do',()=>{
  const store=createStore();store.update({axisGapEnabled:true,axisGap:1});
  store.addLine();store.updateSelected({slope:1,anchor:{x:0,y:0}});
  store.addCurve({anchor:{x:0.4,y:0.4},span:2});
  // A segment is a line: like every line it is hidden inside the axis-gap band.
  const point=store.addPoint({x:0.4,y:0.4});drawSegment(store,{x:0.2,y:0.3},{x:0.6,y:0.3});
  assert.deepEqual(objectsInRectangle(store.getState(),{xMin:0.1,xMax:0.7,yMin:0.1,yMax:0.7}),[point]);
});

test('selection rectangles normalize both drag directions, clamp to the graph and work under reflected axes',()=>{
  assert.deepEqual(selectionRectangle({x:6,y:4},{x:4,y:6},bounds),region);
  assert.deepEqual(selectionRectangle({x:-20,y:18},{x:20,y:-18},bounds),bounds);
  const store=createStore(),id=store.addPoint({x:5,y:5});
  for (const flipX of [false,true]) for (const flipY of [false,true]) {
    const view=createViewport(800,600,'first',{flipX,flipY});
    const a=toWorld(toScreen({x:4,y:6},view),view),b=toWorld(toScreen({x:6,y:4},view),view);
    assert.deepEqual(objectsInRectangle(store.getState(),selectionRectangle(a,b,view.bounds)),[id]);
  }
});

test('multiple selection and control toggling are UI only and keep a single primary only for one object',()=>{
  const store=createStore(),a=store.addLine(),b=store.addPoint({x:2,y:3});
  const doc=serializeActive(store.getState());store.selectObjects([b,a,a,'missing']);
  assert.deepEqual(store.getState().selectedIds,[a,b]);assert.equal(store.getState().selectedId,null);
  assert.equal(editorContext(store.getState()).kind,'multiple');
  store.updateSelected({name:'must not edit a random object'});assert.deepEqual(serializeActive(store.getState()),doc);
  store.selectObject(a,{toggle:true});assert.deepEqual(store.getState().selectedIds,[b]);assert.equal(store.getState().selectedId,b);
  store.selectObject(b,{toggle:true});assert.deepEqual(store.getState().selectedIds,[]);assert.equal(store.getState().selectedId,null);
  store.selectObjects([a,b]);assert.deepEqual(serializeActive(store.getState()),doc);
  const detached=store.getState();detached.selectedIds.length=0;assert.equal(store.getState().selectedIds.length,2);
});

test('a multi-delete is one undo/redo and restores all original geometry, selection, dependent sums and surviving relations',()=>{
  const store=createStore(),a=store.addLine(),b=store.addCurve(),sum=store.addSum([a,b]);
  const sketch=store.addSketch({x:0,y:8},{x:8,y:0},{x:3,y:3},{lineId:a});
  store.markMinimum();
  const point=store.addPoint({x:9,y:9});
  store.selectObjects([a,b,point]);const before=serializeActive(store.getState()),curveBefore=store.getState().sketches[0];
  assert.equal(store.removeSelected(),true);
  assert.ok(!objectsOf(store.getState()).some(o=>[a,b,sum,point].includes(o.id)));
  assert.deepEqual(store.getState().selectedIds,[]);assert.equal(store.getState().sketches[0].binding,null);
  assert.deepEqual(store.getState().sketches[0].anchor,curveBefore.anchor);
  assert.equal(store.getState().points.length,0);assert.equal(store.getState().sketches.find(c=>c.id===sketch).showMinimum,true);
  store.undo();assert.deepEqual(serializeActive(store.getState()),before);assert.deepEqual(store.getState().selectedIds,[a,b,point]);
  store.redo();assert.deepEqual(store.getState().selectedIds,[]);assert.equal(store.removeSelected(),false);
});

test('deleting selected ancestors and descendants lifts only surviving children to the nearest surviving parent',()=>{
  const store=createStore(),root=store.addGroup(),parent=store.addGroup(),child=store.addGroup(),point=store.addPoint({x:2,y:3});
  store.moveObject(parent,root);store.moveObject(child,parent);store.moveObject(point,child);
  store.selectObjects([parent,child]);store.removeSelected();
  assert.equal(store.getState().points[0].parentId,root);assert.equal(store.getState().groups.length,1);
  store.undo();assert.equal(store.getState().points[0].parentId,child);assert.deepEqual(store.getState().selectedIds,[parent,child]);
});

test('selection is graph-local, clears on layout and creation changes, and does not invalidate redo',()=>{
  const store=createStore();store.configureLayout('horizontal2');const first=store.getState().activeDiagramId;
  const a=store.addLine(),b=store.addLine(),second=store.getState().diagrams[1].id;
  store.selectObjects([a,b]);assert.deepEqual(diagramState(store.getState(),second).selectedIds,[]);
  store.selectDiagram(second);assert.deepEqual(store.getState().selectedIds,[]);store.selectObjects([a,b]);assert.deepEqual(store.getState().selectedIds,[]);
  store.selectDiagram(first);store.selectObjects([a,b]);store.update({sketchSelected:true});assert.deepEqual(store.getState().selectedIds,[]);
  store.update({handSelected:true});store.selectObjects([a,b]);store.removeSelected();store.undo();assert.equal(store.getState().canRedo,true);
  store.selectObject(null);store.selectObjects([a,b]);assert.equal(store.getState().canRedo,true);
  store.configureLayout('single');assert.deepEqual(store.getState().selectedIds,[]);
});

test('selection itself adds no history or JSON fields and undo still removes the last document edit',()=>{
  const store=createStore(),a=store.addLine(),b=store.addLine();
  store.selectObjects([a,b]);store.selectObject(a,{toggle:true});store.selectObjects([a,b]);
  assert.ok(!JSON.stringify(serializeActive(store.getState())).includes('selectedIds'));
  store.undo();assert.deepEqual(store.getState().objectOrder,[a]);assert.deepEqual(selectedIdsOf(store.getState()),[a]);
  store.redo();assert.deepEqual(store.getState().objectOrder,[a,b]);
});

test('Delete and Backspace target selected shapes only and leave text editing, dialogs, composition and other tools alone',()=>{
  const store=createStore();store.addLine();const state=store.getState();
  const event={key:'Delete',target:{closest:()=>null}};
  assert.equal(canDeleteSelection(event,state),true);assert.equal(canDeleteSelection({...event,key:'Backspace'},state),true);
  assert.equal(canDeleteSelection({...event,target:{closest:()=>({})}},state),false);
  for (const key of ['ctrlKey','metaKey','altKey','isComposing','repeat','defaultPrevented']) assert.equal(canDeleteSelection({...event,[key]:true},state),false);
  assert.equal(canDeleteSelection(event,state,true),false);
  assert.equal(canDeleteSelection(event,{...state,handSelected:false}),false);
  assert.equal(canDeleteSelection(event,{...state,selectedIds:[],selectedId:null}),false);
});
