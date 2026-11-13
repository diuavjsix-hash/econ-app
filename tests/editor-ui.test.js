import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { editorContext } from '../src/editor-ui.js';
import { serializeActive } from './fixtures/document.js';

test('only one drawing or operation mode remains active, including sum; navigation adds no history',()=>{
  const store=createStore(), modes=['handSelected','mouseSelected','lineSelected','sketchSelected','duplicatePanel','sumPanel'];
  for(const key of [...modes,'mouseSelected','sumPanel','handSelected']) {
    store.update({[key]:true});const state=store.getState();
    assert.equal(modes.filter(mode=>state[mode]).length,1,key);assert.equal(state[key],true);
    assert.equal(state.canUndo,false);assert.equal(state.pointSnap,true);assert.equal(state.segmentSnap,true);
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

test('operation panels and drawing preferences stay out of document serialization',()=>{
  const store=createStore();store.updateDiagram({ flipX: true });store.addLine();
  store.update({pointSnap:false,segmentSnap:false});const original=serializeActive(store.getState());
  store.update({sumPanel:true});assert.deepEqual(serializeActive(store.getState()),original);
  store.update({duplicatePanel:true});assert.deepEqual(serializeActive(store.getState()),original);
  assert.equal(store.getState().pointSnap,false);assert.equal(store.getState().segmentSnap,false);
});

test('explicit rising and falling curve commands create the requested shape in a single undo step',()=>{
  const store=createStore();
  const rising=store.addCurve({variant:'ascending'});assert.equal(store.getState().curves[0].variant,'ascending');
  store.undo();assert.equal(store.getState().curves.length,0);store.redo();assert.equal(store.getState().curves[0].id,rising);
  store.addCurve({variant:'descending'});assert.equal(store.getState().curves[1].variant,'descending');
  store.undo();assert.equal(store.getState().curves.length,1);assert.equal(store.getState().curves[0].variant,'ascending');
});
