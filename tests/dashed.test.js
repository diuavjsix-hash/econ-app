import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { objectsOf } from '../src/objects.js';

test('dashed snapping starts on, is independent of point snapping and preserves user choices', () => {
  const store=createStore();
  store.update({pointSnap:false,dashedSelected:true});
  assert.equal(store.getState().dashedSnap,true);
  assert.equal(store.getState().pointSnap,false);
  store.update({dashedSnap:false}); store.update({mouseSelected:true}); store.update({dashedSelected:true});
  assert.equal(store.getState().dashedSnap,false);
  assert.equal(store.getState().rulerSelected,false);
  assert.equal(store.getState().canUndo,false);
});

test('dashed strokes store two exact endpoints with no ruler styling or measurement fields', () => {
  const store=createStore();
  assert.equal(store.addDashedLine({x:1,y:2},{x:1,y:2}),null);
  assert.equal(store.addDashedLine({x:Infinity,y:2},{x:1,y:2}),null);
  const id=store.addDashedLine({x:1.234567,y:2},{x:4,y:6});
  store.updateSelected({name:'投影',style:'solid',showMeasurement:true});
  const line=store.getState().dashedLines[0];
  assert.equal(line.type,'dashed'); assert.equal(line.id,id);
  assert.equal(line.anchor.x,1.234567); assert.equal('style' in line,false); assert.equal('showMeasurement' in line,false);
  const doc=JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(doc.schemaVersion,8); assert.deepEqual(doc.dashedLines,doc.diagrams[0].dashedLines);
  assert.equal(doc.rulers.length,0); assert.equal(doc.dashedLines[0].name,'投影');
  doc.dashedLines[0].anchor.x=100; assert.equal(store.getState().dashedLines[0].anchor.x,1.234567);
});

test('endpoint edits, hierarchy and deletion restore without changing other shapes', () => {
  const store=createStore(); const point=store.addPoint({x:2,y:3});
  const id=store.addDashedLine({x:2,y:3},{x:6,y:3}); store.moveObject(id,point);
  const original=serializeDocument(store.getState());
  store.beginHistory(); store.updateSelected({end:{x:8,y:4}}); store.updateSelected({end:{x:9,y:5}}); store.endHistory();
  store.undo(); assert.deepEqual(serializeDocument(store.getState()),original);
  store.updateSelected({anchor:{x:6,y:3}}); assert.deepEqual(store.getState().dashedLines[0].anchor,{x:2,y:3});
  store.removeSelected(); assert.equal(store.getState().dashedLines.length,0);
  store.undo(); assert.equal(objectsOf(store.getState()).find(o=>o.id===id).parentId,point);
  assert.deepEqual(store.getState().points[0].anchor,{x:2,y:3});
});

test('dashed strokes are isolated by diagram and survive layout changes, clear, undo and ID branching', () => {
  const store=createStore(); store.configureLayout('horizontal2');
  const second=store.getState().diagrams[1].id;
  store.selectDiagram(second); const id=store.addDashedLine({x:1,y:2},{x:4,y:6});
  store.configureLayout('single'); assert.equal(store.getState().dashedLines.length,0);
  assert.equal(serializeDocument(store.getState()).diagrams[1].dashedLines.length,1);
  store.configureLayout('face2'); store.selectDiagram(second);
  assert.equal(store.getState().dashedLines[0].id,id);
  store.clearAll(); store.undo(); assert.equal(store.getState().dashedLines[0].id,id);
  store.undo(); const fresh=store.addDashedLine({x:0,y:0},{x:1,y:1}); assert.notEqual(fresh,id);
});

test('dashed snap targets remain finite and exclude the stroke being edited', () => {
  const store=createStore(); const id=store.addDashedLine({x:2,y:4},{x:6,y:4});
  const bounds={xMin:0,xMax:10,yMin:0,yMax:10};
  const target=buildSnapTargets(store.getState(),bounds);
  assert.equal(snapPoint({x:3,y:4.1},target,56).kind,'shape');
  assert.equal(snapPoint({x:8,y:4.1},target,56),null);
  assert.equal(snapPoint({x:3,y:4.1},buildSnapTargets(store.getState(),bounds,id),56),null);
  store.addRuler({x:2,y:6},{x:6,y:6});
  assert.equal(snapPoint({x:3,y:6.1},buildSnapTargets(store.getState(),bounds),56),null,'disabled ruler data does not affect snapping');
});
