import test from 'node:test';
import assert from 'node:assert/strict';
import { alphabetLabel, nextFillColor, FILL_COLORS } from '../src/graph/fill-style.js';

const [[FIRST], [SECOND]] = FILL_COLORS;
import { fillLabelPosition, containsFill } from '../src/graph/fill.js';
import { createStore } from '../src/state.js';
import { serializeActive } from './fixtures/document.js';

const shape = x => ({ rings: [[{x,y:0},{x:x+1,y:0},{x,y:1}]] });
const polygon = coordinates => coordinates.map(([x,y])=>({x,y}));

test('new regions automatically get distinct colors and A through Z, AA, AB labels', () => {
  const store = createStore();
  for (let i=0;i<30;i++) {
    const preview = store.getState();
    store.addFill(shape(i*2));
    const fill = store.getState().fills[i];
    assert.equal(fill.color,preview.fillColor); assert.equal(fill.label,preview.fillNextLabel);
    assert.equal(fill.label,alphabetLabel(i)); assert.equal(fill.name,`구역 ${fill.label}`);
    assert.match(fill.color,/^#[0-9a-f]{6}$/);
  }
  assert.equal(new Set(store.getState().fills.map(fill=>fill.color)).size,30);
  assert.equal(store.getState().fills[25].label,'Z'); assert.equal(store.getState().fills[26].label,'AA');
});

test('clicking the same region preserves its existing color and alphabet without a new undo step', () => {
  const store = createStore(), id=store.addFill(shape(0)), first=serializeActive(store.getState());
  assert.notEqual(store.getState().fillColor,store.getState().fills[0].color);
  assert.equal(store.addFill(shape(0)),id); assert.deepEqual(serializeActive(store.getState()),first);
  store.undo(); assert.equal(store.getState().fills.length,0);
});

test('deletion does not renumber surviving labels; undo and redo preserve colors and letters', () => {
  const store=createStore();const ids=[0,2,4].map(x=>store.addFill(shape(x))), before=serializeActive(store.getState());
  store.selectObject(ids[1]);store.removeSelected();
  assert.deepEqual(store.getState().fills.map(fill=>fill.label),['A','C']);
  store.addFill(shape(6));assert.equal(store.getState().fills.at(-1).label,'D');
  assert.equal(new Set(store.getState().fills.map(fill=>fill.color)).size,3);
  const after=serializeActive(store.getState());store.undo();store.redo();assert.deepEqual(serializeActive(store.getState()),after);
  store.undo();store.undo();assert.deepEqual(serializeActive(store.getState()),before);
});

test('colors and alphabets start independently in each graph, including hidden graphs', () => {
  const store=createStore();store.configureLayout('horizontal2');
  const first=store.getState().activeDiagramId, second=store.getState().diagrams[1].id;
  store.addFill(shape(0));store.addFill(shape(2));
  store.selectDiagram(second);assert.equal(store.getState().fillNextLabel,'A');
  store.addFill(shape(0));assert.equal(store.getState().fills[0].label,'A');assert.equal(store.getState().fills[0].color,FIRST);
  store.selectDiagram(first);assert.equal(store.getState().fillNextLabel,'C');
  store.configureLayout('single');store.configureLayout('horizontal2');store.selectDiagram(second);
  assert.equal(store.getState().fills[0].label,'A');
});

test('manual editing preserves the alphabet, and automatic colors avoid manual overrides', () => {
  const store=createStore(),id=store.addFill(shape(0));
  store.selectObject(id);store.updateSelected({color:SECOND,name:'내 구역',opacity:0.5,anchor:{x:2,y:3}});
  assert.equal(store.getState().fills[0].label,'A');assert.equal(store.getState().fills[0].name,'내 구역');
  assert.equal(nextFillColor([{color:FIRST.toUpperCase()},{color:SECOND.toUpperCase()}]),FILL_COLORS[2][0]);
  store.addFill(shape(6));assert.notEqual(store.getState().fills[1].color,SECOND);
  const doc=serializeActive(store.getState());assert.equal(doc.schemaVersion,13);assert.equal(doc.fills[0].label,'A');
  assert.deepEqual(doc.fills,doc.diagrams[0].fills);assert.equal('fillNextLabel' in doc,false);assert.equal('fillAutoColor' in doc,false);
});

test('concave regions and holes receive an interior label with measurable clearance', () => {
  for (const fill of [
    shape(0),
    {rings:[polygon([[0,0],[6,0],[6,1],[1,1],[1,6],[0,6]])]},
    {rings:[polygon([[0,0],[10,0],[10,10],[0,10]]),polygon([[2,2],[8,2],[8,8],[2,8]])]},
  ]) {
    const label=fillLabelPosition(fill);
    assert.ok(label&&containsFill(fill,label));assert.ok(label.radius>0.1);
  }
});

test('label placement uses the visible interior after clipping and returns null for an invisible region', () => {
  const fill={rings:[polygon([[0,0],[10,0],[10,10],[0,10]])]};
  const label=fillLabelPosition(fill,{xMin:8,xMax:12,yMin:2,yMax:5});
  assert.ok(label&&containsFill(fill,label));assert.ok(label.x>8&&label.x<10&&label.y>2&&label.y<5);
  assert.equal(fillLabelPosition(fill,{xMin:11,xMax:12,yMin:2,yMax:5}),null);
  const thin={rings:[polygon([[0,0],[10,0],[10,0.00001],[0,0.00001]])]};
  assert.ok(containsFill(thin,fillLabelPosition(thin)));
});
