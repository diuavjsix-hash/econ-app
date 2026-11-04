import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapFeedbackTargets } from '../src/graph/snap-feedback.js';
import { lineDisplayRegions } from '../src/graph/display.js';
import { buildFillRegions, findFillRegion } from '../src/graph/fill.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('Edgeworth totals define one coordinate box with equal scale in every viewport and orientation',()=>{
  for (const [width,height] of [[1000,600],[312,400],[260,260]]) for (const flipX of [false,true]) for (const flipY of [false,true]) {
    const v=createViewport(width,height,'edgeworth',{flipX,flipY,boxSize:{width:10,height:6}});
    assert.deepEqual(v.bounds,{xMin:0,xMax:10,yMin:0,yMax:6});
    close((v.plot.right-v.plot.left)/(v.plot.bottom-v.plot.top),10/6);
    for (const p of [{x:0,y:0},{x:10,y:6},{x:3,y:4}]) {const q=toWorld(toScreen(p,v),v);close(q.x,p.x);close(q.y,p.y);}
    const a=toScreen({x:0,y:0},v),b=toScreen({x:10,y:6},v);
    close(a.x,flipX?v.plot.right:v.plot.left);close(b.y,flipY?v.plot.bottom:v.plot.top);
  }
});

test('Edgeworth format, totals and B axis names are independent documents with undo and hidden-layout retention',()=>{
  const store=createStore(),before=serializeDocument(store.getState());
  store.configureLayout('horizontal2',null,'edgeworth',{boxSize:{width:12,height:6}});
  assert.ok(store.getState().diagrams.every(d=>d.quadrantMode==='edgeworth'&&d.boxSize.width===12));
  store.undo();assert.deepEqual(serializeDocument(store.getState()),before);store.redo();
  const [a,b]=store.getState().diagrams.map(d=>d.id);store.addPoint({x:3,y:2});
  store.update({boxSize:{width:15},boxAxisNames:{x:'재화 1 B'}});store.undo();assert.equal(store.getState().boxSize.width,12);store.redo();
  store.selectDiagram(b);assert.equal(store.getState().boxSize.width,12);assert.equal(store.getState().boxAxisNames.x,'xᴮ');
  store.configureLayout('single');store.configureLayout('horizontal2',null,'first',{allQuadrants:false});
  store.selectDiagram(b);assert.equal(store.getState().quadrantMode,'edgeworth');
  store.selectDiagram(a);assert.equal(store.getState().points[0].anchor.x,3);
  store.update({boxSize:{width:0,height:Infinity}});assert.equal(store.getState().boxSize.width,15);assert.equal(store.getState().boxSize.height,6);
});

test('Edgeworth four walls share point/dashed snap targets, common feedback and closed-region painting',()=>{
  const store=createStore();store.configureLayout('single',null,'edgeworth');
  let state=store.getState();const v=createViewport(700,600,'edgeworth',state),targets=buildSnapTargets(state,v.bounds);
  const ids=targets.shapes.map(s=>s.id);for (const id of ['axis-x','axis-y','axis-b-x','axis-b-y']) assert.ok(ids.includes(id));
  const top=snapPoint({x:5,y:7.95},targets,40);close(top.point.y,8);assert.ok(top.ids.includes('axis-b-x'));
  const right=snapPoint({x:9.95,y:4},targets,40);close(right.point.x,10);
  const highlight=snapFeedbackTargets(['axis-b-x','axis-b-y'],state,v);assert.equal(highlight.length,2);
  const whole=buildFillRegions(state,v.bounds);assert.equal(whole.length,1);assert.ok(findFillRegion(whole,{x:5,y:4}));
  store.addLine();store.updateSelected({slope:null,anchor:{x:4,y:0}});state=store.getState();
  const halves=buildFillRegions(state,v.bounds);assert.equal(halves.length,2);
  assert.notEqual(findFillRegion(halves,{x:2,y:4}),findFillRegion(halves,{x:6,y:4}));
  assert.deepEqual(lineDisplayRegions(v.bounds,{...state,axisGapEnabled:true,axisGap:0.75}),[{xMin:0.75,xMax:9.25,yMin:0.75,yMax:7.25}]);
});

test('Edgeworth JSON stores totals and the opposite origin without screen-dependent geometry',()=>{
  const store=createStore();store.configureLayout('single',null,'edgeworth',{boxSize:{width:12,height:7}});
  store.updateDiagram({flipX:true,flipY:true});store.addPoint({x:3,y:2});
  const doc=JSON.parse(JSON.stringify(serializeDocument(store.getState()))),coordinates=doc.coordinateSystem;
  assert.equal(coordinates.type,'edgeworth');assert.deepEqual(coordinates.totals,{width:12,height:7});
  assert.deepEqual(coordinates.oppositeOrigin,{x:12,y:7});assert.equal(coordinates.oppositeXPositive,'right');assert.equal(coordinates.oppositeYPositive,'up');
  assert.deepEqual(doc.diagrams[0].coordinateSystem,coordinates);assert.deepEqual(doc.points[0].anchor,{x:3,y:2});
  assert.equal(JSON.stringify(doc).includes('plot'),false);
});
