import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { curveFamilyOf } from '../src/models/curve-families.js';

// The Leontief kink ratio slider slides the kink along the ray from the bottom-left origin (0,0),
// in both drawing directions; the left end of the slider is that origin.
const cross = (a, b) => a.x * b.y - a.y * b.x;
const onRay = (p, direction) => Math.abs(cross(p, direction)) < 1e-9 * Math.max(1, Math.hypot(p.x, p.y)) && p.x >= 0 && p.y >= 0;
const selected = store => store.getState().curves.find(c => c.id === store.getState().selectedId);
const slide = (store, position, bounds) => { const c = selected(store); store.updateSelected(curveFamilyOf(c).fromSliderPosition(c, position, bounds)); return selected(store); };

test('normal direction: the kink slides along its ray from the origin and reaches it at the left end', () => {
  const store = createStore(), bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 8 };
  store.addIndifference('complements', { anchor: { x: 4, y: 3 } });
  const ray = { ...selected(store).anchor }, family = curveFamilyOf(selected(store));
  assert.ok(Math.abs(family.sliderPosition(selected(store), bounds) - 40) < 1e-9, 'the slider shows how far along the visible ray the kink is');
  for (const position of [80, 30, 100, 0]) assert.ok(onRay(slide(store, position, bounds).anchor, ray), `${position}: on the same ray`);
  const end = selected(store).anchor;
  assert.ok(Math.hypot(end.x, end.y) < 1e-5, 'the left end puts the kink on the origin');
  assert.equal(family.sliderPosition(selected(store), bounds), 0);
  const back = slide(store, 40, bounds).anchor;
  assert.ok(onRay(back, ray) && Math.abs(back.x - 4) < 1e-9 && Math.abs(back.y - 3) < 1e-9, 'it keeps its direction and comes back');
  assert.ok(Math.abs(slide(store, 100, bounds).anchor.x - 10) < 1e-9, 'the right end is the edge of the view');
  store.undo(); assert.ok(Math.abs(selected(store).anchor.x - 4) < 1e-9, 'each slide is one undo step');
});

test('opposite direction: the kink slides on the ray through the bottom-left origin, not the opposite origin', () => {
  for (const edgeworth of [true, false]) {
    const store = createStore();
    if (edgeworth) store.configureWorkspace('edgeworth', { boxSize: { width: 10, height: 8 } });
    store.addIndifference('complements', { anchor: { x: 6, y: 3 }, opposite: true, oppositeOrigin: { x: 10, y: 8 } });
    const c = selected(store), ray = { ...c.anchor }, bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 8 };
    assert.equal(c.orientation, 'opposite');
    for (const position of [20, 90, 100, 0]) {
      const next = slide(store, position, bounds);
      assert.equal(next.orientation, 'opposite'); assert.ok(onRay(next.anchor, ray), `${position}: on the ray through (0,0)`);
      assert.ok(next.anchor.x <= 10 - 0.02 + 1e-9 && next.anchor.y <= 8 - 0.02 + 1e-9, 'the kink stays inside the opposite origin');
    }
    assert.ok(Math.hypot(selected(store).anchor.x, selected(store).anchor.y) < 1e-5, 'the left end is the bottom-left origin');
    assert.ok(Math.abs(slide(store, 100, bounds).anchor.x - (10 - 0.02)) < 1e-9, 'the right end stops just short of the opposite origin x');
  }
});

test('other families keep the log shape slider, now owned by the family', () => {
  const store = createStore();
  store.addIndifference('cobb-douglas', { anchor: { x: 4, y: 4 } });
  const c = selected(store), family = curveFamilyOf(c);
  const shape = slide(store, 0, null).shape; assert.ok(Math.abs(shape - 0.15) < 1e-12);
  assert.ok(Math.abs(family.sliderPosition(slide(store, 100, null)) - 100) < 1e-9);
  assert.deepEqual(selected(store).anchor, c.anchor);
});

test('a mirrored Leontief in a box moves, fits and turns about the bottom-left origin, never toward the opposite origin', () => {
  const store = createStore(), o = { x: 10, y: 8 }, bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 8 };
  store.configureWorkspace('edgeworth', { boxSize: { width: 10, height: 8 } });
  store.addIndifference('complements', { anchor: { x: 6, y: 3 }, opposite: true, oppositeOrigin: o });
  const c = selected(store), family = curveFamilyOf(c), ray = { ...c.anchor };
  assert.deepEqual(family.scaleCenter(c), { x: 0, y: 0 }, 'the curve magnet scales it about (0,0)');
  assert.match(family.motion(c), /bottom-left origin \(0,0\)/);
  // Dragging the body slides the kink on its ray from (0,0).
  const dragged = family.move(c, { x: 3, y: 3 }, { x: 4, y: 3.6 });
  assert.ok(onRay(dragged, ray) && dragged.x > c.anchor.x);
  store.updateSelected({ anchor: dragged }); assert.ok(onRay(selected(store).anchor, ray));
  const far = family.move(selected(store), selected(store).anchor, { x: 30, y: 15 });
  assert.ok(onRay(far, ray) && Math.abs(far.x - (o.x - 0.02)) < 1e-9, 'a long drag stops at the opposite origin x axis, off the opposite origin');
  // Through a point: the arm through it, kink still on the ray.
  const through = family.throughPoint(selected(store), { x: 2, y: 2 });
  assert.ok(onRay(through, ray) && Math.abs(Math.max(2 / through.x, 2 / through.y) - 1) < 1e-9);
  // On a line: the kink lands on the line along its ray.
  const fit = family.onLine(selected(store), { anchor: { x: 0, y: 9 }, slope: -1 });
  assert.ok(fit && onRay(fit.anchor, ray) && Math.abs(fit.anchor.y - 9 + fit.anchor.x) < 1e-9);
  // The ratio handle turns the ray about (0,0) and keeps the distance from (0,0).
  const before = Math.hypot(selected(store).anchor.x, selected(store).anchor.y);
  store.updateSelected(family.shapeFromPoint(selected(store), { x: 2, y: 2 }));
  const turned = selected(store).anchor;
  assert.ok(Math.abs(turned.y / turned.x - 1) < 1e-9 && Math.abs(Math.hypot(turned.x, turned.y) - before) < 1e-9);
  // Off the diagonal the slider's right end hits the box edge, not the opposite origin.
  const end = slide(store, 100, bounds).anchor;
  assert.ok(Math.abs(end.y - (o.y - 0.02)) < 1e-9 && end.x < o.x - 1, `${JSON.stringify(end)} stops on the top edge`);
});
