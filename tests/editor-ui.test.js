import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { editorContext } from '../src/editor-ui.js';
import { serializeDocument } from '../src/export.js';

test('only one drawing or operation mode remains active, including sum; navigation adds no history',()=>{
  const store=createStore(), modes=['handSelected','mouseSelected','dashedSelected','sketchSelected','duplicatePanel','sumPanel'];
  for(const key of [...modes,'mouseSelected','sumPanel','handSelected']) {
    store.update({[key]:true});const state=store.getState();
    assert.equal(modes.filter(mode=>state[mode]).length,1,key);assert.equal(state[key],true);
    assert.equal(state.canUndo,false);assert.equal(state.pointSnap,true);assert.equal(state.dashedSnap,true);
  }
});

test('inspector follows the current task and object, then returns from sum to the new result',()=>{
  const store=createStore();assert.equal(editorContext(store.getState()).kind,'empty');
  const line=store.addLine();assert.equal(editorContext(store.getState()).title,'직선 편집');
  store.update({mouseSelected:true});assert.equal(editorContext(store.getState()).title,'점 찍기');
  store.update({duplicatePanel:true});assert.equal(editorContext(store.getState()).title,'복제');
  store.update({sumPanel:true});assert.equal(editorContext(store.getState()).title,'수직합 · 수평합');
  store.selectObject(line);assert.equal(editorContext(store.getState()).kind,'selection');assert.equal(store.getState().sumPanel,false);
  const second=store.addLine();store.update({sumPanel:true});const result=store.addSum([line,second]);
  assert.equal(store.getState().sumPanel,false);assert.equal(editorContext(store.getState()).object.id,result);
  assert.equal(editorContext(store.getState()).kind,'selection');
});

test('changing diagrams exits an operation and preserves drawing preferences and document serialization',()=>{
  const store=createStore();store.configureLayout('face2');store.addLine();
  store.update({pointSnap:false,dashedSnap:false});const original=serializeDocument(store.getState());
  store.update({sumPanel:true});assert.deepEqual(serializeDocument(store.getState()),original);
  const second=store.getState().diagrams[1].id;store.selectDiagram(second);
  assert.equal(store.getState().sumPanel,false);assert.equal(store.getState().handSelected,true);
  store.update({duplicatePanel:true});store.selectDiagram(store.getState().diagrams[0].id);
  assert.equal(store.getState().duplicatePanel,false);assert.equal(store.getState().pointSnap,false);assert.equal(store.getState().dashedSnap,false);
});

test('explicit rising and falling curve commands create the requested shape in a single undo step',()=>{
  const store=createStore();
  const rising=store.addCurve({variant:'ascending'});assert.equal(store.getState().curves[0].variant,'ascending');
  store.undo();assert.equal(store.getState().curves.length,0);store.redo();assert.equal(store.getState().curves[0].id,rising);
  store.addCurve({variant:'descending'});assert.equal(store.getState().curves[1].variant,'descending');
  store.undo();assert.equal(store.getState().curves.length,1);assert.equal(store.getState().curves[0].variant,'ascending');
});
