import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { snapFeedbackTargets } from '../src/graph/snap-feedback.js';
import { lineDisplayRegions } from '../src/graph/display.js';
import { buildFillRegions, findFillRegion } from '../src/graph/fill.js';
import { displayedLineSegments } from '../src/graph/display.js';
import { interactionFor } from '../src/graph/interactions.js';
import { snapLineToIntercept } from '../src/graph/intercepts.js';

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

test('Edgeworth format, totals and B axis names belong to the document with undo',()=>{
  const store=createStore(),before=serializeActive(store.getState());
  assert.equal(store.configureWorkspace('unknown'),false);
  store.configureWorkspace('edgeworth',{boxSize:{width:12,height:6}});
  assert.ok(store.getState().diagrams.every(d=>d.quadrantMode==='edgeworth'&&d.boxSize.width===12));
  store.undo();assert.deepEqual(serializeActive(store.getState()),before);store.redo();
  store.addPoint({x:3,y:2});
  store.update({boxSize:{width:15},boxAxisNames:{x:'재화 1 B'}});store.undo();assert.equal(store.getState().boxSize.width,12);assert.equal(store.getState().boxAxisNames.x,'xᴮ');store.redo();
  store.configureWorkspace('first');assert.equal(store.getState().quadrantMode,'first');assert.equal(store.getState().points[0].anchor.x,3);
  store.undo();assert.equal(store.getState().quadrantMode,'edgeworth');
  store.update({boxSize:{width:0,height:Infinity}});assert.equal(store.getState().boxSize.width,15);assert.equal(store.getState().boxSize.height,6);
});

test('Edgeworth four walls share point/dashed snap targets, common feedback and closed-region painting',()=>{
  const store=createStore();store.configureWorkspace('edgeworth');
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
  const store=createStore();store.configureWorkspace('edgeworth',{boxSize:{width:12,height:7}});
  store.updateDiagram({flipX:true,flipY:true});store.addPoint({x:3,y:2});
  const doc=JSON.parse(JSON.stringify(serializeActive(store.getState()))),coordinates=doc.coordinateSystem;
  assert.equal(coordinates.type,'edgeworth');assert.deepEqual(coordinates.totals,{width:12,height:7});
  assert.deepEqual(coordinates.oppositeOrigin,{x:12,y:7});assert.equal(coordinates.oppositeXPositive,'right');assert.equal(coordinates.oppositeYPositive,'up');
  assert.deepEqual(doc.diagrams[0].coordinateSystem,coordinates);assert.deepEqual(doc.points[0].anchor,{x:3,y:2});
  assert.equal(JSON.stringify(doc).includes('plot'),false);
});

test('new Edgeworth lines use box-relative placement and the first line connects both origins at every aspect ratio',()=>{
  for (const boxSize of [{width:10,height:8},{width:12,height:7},{width:1,height:100},{width:100,height:1}]) {
    const store=createStore();store.configureWorkspace('edgeworth',{boxSize});store.addLine();
    const state=store.getState(),line=state.lines[0],v=createViewport(312,400,'edgeworth',state);
    assert.deepEqual(line.anchor,{x:boxSize.width/2,y:boxSize.height/2});close(line.slope,boxSize.height/boxSize.width);
    const segment=displayedLineSegments(line,v.bounds,state)[0];
    close(segment[0].x,0);close(segment[0].y,0);close(segment[1].x,boxSize.width);close(segment[1].y,boxSize.height);
    for(let i=0;i<5;i++){store.addLine();assert.equal(displayedLineSegments(store.getState().lines.at(-1),v.bounds,store.getState()).length,1);}
  }
});

test('A and B origins share exact point/dashed and line-translation targets without axis or slope changes',()=>{
  const store=createStore();store.configureWorkspace('edgeworth',{boxSize:{width:10,height:8}});store.addLine();
  const state=store.getState(),v=createViewport(800,600,'edgeworth',state),targets=buildSnapTargets({...state,lines:[]},v.bounds);
  for (const point of [{x:0,y:0},{x:10,y:8}]) {
    const snapped=snapPoint({x:point.x+(point.x?-.1:.1),y:point.y+(point.y?-.1:.1)},targets,v.unit);
    assert.equal(snapped.kind,'intercept');assert.deepEqual(snapped.point,point);
    const raw={...state.lines[0],slope:-0.7,anchor:{x:point.x+0.05,y:point.y+0.05}};
    for(const axis of [null,'x','y']) {
      const result=snapLineToIntercept(raw,state,v.bounds,v.unit,{axis});
      assert.ok(result);assert.deepEqual(result.point,point);
      close(result.anchor.y+raw.slope*(point.x-result.anchor.x),point.y);
      if(axis)close(result.anchor[axis==='x'?'y':'x'],raw.anchor[axis==='x'?'y':'x']);
    }
    assert.equal(snapLineToIntercept(raw,state,v.bounds,v.unit,{altKey:true}),null);
  }
});

test('rotating a line snaps to either box origin before the near-vertical heuristic and supports Alt bypass',()=>{
  for (const boxSize of [{width:10,height:8},{width:1,height:100},{width:100,height:1}]) {
    const store=createStore();store.configureWorkspace('edgeworth',{boxSize});store.addLine();store.updateSelected({slope:0});
    const state=store.getState(),line=state.lines[0],viewport=createViewport(312,400,'edgeworth',state),controller=interactionFor(line),ctx={state,viewport,snapTargets:()=>buildSnapTargets(state,viewport.bounds)};
    for(const point of [{x:0,y:0},{x:boxSize.width,y:boxSize.height}]) {
      const result=controller.drag(line,'rotate',line.anchor,point,{},ctx);
      close(result.patch.slope,boxSize.height/boxSize.width);assert.deepEqual(result.tangentSnap.point,point);
      const free=controller.drag(line,'rotate',line.anchor,point,{altKey:true},ctx);assert.equal(free.tangentSnap,null);
    }
    const moved=controller.drag(line,'move',line.anchor,{x:0,y:0},{altKey:true},{...ctx,tangentSnap:null});
    assert.deepEqual(moved.patch.anchor,{x:0,y:0},'Box origin is reachable without the ordinary graph 24px inset');
  }
});

test('corner projection round trips retain exact boundary coordinates for fractional scales and all flips',()=>{
  for(const flipX of [false,true])for(const flipY of [false,true]) {
    const v=createViewport(333,417,'edgeworth',{flipX,flipY,boxSize:{width:13,height:7}});
    for(const p of [{x:0,y:0},{x:13,y:7}])assert.deepEqual(toWorld(toScreen(p,v),v),p);
  }
});

test('rotating from a line through A onto B keeps A pinned even after editing-anchor rebasing',()=>{
  const store=createStore();store.addLine();store.clearAll();store.configureWorkspace('edgeworth',{boxSize:{width:12,height:7}});
  store.addLine();
  assert.equal(store.getState().lines[0].slope,7/12,'The first line in an empty box is independent of global object IDs');
  store.updateSelected({anchor:{x:3,y:1},slope:1/3});
  const state=store.getState(),line=state.lines[0],viewport=createViewport(800,540,'edgeworth',state),controller=interactionFor(line),ctx={state,viewport,snapTargets:()=>buildSnapTargets(state,viewport.bounds)};
  const anchor=controller.start(line,ctx),raw={...line,anchor};
  const result=controller.drag(raw,'rotate',anchor,{x:12,y:7},{},ctx);
  assert.deepEqual(result.patch.anchor,{x:0,y:0});assert.equal(result.patch.slope,7/12);
});
