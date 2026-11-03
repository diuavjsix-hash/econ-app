import test from 'node:test';
import assert from 'node:assert/strict';
import { dragTranslation, axisAlignedSnap } from '../src/graph/movement.js';
import { createStore } from '../src/state.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';

test('Shift drag uses the larger displacement and keeps the other original coordinate exact',()=>{
  const origin={x:3,y:4},start={x:2.875,y:4.125};
  assert.deepEqual(dragTranslation(origin,start,{x:5.875,y:5.125},true),{anchor:{x:6,y:4},axis:'x'});
  assert.deepEqual(dragTranslation(origin,start,{x:3.875,y:1.125},true),{anchor:{x:3,y:1},axis:'y'});
  assert.deepEqual(dragTranslation(origin,start,{x:5.875,y:5.125},false),{anchor:{x:6,y:5},axis:null});
});

test('axis locking survives viewport bounds, hidden origins and switching Shift on and off',()=>{
  const bounds={xMin:0,xMax:10,yMin:0,yMax:10},origin={x:3,y:-2},start={x:3,y:4};
  assert.deepEqual(dragTranslation(origin,start,{x:30,y:5},true,bounds,0.5),{anchor:{x:9.5,y:-2},axis:'x'});
  assert.deepEqual(dragTranslation(origin,start,{x:4,y:5},false).anchor,{x:4,y:-1});
  assert.deepEqual(dragTranslation(origin,start,{x:4,y:9},true).anchor,{x:3,y:3});
  assert.deepEqual(dragTranslation(origin,start,{x:4,y:9},false).anchor,{x:4,y:3});
});

test('point magnets cannot pull a Shift movement off its locked axis',()=>{
  const anchor={x:4,y:3};
  assert.equal(axisAlignedSnap(anchor,{x:4.1,y:3.05},'x'),null);
  assert.deepEqual(axisAlignedSnap(anchor,{x:4.1,y:3+1e-12},'x'),{x:4.1,y:3});
  assert.deepEqual(axisAlignedSnap(anchor,{x:4,y:3.2},'y'),{x:4,y:3.2});
  assert.deepEqual(axisAlignedSnap(anchor,{x:8,y:7},null),{x:8,y:7});
});

test('axis-flipped dragging stores mathematical coordinates and a constrained gesture undoes together',()=>{
  for (const flipX of [false,true]) for (const flipY of [false,true]) {
    const viewport=createViewport(800,600,'all',{flipX,flipY}),start={x:2,y:3},screen=toScreen(start,viewport);
    const end=toWorld({x:screen.x+100,y:screen.y+20},viewport),moved=dragTranslation(start,start,end,true);
    assert.equal(moved.axis,'x');assert.equal(moved.anchor.y,3);assert.equal(Math.sign(moved.anchor.x-2),flipX?-1:1);
  }
  const store=createStore(),id=store.addLine();const original=store.getState().lines[0].anchor;
  store.beginHistory();
  for (const x of [4,5,6]) store.updateSelected({anchor:dragTranslation(original,original,{x,y:original.y+0.2},true).anchor});
  store.endHistory();store.undo();assert.deepEqual(store.getState().lines.find(o=>o.id===id).anchor,original);
});
