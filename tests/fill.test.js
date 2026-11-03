import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFillRegions, findFillRegion, containsFill, fillTouchesRectangle, validFill, fillKey } from '../src/graph/fill.js';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { objectsOf } from '../src/objects.js';
import { editorContext } from '../src/editor-ui.js';
import { diagramState } from '../src/workspace.js';
import { objectsInRectangle } from '../src/graph/selection.js';
import { sketchControls, quadraticPoint } from '../src/graph/sketch.js';

const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
const base = { lines: [], curves: [], sketches: [], sums: [], dashedLines: [], points: [], axisGapEnabled: false };
const line = (id, slope, x, y) => ({ id, type: 'line', anchor: { x, y }, slope });
const polygon = vertices => ({ rings: [vertices.map(([x, y]) => ({ x, y }))] });
const triangle = polygon([[0, 0], [6, 0], [0, 6]]);
const close = (a, b, error = 1e-6) => assert.ok(Math.abs(a - b) < error, `${a} != ${b}`);
function edges(vertices, prefix = 'd') {
  return vertices.map(([x, y], i) => ({ id: `${prefix}-${i}`, type: 'dashed', anchor: { x, y },
    end: { x: vertices[(i + 1) % vertices.length][0], y: vertices[(i + 1) % vertices.length][1] } }));
}

test('one line and the coordinate axes enclose exactly the intended triangle, even with axis gaps', () => {
  for (const axisGapEnabled of [false, true]) {
    const regions = buildFillRegions({ ...base, axisGapEnabled, axisGap: 1, lines: [line('l', -1, 0, 6)] }, bounds);
    assert.equal(regions.length, 1); close(regions[0].area, 18);
    assert.ok(findFillRegion(regions, { x: 1, y: 1 })); assert.equal(findFillRegion(regions, { x: 5, y: 5 }), null);
    assert.ok(findFillRegion(regions, { x: 0.2, y: 0.2 }), 'axis-gap bands do not break a mathematical boundary');
  }
});

test('empty space, grid, open strokes and viewport edges never invent a closed region', () => {
  assert.deepEqual(buildFillRegions(base, bounds), []);
  assert.deepEqual(buildFillRegions({ ...base, showGrid: true, lines: [line('l', 1, 3, 3)] }, bounds), []);
  const dashedLines = edges([[2, 2], [6, 2], [6, 6], [2, 6]]).slice(0, 3);
  assert.deepEqual(buildFillRegions({ ...base, dashedLines }, bounds), []);
  dashedLines.push({ id: 'short', anchor: { x: 2, y: 6 }, end: { x: 2, y: 2.01 } });
  assert.deepEqual(buildFillRegions({ ...base, dashedLines }, bounds), [], 'visible gaps remain open');
});

test('crossing straight lines split adjacent regions without spilling across the boundary', () => {
  const regions = buildFillRegions({ ...base, lines: [line('a', -1, 0, 6), line('b', null, 2, 0)] }, bounds);
  assert.equal(regions.length, 2);
  const a = findFillRegion(regions, { x: 1, y: 1 }), b = findFillRegion(regions, { x: 3, y: 1 });
  assert.ok(a && b && a.key !== b.key); close(a.area + b.area, 18);
});

test('finite dashed polygons close independently and support concave areas and dangling branches', () => {
  const dashedLines = edges([[2, 2], [6, 2], [6, 3], [3, 3], [3, 6], [2, 6]]);
  dashedLines.push({ id: 'tail', anchor: { x: 3, y: 3 }, end: { x: 4, y: 4 } });
  const regions = buildFillRegions({ ...base, dashedLines }, bounds);
  assert.equal(regions.length, 1); close(regions[0].area, 7);
  assert.ok(findFillRegion(regions, { x: 2.5, y: 5 })); assert.equal(findFillRegion(regions, { x: 5, y: 5 }), null);
});

test('disconnected nested polygons form holes and allow each inner region to be filled separately', () => {
  const regions = buildFillRegions({ ...base, dashedLines: [...edges([[1, 1], [9, 1], [9, 9], [1, 9]], 'outer'),
    ...edges([[3, 3], [7, 3], [7, 7], [3, 7]], 'inner')] }, bounds);
  assert.equal(regions.length, 2);
  const outer = findFillRegion(regions, { x: 2, y: 2 }), inner = findFillRegion(regions, { x: 5, y: 5 });
  assert.equal(outer.rings.length, 2); close(outer.area, 48); close(inner.area, 16);
  assert.equal(containsFill(outer, { x: 5, y: 5 }), false);
  assert.equal(fillTouchesRectangle(outer, { xMin: 4, xMax: 6, yMin: 4, yMax: 6 }), false);
});

test('coincident and partially overlapping boundaries merge without duplicate fills', () => {
  const square = edges([[2, 2], [6, 2], [6, 6], [2, 6]]);
  square.push({ id: 'duplicate', anchor: { x: 3, y: 2 }, end: { x: 7, y: 2 } });
  const regions = buildFillRegions({ ...base, dashedLines: square }, bounds);
  assert.equal(regions.length, 1); close(regions[0].area, 16);
});

test('basic curves, free sketches, sums and indifference curves can bound paintable areas', () => {
  const curve = { id: 'c', type: 'curve', variant: 'descending', anchor: { x: 3, y: 3 }, span: 2, slope: -1, bend: 0.2 };
  assert.ok(findFillRegion(buildFillRegions({ ...base, curves: [curve] }, bounds), { x: 1, y: 1 }));
  const store = createStore(); store.addSketch({ x: 0, y: 5 }, { x: 5, y: 0 }, { x: 2, y: 2 });
  assert.ok(findFillRegion(buildFillRegions(store.getState(), bounds), { x: 1, y: 1 }));
  const state = { ...base, lines: [line('a', -1, 0, 3), line('b', -1, 0, 6)], sums: [{ id: 'sum', type: 'sum', direction: 'vertical', sourceIds: ['a', 'b'], nonnegative: true }] };
  const regions = buildFillRegions(state, bounds);
  assert.ok(findFillRegion(regions, { x: 1, y: 6 }));
  const indifference = { id: 'ic', type: 'curve', family: 'cobb-douglas', anchor: { x: 3, y: 3 }, shape: 1 };
  assert.ok(findFillRegion(buildFillRegions({ ...base, curves: [indifference], lines: [line('budget', -1, 0, 8)] }, bounds), { x: 3, y: 3.5 }));
});

test('an exact free-curve tangent between mesh vertices closes a lobe', () => {
  const store = createStore();
  store.addSketch({ x: 1, y: 5 }, { x: 7, y: 5 }, { x: 4, y: 2 });
  const controls = sketchControls(store.getState().sketches[0])[0], t = 0.37;
  const contact = quadraticPoint(controls, t), [a, b, c] = controls;
  const slope = ((1-t)*(b.y-a.y)+t*(c.y-b.y))/((1-t)*(b.x-a.x)+t*(c.x-b.x));
  const onCurve = quadraticPoint(controls, t/2), tangentY = contact.y + slope*(onCurve.x-contact.x);
  const regions = buildFillRegions({ ...store.getState(), lines: [line('tangent', slope, contact.x, contact.y), line('left', null, 1, 0)] }, bounds);
  const lobe = findFillRegion(regions, { x: onCurve.x, y: (onCurve.y+tangentY)/2 });
  assert.ok(lobe); assert.deepEqual(lobe.sourceIds, ['left', 'sketch-1', 'tangent']);
});

test('region geometry is mathematical and stable under reflected axes and viewport enlargement', () => {
  const state = { ...base, lines: [line('l', -1, 0, 6)] };
  const original = findFillRegion(buildFillRegions(state, bounds), { x: 1, y: 1 });
  for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const region = findFillRegion(buildFillRegions({ ...state, flipX, flipY }, { xMin: 0, yMin: 0, xMax: 20, yMax: 20 }), { x: 1, y: 1 });
    assert.equal(region.key, original.key);
  }
});

test('fill tool is exclusive, has a minimal inspector and preferences do not enter history', () => {
  const store = createStore(), modes = ['handSelected', 'mouseSelected', 'dashedSelected', 'sketchSelected', 'duplicatePanel', 'sumPanel', 'fillSelected'];
  for (const mode of modes) {
    store.update({ fillSelected: true }); assert.equal(editorContext(store.getState()).title, '구역 칠하기');
    store.update({ [mode]: true }); const state = store.getState();
    assert.equal(modes.filter(key => state[key]).length, 1); assert.equal(state[mode], true);
  }
  store.update({ fillColor: '#43a999', fillOpacity: 0.4 }); assert.equal(store.getState().canUndo, false);
  assert.deepEqual(serializeDocument(store.getState()).fills, []);
});

test('fill creation, recoloring, opacity and deletion are separate undo steps without stacking', () => {
  const store = createStore(); store.update({ fillSelected: true });
  const before = serializeDocument(store.getState()), id = store.addFill(triangle);
  assert.equal(store.getState().fillSelected, true); assert.equal(store.getState().fills.length, 1);
  const first = serializeDocument(store.getState()); store.addFill(triangle);
  assert.equal(store.getState().fills.length, 1);
  store.update({ fillColor: '#e69451' }); assert.equal(store.addFill(triangle), id);
  assert.equal(store.getState().fills.length, 1); store.undo(); assert.deepEqual(serializeDocument(store.getState()), first);
  store.undo(); assert.deepEqual(serializeDocument(store.getState()), before); store.redo();
  store.selectObject(id); store.updateSelected({ opacity: 0.5 }); assert.equal(store.getState().fills[0].opacity, 0.5);
  store.removeSelected(); assert.equal(store.getState().fills.length, 0); store.undo(); assert.equal(store.getState().fills[0].opacity, 0.5);
});

test('paint is an independent movable shape, and moving/deleting its former boundary leaves it intact', () => {
  const store = createStore(), boundary = store.addLine(); store.updateSelected({ slope: -1, anchor: { x: 0, y: 6 } });
  const region = findFillRegion(buildFillRegions(store.getState(), bounds), { x: 1, y: 1 }), id = store.addFill(region);
  const original = structuredClone(store.getState().fills[0]);
  store.selectObject(boundary); store.updateSelected({ anchor: { x: 0, y: 7 } }); store.removeSelected();
  assert.deepEqual(store.getState().fills[0], original);
  store.selectObject(id); store.beginHistory();
  store.updateSelected({ anchor: { x: original.anchor.x + 1, y: original.anchor.y + 2 } });
  store.endHistory();
  assert.equal(store.getState().fills[0].rings[0][0].x, original.rings[0][0].x + 1);
  store.undo(); assert.deepEqual(store.getState().fills[0], original);
});

test('fills participate in object lists, hierarchy, area selection, clear and graph isolation', () => {
  const store = createStore(); store.configureLayout('horizontal2');
  const id = store.addFill(triangle), folder = store.addGroup(); store.moveObject(id, folder);
  assert.ok(objectsOf(store.getState()).some(object => object.id === id));
  assert.ok(objectsInRectangle(store.getState(), { xMin: 1, xMax: 2, yMin: 1, yMax: 2 }).includes(id));
  store.clearAll(); assert.equal(store.getState().fills.length, 0); store.undo();
  assert.equal(store.getState().fills[0].parentId, folder);
  const first = store.getState().activeDiagramId, second = store.getState().diagrams[1].id;
  store.update({ fillSelected: true }); assert.equal(diagramState(store.getState(), second).fillSelected, false);
  store.selectDiagram(second); assert.equal(store.getState().fills.length, 0);
  store.selectDiagram(first); assert.equal(store.getState().fills[0].id, id);
  store.configureLayout('single'); store.configureLayout('horizontal2'); assert.equal(store.getState().fills.length, 1);
});

test('JSON 10 exports independent deep-copied mathematical rings including holes', () => {
  const store = createStore(), fill = { rings: [...triangle.rings, polygon([[1, 1], [2, 1], [1, 2]]).rings[0]] };
  const id = store.addFill(fill), doc = serializeDocument(store.getState());
  assert.equal(doc.schemaVersion, 10); assert.deepEqual(doc.fills, doc.diagrams[0].fills);
  assert.equal(doc.fills[0].id, id); assert.deepEqual(doc.fills[0].rings, fill.rings);
  assert.equal('fillSelected' in doc, false); assert.equal('collapsed' in doc.fills[0], false);
  doc.fills[0].rings[0][0].x = 123; assert.equal(store.getState().fills[0].rings[0][0].x, 0);
  assert.ok(JSON.stringify(doc));
});

test('invalid and degenerate regions are rejected and ring ordering does not duplicate paint', () => {
  const store = createStore();
  for (const region of [null, { rings: [] }, polygon([[0, 0], [1, 1], [2, 2]]), polygon([[0, 0], [Infinity, 0], [0, 1]])]) {
    assert.equal(validFill(region), false); assert.equal(store.addFill(region), null);
  }
  const reversed = { rings: [[...triangle.rings[0]].reverse()] };
  assert.equal(fillKey(triangle), fillKey(reversed)); assert.equal(store.addFill(triangle), store.addFill(reversed));
  assert.equal(fillKey(triangle), fillKey(polygon([[0,0],[3,0],[6,0],[0,6]])));
  assert.equal(store.getState().fills.length, 1);
});
