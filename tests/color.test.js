import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { selectionColors } from '../src/tools/color.js';
import { swatches } from '../src/ui/controls.js';
import { STROKE_PALETTE, INK } from '../src/models/palette.js';
import { serializeActive } from './fixtures/document.js';

const colorOf = (store, id) => [...store.getState().lines, ...store.getState().sketches, ...store.getState().points].find(o => o.id === id)?.color;

function kinked() {
  const store = createStore();
  const upper = store.addLine({ x: 4, y: 5 }, { x: 0, y: 9 }, { kind: 'ray' });
  const lower = store.addLine({ x: 4, y: 5 }, { x: 9, y: 0 }, { kind: 'ray' });
  const point = store.addPoint({ x: 4, y: 5 });
  store.selectObjects([upper, lower, point]);
  const group = store.groupSelected();
  return { store, upper, lower, point, group };
}

test('a single shape takes the chosen color in one undo step', () => {
  const store = createStore(), line = store.addLine({ x: 0, y: 1 }, { x: 3, y: 4 });
  const before = colorOf(store, line);
  assert.equal(store.colorSelected(INK.plum), true);
  assert.equal(colorOf(store, line), INK.plum);
  assert.equal(serializeActive(store.getState()).lines[0].color, INK.plum, 'the JSON keeps the color');
  store.undo(); assert.equal(colorOf(store, line), before);
  assert.equal(store.colorSelected('red'), false, 'only #rrggbb colors are accepted');
  assert.equal(store.colorSelected(before), false, 'the same color is no change');
});

test('a set takes one color for every shape inside; the set itself has no drawn color', () => {
  const { store, upper, lower, point, group } = kinked();
  const groupColor = store.getState().groups[0].color;
  assert.deepEqual(selectionColors(store.getState()).length > 1, true, 'different member colors read as mixed');
  store.colorSelected(INK.green);
  for (const id of [upper, lower, point]) assert.equal(colorOf(store, id), INK.green);
  assert.equal(store.getState().groups[0].color, groupColor);
  assert.deepEqual(selectionColors(store.getState()), [INK.green]);
  store.selectObject(lower); // entered the set
  store.colorSelected(INK.red);
  assert.equal(colorOf(store, lower), INK.red); assert.equal(colorOf(store, upper), INK.green, 'only the member inside the set changes');
  store.selectObject(group);
  assert.equal(selectionColors(store.getState()).length, 2);
});

test('a multi-selection takes one color, nested sets included', () => {
  const { store, upper, group } = kinked();
  const other = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 3 });
  store.selectObjects([group, other]);
  store.colorSelected(INK.ochre);
  assert.equal(colorOf(store, upper), INK.ochre); assert.equal(colorOf(store, other), INK.ochre);
  store.undo(); assert.notEqual(colorOf(store, other), INK.ochre, 'one undo for the whole selection');
});

test('the custom picker preview is one history step', () => {
  const store = createStore(), line = store.addLine({ x: 0, y: 1 }, { x: 3, y: 4 }), before = colorOf(store, line);
  store.beginHistory();
  for (const color of ['#112233', '#223344', '#334455']) store.colorSelected(color);
  store.endHistory();
  assert.equal(colorOf(store, line), '#334455');
  store.undo(); assert.equal(colorOf(store, line), before);
});

test('the color row is built from the palette by the shared swatch generator', () => {
  const html = swatches({ label: '색', colors: STROKE_PALETTE, data: { 'color-scope': 'object' }, customId: 'object-color-custom', mixedId: 'object-color-mixed' });
  assert.equal((html.match(/class="swatch"/g) ?? []).length, STROKE_PALETTE.length);
  for (const [color, name] of STROKE_PALETTE) { assert.ok(html.includes(`data-color="${color}"`)); assert.ok(html.includes(`aria-label="${name}"`)); }
  assert.match(html, /id="object-color-custom" type="color"/); assert.match(html, /id="object-color-mixed"[^>]*hidden/);
  assert.equal(new Set(STROKE_PALETTE.map(([c]) => c)).size, STROKE_PALETTE.length);
});
