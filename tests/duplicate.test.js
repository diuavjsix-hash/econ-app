import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { prepareDuplicate } from '../src/duplicate.js';
import { interceptOf } from '../src/graph/math.js';
import { objectsOf } from '../src/objects.js';
import { serializeDocument } from '../src/export.js';

test('hand, point, dashed and duplicate tabs are exclusive and preserve drawing preferences without history', () => {
  const store=createStore();
  assert.equal(store.getState().handSelected,true);
  for (const key of ['mouseSelected','dashedSelected','duplicatePanel','handSelected']) {
    store.update({[key]:true});
    const state=store.getState();
    assert.equal(['handSelected','mouseSelected','dashedSelected','duplicatePanel'].filter(key=>state[key]).length,1);
    assert.equal(state[key],true); assert.equal(state.activeTool,'point'); assert.equal(state.pointSnap,true); assert.equal(state.dashedSnap,true);
  }
  assert.equal(store.getState().canUndo,false);
  store.update({duplicatePanel:true}); store.update({duplicatePanel:false}); assert.equal(store.getState().handSelected,true);
});

test('slope factors preserve sign and vertical intercept, or rotate about the original anchor', () => {
  for (const slope of [-3,-1,0,0.4,2]) for (const factor of [0.5,1,2]) {
    const line={id:'a',type:'line',name:'D',slope,anchor:{x:4,y:7}};
    const copy=prepareDuplicate(line,{slopeFactor:factor}).object;
    assert.equal(copy.slope,slope*factor);
    assert.ok(Math.abs(interceptOf(copy)-interceptOf(line))<1e-10);
    const rotated=prepareDuplicate(line,{slopeFactor:factor,pivot:'anchor'}).object;
    assert.deepEqual(rotated.anchor,line.anchor);
    assert.equal(line.slope,slope); assert.deepEqual(line.anchor,{x:4,y:7});
  }
  const vertical={type:'line',name:'LRAS',slope:null,anchor:{x:4,y:2}};
  assert.deepEqual(prepareDuplicate(vertical,{slopeFactor:2}).object.anchor,vertical.anchor);
  assert.equal(prepareDuplicate(vertical,{slopeFactor:0.5}).object.slope,null);
});

test('invalid or overflowing copies leave the complete document and ID sequence unchanged', () => {
  const store=createStore(); store.addLine(); store.updateSelected({slope:Number.MAX_VALUE});
  const before=serializeDocument(store.getState());
  for (const options of [{slopeFactor:2},{slopeFactor:3},{placement:'unknown'},{pivot:'unknown'}]) {
    assert.equal(store.duplicateSelected(options),null); assert.deepEqual(serializeDocument(store.getState()),before);
  }
  assert.equal(store.addLine(),'line-2');
  assert.ok(prepareDuplicate({type:'line',slope:Number.MIN_VALUE,anchor:{x:0,y:1}},{slopeFactor:0.5}).error);
});

test('curve, point and dashed copies preserve their geometry and settings with detached coordinates', () => {
  const store=createStore(); const curve=store.addCurve(); store.updateSelected({name:'AC',bend:0.12});
  const point=store.addPoint({x:1.234567,y:4}); store.updateSelected({showCoordinates:true});
  const dashed=store.addDashedLine({x:1,y:4},{x:5,y:4});
  for (const id of [curve,point,dashed]) {
    store.selectObject(id); const source=objectsOf(store.getState()).find(o=>o.id===id);
    const copyId=store.duplicateSelected({slopeFactor:2,placement:'right'});
    const copy=objectsOf(store.getState()).find(o=>o.id===copyId);
    assert.equal(copy.name,`${source.name}′`); assert.equal(copy.anchor.x,source.anchor.x+1); assert.equal(copy.anchor.y,source.anchor.y);
    if (source.end) assert.deepEqual(copy.end,{x:source.end.x+1,y:source.end.y});
    if (source.type==='curve') { assert.equal(copy.slope,source.slope); assert.equal(copy.bend,0.12); }
    if (source.type==='point') assert.equal(copy.showCoordinates,true);
    store.updateSelected({anchor:{x:9,y:9}});
    assert.deepEqual(objectsOf(store.getState()).find(o=>o.id===id),source);
  }
});

test('folder copies remap nested parents even when children precede their parents in creation order', () => {
  const store=createStore(); const line=store.addLine(), point=store.addPoint({x:2,y:3}), folder=store.addGroup();
  store.moveObject(point,line); store.moveObject(line,folder); store.selectObject(folder);
  const copyFolder=store.duplicateSelected({placement:'up'});
  const state=store.getState(), copied=objectsOf(state).filter(o=>o.name.endsWith('′'));
  assert.equal(copied.length,3); assert.equal(new Set(state.objectOrder).size,state.objectOrder.length);
  const copiedLine=copied.find(o=>o.type==='line'), copiedPoint=copied.find(o=>o.type==='point');
  assert.equal(copiedLine.parentId,copyFolder); assert.equal(copiedPoint.parentId,copiedLine.id);
  assert.equal(copiedPoint.anchor.y,4); assert.equal(state.points.find(o=>o.id===point).anchor.y,3);
  assert.equal(state.lines.find(o=>o.id===line).parentId,folder);
});

test('the child-copy option can copy a single parent without copying or moving its children', () => {
  const store=createStore(); const line=store.addLine(); store.updateSelected({slope:-1});
  const child=store.addCurve(); store.moveObject(child,line); store.selectObject(line);
  const copy=store.duplicateSelected({slopeFactor:2,includeChildren:false});
  assert.equal(store.getState().curves.length,1); assert.equal(store.getState().curves[0].parentId,line);
  assert.equal(store.getState().lines.find(o=>o.id===copy).slope,-2);
  assert.equal(store.getState().curves[0].slope,-0.75);
});

test('an entire copied hierarchy is one undo step, redo restores it and branching never reuses IDs', () => {
  const store=createStore(); const folder=store.addGroup(), line=store.addLine(); store.moveObject(line,folder); store.selectObject(folder);
  const original=serializeDocument(store.getState()); const copied=store.duplicateSelected(); const after=serializeDocument(store.getState());
  store.undo(); assert.deepEqual(serializeDocument(store.getState()),original);
  store.redo(); assert.deepEqual(serializeDocument(store.getState()),after); assert.equal(store.getState().selectedId,copied);
  store.undo(); const fresh=store.duplicateSelected(); assert.notEqual(fresh,copied); assert.equal(store.getState().canRedo,false);
});

test('copies stay within their active diagram and serialize as normal editable objects', () => {
  const store=createStore(); store.configureLayout('face2'); store.addLine(); store.updateSelected({slope:-1,name:'D',anchor:{x:4,y:6}});
  store.update({duplicatePanel:true}); const copy=store.duplicateSelected({slopeFactor:2});
  const doc=serializeDocument(store.getState());
  assert.equal(doc.lines.length,2); assert.equal(doc.diagrams[1].lines.length,0);
  assert.equal(doc.lines.find(o=>o.id===copy).intercept,10); assert.equal(doc.lines.find(o=>o.id===copy).slope,-2);
  assert.equal(doc.coordinateSystem.xPositive,'left'); assert.equal('duplicatePanel' in doc,false);
  store.selectObject('line-1'); store.duplicateSelected({slopeFactor:2});
  assert.equal(new Set(store.getState().lines.map(line=>line.name)).size,3);
  store.selectDiagram(store.getState().diagrams[1].id); assert.equal(store.duplicateSelected(),null);
});

test('copy names remain bounded and ruler data is excluded while other parent links are retained', () => {
  const store=createStore(); const group=store.addGroup(), line=store.addLine(); store.moveObject(line,group); store.updateSelected({name:'수'.repeat(80)});
  const copy=store.duplicateSelected(); const object=store.getState().lines.find(o=>o.id===copy);
  assert.equal(object.name.length,80); assert.equal(object.name.at(-1),'′'); assert.equal(object.parentId,group);
  store.addRuler({x:1,y:2},{x:3,y:4}); assert.equal(store.duplicateSelected(),null);
});
