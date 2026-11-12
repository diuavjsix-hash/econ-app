import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRelations, ON_TOLERANCE } from '../src/graph/drawn-relations.js';
import { serializeDocument, exportJson, SCHEMA_VERSION } from '../src/export.js';
import { CURVE_FAMILIES } from '../src/models/curve-families.js';
import { createStore } from '../src/state.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';
import { buildSnapTargets, guidedSnapCandidates } from '../src/graph/snap.js';
import { CURVE_CONTACT_CASES } from './fixtures/curve-contact-cases.js';

const sketch = (id, start, end, anchor, tangent) => ({ id, type: 'sketch', start, end, anchor, tangent, leftReach: 0.5, rightReach: 0.5, binding: null });
const base = { quadrantMode: 'first', axisGapEnabled: false, axisGap: 0.75, boxSize: { width: 10, height: 8 }, curves: [], sums: [], fills: [], rulers: [], groups: [] };
const at = (relations, id) => relations.find(entry => entry.points?.includes(id));
const pair = (entry, a, b) => (entry.tangent ?? []).some(p => p.includes(a) && p.includes(b));

// A real exported drawing (Cournot point and a moved isoprofit curve touching a reaction line), full precision.
const drawing = {
  ...base,
  lines: [
    { id: 'line-3', type: 'line', slope: -1.9026845637583896, anchor: { x: 0, y: 14.107987233129153 } },
    { id: 'line-4', type: 'line', slope: -0.3887005649717514, anchor: { x: 0, y: 7.1369817767594546 } },
  ],
  sketches: [
    sketch('sketch-13', { x: 0, y: 0 }, { x: 11.722077627526428, y: 0 }, { x: 4.604411580278601, y: 5.347244394142686 }, { x: 1, y: 0 }),
    sketch('sketch-14', { x: 0.000159657704770666, y: 0.04149300358661634 }, { x: 0.000159657704770666, y: 9.79260182648471 }, { x: 4.604571237983372, y: 5.388737397729303 }, { x: 0, y: 1 }),
    sketch('sketch-16', { x: 0.6532007723197362, y: -0.7494449787840551 }, { x: 12.375278399846163, y: -0.7494449787840551 }, { x: 5.257612352598337, y: 4.597799415358631 }, { x: 1, y: 0 }),
    sketch('sketch-17', { x: 3.112623128255639, y: -0.4301574224445721 }, { x: 3.112623128255639, y: 9.32095140045352 }, { x: 7.71703470853424, y: 4.917086971698114 }, { x: 0, y: 1 }),
  ],
  points: [
    { id: 'point-4', type: 'point', anchor: { x: 4.604411580278601, y: 5.347244394142686 } },
    { id: 'point-5', type: 'point', anchor: { x: 7.6609575975595146, y: 4.159163230363442 } },
  ],
};

test('a point placed with the contact magnet reports the strokes through it and which pair touches', () => {
  const relations = describeRelations(drawing);
  const contact = at(relations, 'point-5');
  assert.deepEqual(new Set(contact.on), new Set(['line-4', 'sketch-16', 'sketch-17']));
  assert.deepEqual(contact.tangent, [['sketch-16', 'line-4']]);
  assert.ok(Math.abs(contact.slopes['sketch-16'] - drawing.lines[1].slope) < 1e-3, 'the curve slope there is the line slope');
  const crossing = at(relations, 'point-4');
  assert.deepEqual(new Set(crossing.on), new Set(['line-3', 'line-4', 'sketch-13', 'sketch-14']));
  assert.equal(crossing.tangent, undefined, 'crossing strokes are not contacts');
  assert.ok(Math.abs(crossing.slopes['sketch-13']) < 1e-9 && Math.abs(crossing.slopes['sketch-14']) > 50, 'a flat peak and a near-vertical side are explicit');
  const start = relations.find(entry => entry.features?.some(f => f.object === 'sketch-13' && f.kind === 'start'));
  assert.deepEqual(new Set(start.on), new Set(['sketch-13', 'axis-x', 'axis-y']), 'a curve drawn from the origin says so');
});

test('relations follow the current geometry: a hand-placed or moved-away point has none', () => {
  const store = createStore();
  const a = store.addLine({ x: 0, y: 6 }, { x: 6, y: 0 }), b = store.addLine({ x: 0, y: 1 }, { x: 6, y: 4 });
  const crossing = { x: 10 / 3, y: 8 / 3 };
  store.addPoint(crossing);
  store.addPoint({ x: crossing.x + 0.05, y: crossing.y });
  let relations = describeRelations(store.getState());
  assert.equal(relations.filter(entry => entry.points).length, 1, 'only the exact point is related');
  assert.deepEqual(new Set(relations.find(entry => entry.points).on), new Set([a, b]));
  store.selectObject(b); store.updateSelected({ anchor: { x: 0, y: 2 } });
  relations = describeRelations(store.getState());
  assert.deepEqual(relations.find(entry => entry.points).on, [a], 'moving a line away removes the stale crossing');
  assert.ok(ON_TOLERANCE < 0.05);
});

test('a contact without a point, an analytic curve contact and a segment end on a curve are reported', () => {
  const store = createStore();
  const line = store.addLine({ x: 0, y: 8 }, { x: 8, y: 0 });
  const free = store.addSketch({ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 4, y: 4 }, { lineId: line });
  let relations = describeRelations(store.getState());
  const touch = relations.find(entry => pair(entry, free, line));
  assert.ok(touch && !touch.points, 'a free curve touching a line is listed without any point');

  const curveId = store.addIndifference('cobb-douglas', { anchor: { x: 3, y: 3 } }), curve = store.getState().curves.find(c => c.id === curveId);
  const contact = CURVE_FAMILIES['cobb-douglas'].contact(curve, -1);
  const budget = store.addLine({ x: 0, y: contact.y + contact.x }, { x: contact.x + contact.y, y: 0 });
  store.addPoint(contact);
  const end = store.getState().sketches[0].end;
  const segment = store.addLine({ x: end.x, y: 6 }, end, { kind: 'segment' });
  relations = describeRelations(store.getState());
  const point = relations.find(entry => entry.points?.length && pair(entry, curve.id, budget));
  assert.ok(point, 'an indifference curve touching a budget line at a placed point');
  const joined = relations.find(entry => entry.features?.some(f => f.object === segment));
  assert.ok(joined.on.includes(free) && joined.features.some(f => f.object === free && f.kind === 'end'), 'a segment drawn to a curve end');
});

test('a curve touching a horizontal sum is a contact; the sum corner where a source stops has no slope', () => {
  const store = createStore();
  const a = store.addLine({ x: 10, y: 0 }, { x: 0, y: 10 }), b = store.addLine({ x: 6, y: 0 }, { x: 0, y: 6 });
  const sum = store.addSum([a, b], { direction: 'horizontal', nonnegative: true }); // x = 16 − 2y below y = 6
  const touch = { x: 10, y: 3 }, d = { x: 2 / Math.sqrt(5), y: -1 / Math.sqrt(5) };
  const curve = store.addSketch({ x: 5, y: 9 }, { x: 15, y: 4 }, touch, { tangent: d });
  store.addPoint(touch);
  store.addPoint({ x: 4, y: 6 });
  const relations = describeRelations(store.getState());
  const contact = at(relations, 'point-1');
  assert.ok(contact.on.includes(sum) && pair(contact, curve, sum), 'the curve and the sum touch at the point');
  assert.ok(Math.abs(contact.slopes[sum] + 0.5) < 1e-6, 'the sum slope there is −1/2');
  const corner = at(relations, 'point-2');
  assert.ok(corner.on.includes(sum) && corner.on.includes(a));
  assert.ok(!(sum in (corner.slopes ?? {})), 'a corner has no single slope');
});

test('a curve moved onto a sum with the magnet is exported as a contact, with no point needed', () => {
  for (const name of ['free and horizontal sum of lines', 'free and vertical sum with a curve']) {
    const { store, target, moving } = CURVE_CONTACT_CASES.find(c => c.name === name).setup();
    const state = store.getState(), curve = state.sketches.find(c => c.id === moving);
    const contact = snapMovingCurve(curve, state, { xMin: 0, xMax: 12, yMin: 0, yMax: 12 }, 50);
    assert.equal(contact?.sourceId, target, `${name}: the moving magnet targets the sum`);
    assert.ok(!describeRelations(state).some(entry => pair(entry, moving, target)), `${name}: no contact before the move`);
    store.selectObject(moving); store.updateSelected({ anchor: contact.anchor, translate: true });
    const entry = describeRelations(store.getState()).find(entry => pair(entry, moving, target));
    assert.ok(entry && Math.hypot(entry.at.x - contact.point.x, entry.at.y - contact.point.y) < 1e-6, `${name}: exported at the contact`);
    // The sum is crossed on display chords; no chord crossing may sit beside the exact contact.
    const bounds = { xMin: 0, xMax: 12, yMin: 0, yMax: 12 }, targets = buildSnapTargets(store.getState(), bounds), p = contact.point;
    const nearby = targets.crossings.filter(c => c.ids?.includes(target) && Math.hypot(c.point.x - p.x, c.point.y - p.y) < 0.01);
    assert.deepEqual(nearby.map(c => c.kind), ['tangent'], `${name}: one target at the contact`);
    const guided = guidedSnapCandidates({ x: p.x + 0.003, y: p.y }, targets, 50, null, 24, { anchor: { x: 1.5, y: p.y }, slope: 0 })
      .filter(c => c.ids.includes(target));
    assert.ok(guided.length && guided.every(c => c.kind === 'tangent'), `${name}: a segment end dragged along its line meets the exact contact`);
  }
});

test('the export lists each diagram once with its relations, a legend and rounded numbers', () => {
  const store = createStore();
  store.configureLayout('custom', [{ row: 0, column: 0, flipX: true }, { row: 0, column: 1 }]);
  store.addLine({ x: 0, y: 6 }, { x: 6, y: 0 });
  store.addPoint({ x: 1 / 3, y: 6 - 1 / 3 });
  const document = serializeDocument(store.getState());
  assert.equal(document.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 13);
  for (const key of ['lines', 'points', 'coordinateSystem', 'objectOrder']) assert.ok(!(key in document), `no top-level ${key} copy`);
  assert.equal(document.diagrams.length, 2);
  assert.ok(document.diagrams.every(diagram => Array.isArray(diagram.relations)));
  assert.equal(typeof document.legend.relations, 'string');
  assert.equal(document.diagrams[0].points[0].anchor.x, 1 / 3, 'the document keeps full precision');
  const text = exportJson(store.getState()), parsed = JSON.parse(text);
  assert.equal(parsed.diagrams[0].points[0].anchor.x, 0.333333);
  assert.equal(parsed.diagrams[0].relations[0].points[0], parsed.diagrams[0].points[0].id);
  assert.ok(!/\d\.\d{7,}/.test(text) && !text.includes('-0,') && !text.includes('-0\n'), 'six decimals, no negative zero');
});
