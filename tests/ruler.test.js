import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { rulerMetrics, constrainRuler, clipSegment, translateRuler } from '../src/graph/ruler.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';
import { serializeDocument } from '../src/export.js';
import { objectsOf } from '../src/objects.js';

test('ruler activation is disabled and point creation preference survives dashed-tool switches', () => {
  const store = createStore();
  assert.equal(store.getState().activeTool, 'point');
  store.update({ rulerSelected: true }); assert.equal(store.getState().rulerSelected, false);
  store.update({ mouseSelected: true }); store.update({ dashedSelected: true });
  assert.equal(store.getState().mouseSelected, false); assert.equal(store.getState().activeTool, 'point');
  store.update({ mouseSelected: true }); assert.equal(store.getState().dashedSelected, false);
  store.update({ activeTool: 'select' }); store.update({ dashedSelected: true }); store.update({ mouseSelected: true });
  assert.equal(store.getState().activeTool, 'select');
  const line=store.addLine(); store.update({dashedSelected:true}); store.selectObject(line);
  assert.equal(store.getState().dashedSelected,false);
});

test('ruler metrics use mathematical units and direction constraints preserve the starting point', () => {
  const anchor = {x:1,y:2}, end={x:4,y:6};
  assert.deepEqual(rulerMetrics({anchor,end}),{dx:3,dy:4,length:5});
  assert.deepEqual(constrainRuler(anchor,end,'horizontal'),{x:4,y:2});
  assert.deepEqual(constrainRuler(anchor,end,'vertical'),{x:1,y:6});
  assert.deepEqual(constrainRuler(anchor,end,'free',true),{x:1,y:6});
  assert.deepEqual(constrainRuler(anchor,{x:7,y:3},'free',true),{x:7,y:2});
  assert.deepEqual(anchor,{x:1,y:2});
});

test('finite segments clip exactly and vertical measurements remain finite', () => {
  const bounds={xMin:0,xMax:5,yMin:0,yMax:5};
  assert.deepEqual(clipSegment({x:-2,y:2},{x:3,y:2},bounds),[{x:0,y:2},{x:3,y:2}]);
  assert.equal(clipSegment({x:6,y:0},{x:6,y:4},bounds),null);
  assert.deepEqual(clipSegment({x:2,y:-3},{x:2,y:7},bounds),[{x:2,y:0},{x:2,y:5}]);
  assert.equal(rulerMetrics({anchor:{x:2,y:1},end:{x:2,y:5}}).length,4);
});

test('adding and editing rulers validates endpoints, preserves precision and rejects zero length', () => {
  const store=createStore();
  assert.equal(store.addRuler({x:0,y:0},{x:0,y:0}),null);
  assert.equal(store.addRuler({x:NaN,y:0},{x:1,y:2}),null);
  const id=store.addRuler({x:1.23456,y:2},{x:4,y:6});
  store.updateSelected({style:'dashed',showMeasurement:false,name:'차이'});
  store.updateSelected({anchor:{x:4,y:6}});
  assert.equal(store.getState().rulers[0].anchor.x,1.23456);
  store.updateSelected({end:{x:4,y:8}});
  const ruler=store.getState().rulers[0];
  assert.equal(ruler.id,id); assert.equal(ruler.end.y,8); assert.equal(ruler.style,'dashed');
  assert.equal(ruler.showMeasurement,false); assert.equal(ruler.name,'차이');
  ruler.end.y=900; assert.equal(store.getState().rulers[0].end.y,8);
});

test('moving a ruler preserves its length and limits the complete segment to the domain', () => {
  const ruler={anchor:{x:1,y:1},end:{x:4,y:5}};
  const moved=translateRuler(ruler,{x:10,y:-10},{xMin:0,xMax:8,yMin:0,yMax:8});
  assert.deepEqual(moved,{anchor:{x:5,y:0},end:{x:8,y:4}});
  assert.equal(rulerMetrics(moved).length,5);
});

test('rulers participate in hierarchy, independent diagrams, deletion and whole-document history', () => {
  const store=createStore(); store.configureLayout('face2');
  const id=store.addRuler({x:1,y:2},{x:4,y:6}), group=store.addGroup();
  store.moveObject(id,group); store.selectObject(id);
  const original=serializeDocument(store.getState());
  store.beginHistory(); store.updateSelected({end:{x:5,y:7}}); store.updateSelected({end:{x:7,y:9}}); store.endHistory();
  store.undo(); assert.deepEqual(serializeDocument(store.getState()),original);
  const second=store.getState().diagrams[1].id; store.selectDiagram(second);
  assert.equal(store.getState().rulers.length,0);
  store.selectDiagram('diagram-1'); store.selectObject(id); store.removeSelected();
  assert.equal(store.getState().rulers.length,0); store.undo();
  assert.equal(objectsOf(store.getState()).find(o=>o.id===id).parentId,group);
  store.clearAll(); assert.equal(store.getState().rulers.length,0); store.undo();
  assert.equal(store.getState().rulers.length,1);
  store.undo(); store.redo(); const fresh=store.addRuler({x:2,y:2},{x:3,y:4}); assert.notEqual(fresh,id);
});

test('JSON exports both endpoints and styles per diagram, without point guides or UI tool state', () => {
  const store=createStore(); store.addPoint({x:1,y:2});
  const id=store.addRuler({x:1,y:2},{x:4,y:6});
  const document=JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(document.schemaVersion,6); assert.equal(document.rulers[0].id,id);
  assert.deepEqual(document.rulers[0].end,{x:4,y:6});
  assert.equal(document.rulers[0].showMeasurement,true); assert.equal('guides' in document.points[0],false);
  assert.deepEqual(document.rulers,document.diagrams[0].rulers);
  assert.equal('rulerSelected' in document,false);
});

test('reflected diagrams and resize preserve measurement units and exact endpoint coordinates', () => {
  const ruler={anchor:{x:1,y:2},end:{x:4,y:6}};
  for (const width of [280,800]) for (const flipX of [false,true]) for (const flipY of [false,true]) {
    const viewport=createViewport(width,400,'first',{flipX,flipY});
    const recovered={anchor:toWorld(toScreen(ruler.anchor,viewport),viewport),end:toWorld(toScreen(ruler.end,viewport),viewport)};
    assert.ok(Math.abs(rulerMetrics(recovered).length-5)<1e-9);
  }
});
