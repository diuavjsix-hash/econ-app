import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { AnalyticCurveFamily, CURVE_FAMILIES, OPPOSITE_CURVE_FAMILIES, OppositeCurveFamily, curveFamilyOf, isOppositeCurve } from '../src/models/curve-families.js';
import { objectModel } from '../src/models/objects.js';
import { serializeActive } from './fixtures/document.js';
import { snapMovingCurve } from '../src/graph/point-magnets.js';
import { buildSnapTargets } from '../src/graph/snap.js';
import { buildFillRegions } from '../src/graph/fill.js';
import { prepareDuplicate } from '../src/duplicate.js';

const close = (a, b, message) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7, message ?? `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const reflect = (o, p) => ({ x: o.x - p.x, y: o.y - p.y });
const box = { width: 10, height: 8 }, boxBounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 8 };
const edgeworth = () => { const store = createStore(); store.configureWorkspace('edgeworth', { boxSize: box }); return store; };
const curveOf = (store, id) => store.getState().curves.find(c => c.id === id);

test('the opposite wrapper mirrors every family method, so no path falls back to origin-side geometry', () => {
  const methods = Object.getOwnPropertyNames(AnalyticCurveFamily.prototype).filter(name => name !== 'constructor');
  for (const name of methods) assert.ok(Object.hasOwn(OppositeCurveFamily.prototype, name), `OppositeCurveFamily must mirror ${name}`);
  assert.ok(!(OPPOSITE_CURVE_FAMILIES.includes('ppc')), 'PPC is not an indifference curve and keeps one direction');
});

test('an opposite curve is the point reflection of its family through the opposite origin', () => {
  const origin = { x: 10, y: 8 };
  for (const family of OPPOSITE_CURVE_FAMILIES) {
    const c = { family, anchor: { x: 6, y: 4.8 }, shape: family === 'quasilinear' ? 2 : 1.4, linearAxis: 'y', orientation: 'opposite', oppositeOrigin: origin };
    const local = { family, anchor: { x: 4, y: 3.2 }, shape: c.shape, linearAxis: 'y' };
    const pieces = curveFamilyOf(c).clip(c, boxBounds), base = pieces.flat();
    assert.ok(base.length > 0, family);
    const mirrored = CURVE_FAMILIES[family].clip(local, boxBounds).flat().map(p => reflect(origin, p));
    for (const p of base) assert.ok(mirrored.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9), `${family} drawing`);
    if (family !== 'complements') {
      const contact = curveFamilyOf(c).contact(c, -0.8), mirroredContact = reflect(origin, CURVE_FAMILIES[family].contact(local, -0.8));
      close(contact, mirroredContact, `${family} keeps line slopes under reflection`);
    }
  }
});

test('Edgeworth curves start from the B origin and stay attached when the totals change', () => {
  const store = edgeworth();
  const id = store.addIndifference('cobb-douglas', { anchor: { x: 6, y: 4.8 }, opposite: true });
  let curve = curveOf(store, id);
  assert.ok(isOppositeCurve(curve)); assert.deepEqual(curve.oppositeOrigin, { x: 10, y: 8 });
  const before = serializeActive(store.getState());
  assert.equal(before.curves[0].orientation, 'opposite'); assert.deepEqual(before.curves[0].oppositeOrigin, { x: 10, y: 8 });
  assert.equal(before.curves[0].geometry.orientation, 'opposite');
  store.update({ boxSize: { width: 12, height: 9 } });
  curve = curveOf(store, id);
  assert.deepEqual(curve.oppositeOrigin, { x: 12, y: 9 }); close(curve.anchor, { x: 8, y: 5.8 });
  store.undo();
  assert.deepEqual(curveOf(store, id).oppositeOrigin, { x: 10, y: 8 }, 'box change and following curve are one undo step');
  store.configureWorkspace('edgeworth', { boxSize: { width: 6, height: 5 } });
  close(curveOf(store, id).anchor, { x: 2, y: 1.8 });
});

test('the direction toggle keeps the anchor and round-trips through JSON fields', () => {
  const store = createStore();
  const id = store.addIndifference('quasilinear', { anchor: { x: 3, y: 2 } });
  store.updateSelected({ opposite: true, oppositeOrigin: { x: 6, y: 4 } });
  let curve = curveOf(store, id);
  assert.ok(isOppositeCurve(curve)); close(curve.anchor, { x: 3, y: 2 });
  assert.match(curveFamilyOf(curve).movement(curve), /반대 원점|축으로/);
  store.updateSelected({ opposite: false });
  curve = curveOf(store, id);
  assert.equal(isOppositeCurve(curve), false); assert.equal('oppositeOrigin' in serializeActive(store.getState()).curves[0], false);
  store.updateSelected({ opposite: true, oppositeOrigin: { x: 2, y: 1 } });
  assert.equal(isOppositeCurve(curveOf(store, id)), false, 'an origin that does not enclose the anchor is rejected');
  const ppc = store.addIndifference('ppc', { anchor: { x: 2, y: 2 } });
  store.updateSelected({ opposite: true, oppositeOrigin: { x: 6, y: 6 } });
  assert.equal(isOppositeCurve(curveOf(store, ppc)), false);
});

test('moving the opposite origin carries the whole drawing in one undo step', () => {
  const store = createStore();
  const id = store.addIndifference('complements', { anchor: { x: 3, y: 3 }, opposite: true, oppositeOrigin: { x: 6, y: 5 } });
  store.beginHistory(); store.updateSelected({ oppositeOrigin: { x: 7, y: 5.5 } }); store.endHistory();
  const curve = curveOf(store, id);
  assert.deepEqual(curve.oppositeOrigin, { x: 7, y: 5.5 }); close(curve.anchor, { x: 4, y: 3.5 });
  store.undo(); close(curveOf(store, id).anchor, { x: 3, y: 3 });
});

test('radial body movement scales about the opposite origin and a line magnet fits from that side', () => {
  const store = edgeworth();
  const id = store.addIndifference('cobb-douglas', { anchor: { x: 6, y: 4.8 }, opposite: true });
  const curve = curveOf(store, id), family = curveFamilyOf(curve);
  const anchor = family.move(curve, curve.anchor, { x: 5, y: 4 });
  const fromOrigin = reflect({ x: 10, y: 8 }, anchor);
  assert.ok(Math.abs(fromOrigin.y / fromOrigin.x - 0.8) < 1e-9, 'stays on the ray from the B origin');
  store.addLine(); store.selectObject(store.getState().lines[0].id);
  store.updateSelected({ anchor: { x: 5.95, y: 4.75 }, slope: -0.8 });
  const snapped = snapMovingCurve({ ...curve }, store.getState(), boxBounds, 60);
  assert.equal(snapped?.kind, 'tangent');
  const fitted = { ...curve, anchor: snapped.anchor }, tangent = family.tangentVector(fitted, snapped.point);
  assert.ok(Math.abs(snapped.point.y - 4.75 + 0.8 * (snapped.point.x - 5.95)) < 1e-9, 'contact lies on the line');
  assert.ok(Math.abs(tangent.y / tangent.x + 0.8) < 1e-9, 'the B curve touches where its own slope matches');
  const scaled = reflect({ x: 10, y: 8 }, snapped.anchor);
  assert.ok(Math.abs(scaled.y / scaled.x - 0.8) < 1e-9, 'the fit only rescales about the B origin');
});

test('opposite curves feed magnet targets, fills and duplicates through the shared paths', () => {
  const store = edgeworth();
  const id = store.addIndifference('substitutes', { anchor: { x: 6, y: 4 }, opposite: true });
  const state = store.getState();
  assert.ok(buildSnapTargets(state, boxBounds).shapes.some(shape => shape.id === id));
  assert.ok(buildFillRegions(state, boxBounds).length >= 2, 'the mirrored line splits the box into regions');
  const offset = objectModel(curveOf(store, id)).nearbyOffset();
  assert.ok(offset.x < 0 && offset.y < 0, 'nearby copies move away from the B origin');
  const prepared = prepareDuplicate(curveOf(store, id));
  assert.ok(isOppositeCurve(prepared.object), 'a copy keeps its direction');
});
