import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { alignedPartners, linkBridges, linkHeld, sourceExtent } from '../src/links.js';
import { createViewport } from '../src/graph/viewport.js';
import { serializeDocument } from '../src/export.js';
import { diagramState } from '../src/workspace.js';
import { buildSnapTargets, snapPoint } from '../src/graph/snap.js';
import { lineEndPoints } from '../src/graph/line-extent.js';
import { INK } from '../src/models/palette.js';

/** Two stacked graphs (top, bottom) with a selected point in the top one. */
function stacked(point = { x: 4, y: 3 }) {
  const store = createStore();
  store.configureLayout('vertical2');
  const [top, bottom] = store.getState().diagrams.map(d => d.id);
  const pointId = store.addPoint(point);
  return { store, top, bottom, pointId };
}
const linesOf = (store, id) => store.getState().diagrams.find(d => d.id === id).lines;

test('partners share the column (vertical link) or row (horizontal link) and the axis placement', () => {
  const store = createStore();
  store.configureLayout('grid4');
  const state = store.getState(), [a, b, c] = state.diagrams.map(d => d.id);
  assert.deepEqual(alignedPartners(state.layout, state.diagrams, a, 'x').map(p => p.diagram.id), [c]);
  assert.deepEqual(alignedPartners(state.layout, state.diagrams, a, 'y').map(p => p.diagram.id), [b]);
  assert.deepEqual(alignedPartners(state.layout, state.diagrams, a, 'z'), []);
  // A different x placement (centered origin) or a flipped x axis does not line up.
  store.selectDiagram(c); store.update({ quadrantMode: 'upper' });
  let next = store.getState();
  assert.deepEqual(alignedPartners(next.layout, next.diagrams, a, 'x'), []);
  store.update({ quadrantMode: 'first' }); store.updateDiagram({ flipX: true });
  next = store.getState();
  assert.deepEqual(alignedPartners(next.layout, next.diagrams, a, 'x'), []);
  // y placement only cares about the y origin: first and upper both sit on the bottom edge.
  store.updateDiagram({ flipX: false }); store.selectDiagram(b); store.update({ quadrantMode: 'upper' });
  next = store.getState();
  assert.deepEqual(alignedPartners(next.layout, next.diagrams, a, 'y').map(p => p.diagram.id), [b]);
  store.update({ quadrantMode: 'edgeworth' });
  next = store.getState();
  assert.deepEqual(alignedPartners(next.layout, next.diagrams, a, 'y'), []);
});

test('a vertical link puts one line at the same x in each graph, reaching down from the point', () => {
  const { store, top, bottom, pointId } = stacked();
  assert.deepEqual(store.linkPartners('x'), [bottom]);
  assert.deepEqual(store.linkPartners('y'), []);
  const id = store.linkThroughSelectedPoint({ axis: 'x' });
  const [source] = linesOf(store, top).filter(line => line.link), [partner] = linesOf(store, bottom);
  assert.equal(source.id, id);
  assert.equal(store.getState().selectedId, id, 'the new link line is selected');
  assert.deepEqual(source.link, partner.link);
  assert.equal(source.slope, null); assert.equal(partner.slope, null);
  assert.equal(source.style, 'dashed'); assert.equal(partner.style, 'dashed');
  assert.equal(source.color, INK.pencil); assert.equal(partner.color, INK.pencil);
  assert.deepEqual(source.binding, { kind: 'through-point', sourceId: pointId });
  assert.deepEqual(source.extent, [null, 0], 'a ray from the point toward the lower graph');
  assert.deepEqual(lineEndPoints(source)[1], { x: 4, y: 3 });
  assert.equal(partner.extent, undefined, 'the partner is a full line');
  assert.equal(partner.anchor.x, 4);
  // One history step creates both lines.
  store.undo();
  assert.equal(linesOf(store, top).length, 0); assert.equal(linesOf(store, bottom).length, 0);
  store.redo();
  assert.equal(linesOf(store, bottom).length, 1);
});

test('moving the followed point carries every member; a free member leads the others', () => {
  const { store, top, bottom, pointId } = stacked();
  store.linkThroughSelectedPoint({ axis: 'x' });
  store.selectObject(pointId); store.updateSelected({ anchor: { x: 6, y: 2 } });
  assert.equal(linesOf(store, bottom)[0].anchor.x, 6);
  const partner = linesOf(store, bottom)[0];
  assert.equal(linkHeld(store.getState().diagrams, partner), true, 'the partner waits for the point');
  // Moving the held partner does not stick: the point still decides.
  store.selectDiagram(bottom); store.selectObject(partner.id); store.updateSelected({ anchor: { x: 1, y: 5 } });
  assert.equal(linesOf(store, bottom)[0].anchor.x, 6);
  // Detach the follow: now whichever member is edited leads.
  store.selectDiagram(top); store.selectObject(linesOf(store, top).find(line => line.link).id); store.detachSelected();
  assert.equal(linkHeld(store.getState().diagrams, linesOf(store, bottom)[0]), false);
  store.selectDiagram(bottom); store.selectObject(linesOf(store, bottom)[0].id); store.updateSelected({ anchor: { x: 2.5, y: 5 } });
  assert.equal(linesOf(store, top).find(line => line.link).anchor.x, 2.5);
});

test('link lines keep their direction, copies are plain lines, and a lone member dissolves', () => {
  const { store, top, bottom } = stacked();
  const id = store.linkThroughSelectedPoint({ axis: 'x', follow: false });
  store.updateSelected({ slope: 2 });
  assert.equal(linesOf(store, top).find(line => line.id === id).slope, null);
  store.updateSelected({ style: 'solid', extent: [null, null] });
  assert.equal(linesOf(store, top).find(line => line.id === id).style, 'solid');
  const copy = store.duplicateSelected();
  assert.equal(linesOf(store, top).find(line => line.id === copy).link, undefined);
  store.selectDiagram(bottom); store.selectObject(linesOf(store, bottom)[0].id); store.removeSelected();
  assert.equal(linesOf(store, top).find(line => line.id === id).link, undefined, 'one member left: a plain line');
  store.undo();
  assert.ok(linesOf(store, top).find(line => line.id === id).link, 'undo restores the link');
});

test('a horizontal link runs along a row and rays point toward the partner, flips included', () => {
  const store = createStore();
  store.configureLayout('horizontal2');
  const [left, right] = store.getState().diagrams.map(d => d.id);
  store.selectDiagram(right); store.addPoint({ x: 2, y: 5 });
  store.linkThroughSelectedPoint({ axis: 'y' });
  const source = linesOf(store, right).find(line => line.link), partner = linesOf(store, left)[0];
  assert.equal(source.slope, 0); assert.equal(partner.anchor.y, 5);
  assert.deepEqual(source.extent, [null, 0], 'toward the graph on the left');
  const slot = (row, column) => ({ row, column });
  const graph = (flipX, flipY) => ({ flipX, flipY });
  assert.deepEqual(sourceExtent({ diagram: graph(false, true), slot: slot(0, 0) }, [{ slot: slot(1, 0) }], 'x'), [0, null], 'y grows downward: down is +y');
  assert.deepEqual(sourceExtent({ diagram: graph(true, false), slot: slot(0, 0) }, [{ slot: slot(0, 1) }], 'y'), [null, 0], 'x grows leftward: right is -x');
  assert.equal(sourceExtent({ diagram: graph(false, false), slot: slot(1, 0) }, [{ slot: slot(0, 0) }, { slot: slot(2, 0) }], 'x'), null, 'partners on both sides: a full line');
});

test('linked graphs share zoom; others keep their own', () => {
  const store = createStore();
  store.configureLayout('vertical3');
  const [a, b, c] = store.getState().diagrams.map(d => d.id);
  store.setDiagramZoom(c, 3);
  store.addPoint({ x: 1, y: 1 });
  store.selectDiagram(b); store.setDiagramZoom(b, 2); store.selectDiagram(a);
  store.selectObject(store.getState().points[0].id); store.linkThroughSelectedPoint({ axis: 'x' });
  const zoom = id => store.getState().diagrams.find(d => d.id === id).zoom;
  assert.deepEqual([zoom(a), zoom(b), zoom(c)], [1, 1, 1], 'new partners take the source zoom');
  store.setDiagramZoom(b, 2);
  assert.deepEqual([zoom(a), zoom(b), zoom(c)], [2, 2, 2]);
  const plain = createStore(); plain.configureLayout('vertical2');
  const [p, q] = plain.getState().diagrams.map(d => d.id);
  plain.setDiagramZoom(p, 2);
  assert.equal(plain.getState().diagrams.find(d => d.id === q).zoom, 1);
});

test('members are ordinary magnets in their own graph and JSON names the link', () => {
  const { store, top, bottom } = stacked();
  store.linkThroughSelectedPoint({ axis: 'x' });
  const lower = diagramState(store.getState(), bottom), viewport = createViewport(400, 300, 'first', lower);
  const snapped = snapPoint({ x: 4.05, y: 0.02 }, buildSnapTargets(lower, viewport.bounds), viewport.unit);
  assert.ok(snapped && Math.abs(snapped.point.x - 4) < 1e-9, 'a point in the lower graph snaps onto the link');
  const json = JSON.parse(JSON.stringify(serializeDocument(store.getState())));
  assert.equal(json.links.length, 1);
  assert.equal(json.links[0].axis, 'x'); assert.equal(json.links[0].value, 4);
  assert.deepEqual(json.links[0].lines.map(l => l.diagramId).sort(), [top, bottom].sort());
  assert.match(json.legend.links, /세로선/);
  const bottomLine = json.diagrams.find(d => d.id === bottom).lines[0];
  assert.deepEqual(bottomLine.link, { id: json.links[0].id, axis: 'x' });
  const plain = serializeDocument(createStore().getState());
  assert.equal('links' in plain, false); assert.equal('links' in plain.legend, false);
});

test('bridges join aligned members across the gap between cards and nowhere else', () => {
  const { store, top, bottom } = stacked();
  store.linkThroughSelectedPoint({ axis: 'x' });
  const state = store.getState();
  const card = (id, y) => { const scoped = diagramState(state, id); return { state: scoped, viewport: createViewport(400, 300, scoped.quadrantMode, scoped), offset: { x: 10, y } }; };
  const [bridge] = linkBridges([card(top, 0), card(bottom, 312)]);
  const v = createViewport(400, 300, 'first');
  const x = 10 + v.cx + 4 * v.unit;
  assert.ok(bridge && Math.abs(bridge.x1 - x) < 1e-9 && bridge.x1 === bridge.x2);
  assert.ok(Math.abs(bridge.y1 - v.plot.bottom) < 1e-9, 'from the upper graph x axis');
  assert.ok(Math.abs(bridge.y2 - (312 + v.plot.top)) < 1e-9, 'to the top of the lower graph');
  assert.equal(linkBridges([card(top, 0), { ...card(bottom, 312), offset: { x: 30, y: 312 } }]).length, 0, 'misaligned cards are not joined');
  // A member trimmed short of the facing edge is not bridged.
  store.selectDiagram(bottom); store.selectObject(store.getState().lines[0].id); store.updateSelected({ extent: [1, 2] });
  const trimmed = store.getState();
  const again = (id, y) => { const scoped = diagramState(trimmed, id); return { state: scoped, viewport: createViewport(400, 300, scoped.quadrantMode, scoped), offset: { x: 10, y } }; };
  assert.equal(linkBridges([again(top, 0), again(bottom, 312)]).length, 0);
});
