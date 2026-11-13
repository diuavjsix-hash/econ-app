import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { INDIFFERENCE_FAMILIES } from '../src/graph/indifference.js';

const HANGUL = /[가-힣]/;
/** Every string of the exported JSON except names, which are the user's (or the default) object names. */
function textOutsideNames(value, path = '', found = []) {
  if (typeof value === 'string') { if (!/\.name$/.test(path)) found.push([path, value]); }
  else if (Array.isArray(value)) value.forEach((item, i) => textOutsideNames(item, `${path}[${i}]`, found));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) textOutsideNames(item, `${path}.${key}`, found);
  return found;
}
/** Every kind of object and behavior the editor can put in a drawing. */
function drawEverything(store) {
  const budget = store.addLine();
  store.updateSelected({ slope: -1, anchor: { x: 0, y: 8 } });
  const demand = store.addCurve({ variant: 'descending', anchor: { x: 4, y: 4 }, span: 3 });
  store.addSum([budget, demand], { direction: 'horizontal', nonnegative: true });
  store.addSketch({ x: 1, y: 8 }, { x: 8, y: 2 }, { x: 4, y: 4 }, { lineId: budget });
  store.addFill({ rings: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }]] });
  store.addPoint({ x: 2, y: 2 }); store.lineThroughSelectedPoint({ slope: 1 });
  store.setToolMode('line'); store.addLine({ x: 3, y: 0 }, { x: 3, y: 5 }, { kind: 'segment', style: 'dashed' });
  store.addGroup();
  for (const family of Object.keys(INDIFFERENCE_FAMILIES)) {
    store.addIndifference(family, { anchor: { x: 3, y: 3 } });
    if (family !== 'ppc') store.updateSelected({ opposite: true, oppositeOrigin: { x: 8, y: 7 } });
  }
}

test('the exported JSON is English everywhere except object names, in every format', () => {
  for (const mode of ['first', 'upper', 'all', 'face', 'stacked', 'edgeworth']) {
    const store = createStore(); store.configureWorkspace(mode, { boxSize: { width: 10, height: 8 } }); drawEverything(store);
    const korean = textOutsideNames(serializeDocument(store.getState())).filter(([, text]) => HANGUL.test(text));
    assert.deepEqual(korean, [], `${mode}: ${JSON.stringify(korean.slice(0, 3))}`);
  }
});

test('the legend explains each behavior the JSON carries, and only the formats present', () => {
  const store = createStore(); drawEverything(store);
  const doc = serializeDocument(store.getState());
  for (const key of ['coordinates', 'relations', 'axes', 'lines', 'curves', 'sketches', 'sums', 'bindings', 'fills', 'display']) assert.equal(typeof doc.legend[key], 'string', key);
  for (const key of ['faceToFace', 'stacked', 'edgeworth']) assert.equal(doc.legend[key], undefined, key);
  const kinds = new Set(doc.diagrams[0].lines.concat(doc.diagrams[0].sketches).map(o => o.binding?.kind).filter(Boolean));
  assert.deepEqual([...kinds].sort(), ['tangent', 'through-point'], 'both binding kinds are exported');
  for (const kind of kinds) assert.match(doc.legend.bindings, new RegExp(kind));
  const opposite = doc.diagrams[0].curves.filter(c => c.orientation === 'opposite');
  assert.ok(opposite.length && opposite.every(c => !/the origin/.test(c.geometry.movement)), 'opposite curves never claim to move about A\'s origin');
  assert.ok(opposite.some(c => /the opposite origin/.test(c.geometry.movement)));
  const box = createStore(); box.configureWorkspace('edgeworth');
  assert.match(serializeDocument(box.getState()).legend.edgeworth, /totals\.width - p\.x/);
});
