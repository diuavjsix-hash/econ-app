import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { LAYOUTS, normalizeSlots } from '../src/layouts.js';
import { createViewport, toScreen, toWorld } from '../src/graph/viewport.js';
import { serializeDocument } from '../src/export.js';
import { diagramState } from '../src/workspace.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';

test('presets cover rows, columns, the requested corner and facing axes', () => {
  assert.deepEqual(LAYOUTS.corner3.slots.map(({row, column}) => [row, column]), [[0,0], [1,0], [1,1]]);
  for (const preset of Object.keys(LAYOUTS)) {
    const store = createStore();
    assert.equal(store.configureLayout(preset), true);
    const state = store.getState();
    assert.equal(state.diagrams.length, LAYOUTS[preset].slots.length);
    assert.deepEqual(state.layout.slots, LAYOUTS[preset].slots);
  }
  assert.equal(LAYOUTS.face2.slots[0].flipX, true);
  assert.equal(LAYOUTS.faceVertical2.slots[1].flipY, true);
});

test('each diagram owns objects, hierarchy, axes, quadrants and grid', () => {
  const store = createStore(); store.configureLayout('horizontal3');
  const [a,b,c] = store.getState().diagrams.map(d => d.id);
  const line = store.addLine(); store.updateSelected({ slope: null, anchor: { x: 2, y: 3 } });
  const group = store.addGroup(); store.moveObject(line, group);
  store.update({ axisNames: { x: 'Y', y: 'r' }, quadrantMode: 'all', showGrid: false });
  store.selectDiagram(b); const curve = store.addCurve();
  assert.equal(store.moveObject(curve, group), false);
  store.update({ axisNames: { x: 'N', y: 'W' } });
  store.selectDiagram(c); store.addPoint({ x: 2, y: 4 });
  store.selectDiagram(a);
  assert.equal(store.getState().lines[0].slope, null);
  assert.equal(store.getState().lines[0].parentId, group);
  assert.equal(store.getState().curves.length, 0);
  assert.equal(store.getState().points.length, 0);
  assert.equal(store.getState().quadrantMode, 'all');
  assert.equal(store.getState().showGrid, false);
  assert.deepEqual(store.getState().axisNames, { x: 'Y', y: 'r' });
  const other = diagramState(store.getState(), b);
  assert.equal(other.curves[0].id, curve); assert.equal(other.selectedId, null);
  assert.deepEqual(other.axisNames, { x: 'N', y: 'W' });
});

test('reducing and restoring a layout retains hidden diagrams and exports them', () => {
  const store = createStore(); store.configureLayout('horizontal3');
  const third = store.getState().diagrams[2].id;
  store.selectDiagram(third); store.addLine(); store.updateDiagram({ name: '노동시장' });
  store.configureLayout('single');
  assert.notEqual(store.getState().activeDiagramId, third);
  store.selectDiagram(third); assert.notEqual(store.getState().activeDiagramId, third);
  const doc = serializeDocument(store.getState());
  assert.equal(doc.diagrams.length, 3); assert.equal(doc.layout.slots.length, 1);
  assert.equal(doc.diagrams[2].name, '노동시장'); assert.equal(doc.diagrams[2].lines.length, 1);
  store.configureLayout('vertical3'); store.selectDiagram(third);
  assert.equal(store.getState().lines.length, 1);
  assert.equal(store.getState().diagrams[2].name, '노동시장');
});

test('layout, orientation and cross-diagram edits undo and redo as complete documents', () => {
  const store = createStore(); const original = serializeDocument(store.getState());
  store.configureLayout('face2', null, 'upper');
  const second = store.getState().diagrams[1].id;
  store.selectDiagram(second);
  const configured = serializeDocument(store.getState());
  store.addPoint({ x: 3, y: 2 });
  store.updateDiagram({ flipY: true });
  store.undo(); assert.equal(store.getState().flipY, false);
  store.undo(); assert.equal(store.getState().points.length, 0);
  store.undo(); assert.deepEqual(serializeDocument(store.getState()), original);
  store.redo(); assert.deepEqual(serializeDocument(store.getState()), { ...configured, activeDiagramId: second });
  store.redo(); assert.equal(store.getState().points.length, 1);
  store.redo(); assert.equal(store.getState().flipY, true);
});

test('switching diagrams adds no history and ends an unfinished editing gesture', () => {
  const store = createStore(); store.configureLayout('horizontal2');
  const [a,b] = store.getState().diagrams.map(d => d.id);
  store.selectDiagram(b); store.selectDiagram(a); store.undo();
  assert.equal(store.getState().layout.preset, 'single');
  store.redo(); store.selectDiagram(a); store.addLine();
  store.beginHistory(); store.updateSelected({ name: 'IS', slope: -2 });
  store.selectDiagram(b); store.addCurve(); store.undo(); store.undo();
  assert.equal(store.getState().activeDiagramId, a);
  assert.equal(store.getState().lines[0].slope, 1);
  assert.equal(store.getState().lines[0].name, '직선 01');
});

test('clear deletes only the selected diagram and undo preserves the other graphs', () => {
  const store = createStore(); store.configureLayout('horizontal2'); store.addLine();
  const second = store.getState().diagrams[1].id; store.selectDiagram(second); store.addPoint({ x: 1, y: 2 });
  const before = serializeDocument(store.getState()); store.clearAll();
  assert.equal(store.getState().diagrams[0].lines.length, 1); assert.equal(store.getState().points.length, 0);
  store.undo(); assert.deepEqual(serializeDocument(store.getState()), before);
});

test('custom layouts reject invalid cells, normalize empty margins and remain detached', () => {
  const store = createStore(); const before = store.getState();
  for (const slots of [[], [{row:0,column:0},{row:0,column:0}], [{row:3,column:0}], [null], [{row:0.5,column:0}]]) {
    assert.equal(store.configureLayout('custom', slots), false);
    assert.deepEqual(store.getState(), before);
  }
  assert.equal(store.configureLayout('unknown'), false);
  const slots = [{row:1,column:1}, {row:2,column:2,flipX:true}];
  assert.deepEqual(normalizeSlots(slots).map(s => [s.row,s.column]), [[0,0],[1,1]]);
  store.configureLayout('custom',slots); slots[0].row=9;
  assert.equal(store.getState().layout.slots[0].row,0);
  const state = store.getState(); state.diagrams[0].axisNames.x='changed';
  assert.equal(store.getState().axisNames.x,'x');
});

test('mirrored projections round trip every quadrant and preserve mathematical geometry', () => {
  for (const mode of ['first','upper','all']) for (const flipX of [false,true]) for (const flipY of [false,true]) {
    const viewport = createViewport(300,280,mode,{flipX,flipY});
    assert.deepEqual(viewport.bounds,createViewport(300,280,mode).bounds);
    for (const point of [{x:0,y:0},{x:2,y:3},{x:viewport.bounds.xMax,y:viewport.bounds.yMax}]) {
      const restored = toWorld(toScreen(point,viewport),viewport);
      assert.ok(Math.abs(restored.x-point.x)<1e-10 && Math.abs(restored.y-point.y)<1e-10);
    }
    assert.equal(Math.sign(toScreen({x:1,y:0},viewport).x-viewport.cx),flipX?-1:1);
    assert.equal(Math.sign(toScreen({x:0,y:1},viewport).y-viewport.cy),flipY?1:-1);
  }
});

test('workspace JSON records real directions, origins, per-diagram geometry and positions', () => {
  const store = createStore(); store.configureLayout('face2'); store.addLine(); store.updateSelected({slope:null});
  const second=store.getState().diagrams[1].id; store.selectDiagram(second); store.addCurve();
  store.updateDiagram({flipY:true});
  const doc=JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(doc.schemaVersion,6);
  assert.equal(doc.diagrams[0].coordinateSystem.origin,'bottom-right');
  assert.equal(doc.diagrams[0].coordinateSystem.xPositive,'left');
  assert.equal(doc.diagrams[1].coordinateSystem.origin,'top-left');
  assert.equal(doc.diagrams[1].coordinateSystem.yPositive,'down');
  assert.equal(doc.diagrams[0].lines[0].slope,null);
  assert.equal(doc.diagrams[1].curves.length,1);
  assert.deepEqual(doc.layout.slots.map(s=>[s.diagramId,s.row,s.column]),[['diagram-1',0,0],[second,0,1]]);
  assert.deepEqual(doc.curves,doc.diagrams[1].curves);
  assert.equal('canUndo' in doc,false);
});

test('snap targets stay within a diagram and mirrored mouse input uses the same mathematics', () => {
  const store=createStore(); store.configureLayout('face2');
  store.addLine(); store.updateSelected({slope:1,anchor:{x:0,y:0}});
  const id=store.getState().diagrams[0].id;
  const panel=diagramState(store.getState(),id);
  const viewport=createViewport(400,320,'first',panel);
  const world=toWorld(toScreen({x:2,y:2.05},viewport),viewport);
  const result=snapPoint(world,buildSnapTargets(panel,viewport.bounds),viewport.unit);
  assert.ok(result); assert.ok(Math.abs(result.point.x-result.point.y)<1e-9);
  store.selectDiagram(store.getState().diagrams[1].id);
  assert.equal(store.getState().lines.length,0);
});
