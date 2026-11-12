import { createStore } from '../../src/state.js';

function parabola(store, k, contact, slope, offset = 0) {
  const d = contact.x - 4, s = slope - 2 * k * d, y = contact.y - slope * d + k * d * d + offset;
  const anchor = { x: 4, y }, start = { x: 1, y: y - 3 * s + 9 * k }, end = { x: 7, y: y + 3 * s + 9 * k };
  const id = store.addSketch(start, end, anchor, { tangent: { x: 1, y: s } });
  store.updateSelected({ leftReach: 1.5 * Math.hypot(1, s) / Math.hypot(start.x - 4, start.y - y),
    rightReach: 1.5 * Math.hypot(1, s) / Math.hypot(end.x - 4, end.y - y) });
  return id;
}
const swap = p => ({ x: p.y, y: p.x });

// The same round trips run against pure snapping and the mounted browser canvas.
export const CURVE_CONTACT_CASES = [
  ...[false, true].map(vertical => ({
    name: vertical ? 'free vertical interior' : 'free oblique interior', axis: vertical ? 'x' : 'y', families: [],
    setup() {
      const store = createStore(), point = { x: 4.37, y: 4.13 };
      const target = parabola(store, 0.18, point, -0.65), moving = parabola(store, -0.25, point, -0.65, 0.08);
      if (vertical) for (const id of [target, moving]) {
        const c = store.getState().sketches.find(c => c.id === id); store.selectObject(id);
        store.updateSelected({ start: swap(c.start), end: swap(c.end), anchor: swap(c.anchor), tangent: swap(c.tangent) });
      }
      return { store, target, moving, expected: vertical ? swap(point) : point };
    },
  })),
  {
    name: 'free same-side interior', axis: 'y', families: [],
    setup() {
      const store = createStore(), expected = { x: 4.37, y: 4.13 };
      const target = parabola(store, 0.18, expected, -0.65), moving = parabola(store, 0.25, expected, -0.65, 0.03);
      return { store, target, moving, expected };
    },
  },
  {
    name: 'basic and free interior', axis: 'y', families: [],
    setup() {
      const store = createStore(); store.addCurve({ anchor: { x: 4, y: 4 }, span: 3, variant: 'descending' });
      const basic = store.getState().curves[0], x = 4.37, dx = x - basic.anchor.x;
      const point = { x, y: basic.anchor.y + basic.slope * dx + basic.bend / basic.span * dx * dx };
      const moving = parabola(store, -0.2, point, basic.slope + 2 * basic.bend / basic.span * dx, 0.08);
      return { store, target: basic.id, moving, expected: point };
    },
  },
  {
    // Market demand: the horizontal sum of two linear demands is x = 12 − 2y below its kink at y = 4.
    name: 'free and horizontal sum of lines', axis: 'y', families: [],
    setup() {
      const store = createStore();
      const a = store.addLine({ x: 8, y: 0 }, { x: 0, y: 8 }), b = store.addLine({ x: 4, y: 0 }, { x: 0, y: 4 });
      const target = store.addSum([a, b], { direction: 'horizontal', nonnegative: true });
      // Gentle enough that its slope never reaches the upper branch's −1 within the drawn curve.
      const point = { x: 5.5, y: (12 - 5.5) / 2 };
      return { store, target, moving: parabola(store, 0.05, point, -0.5, 0.08), expected: point };
    },
  },
  {
    // A curved sum: a basic curve raised by a horizontal line, summed vertically.
    name: 'free and vertical sum with a curve', axis: 'y', families: [],
    setup() {
      const store = createStore(); store.addCurve({ anchor: { x: 4, y: 3 }, span: 3, variant: 'descending' });
      const basic = store.getState().curves[0], lift = store.addLine({ x: 0, y: 1 }, { x: 8, y: 1 });
      const target = store.addSum([basic.id, lift], { direction: 'vertical', nonnegative: true });
      const x = 4.37, dx = x - basic.anchor.x;
      const point = { x, y: 1 + basic.anchor.y + basic.slope * dx + basic.bend / basic.span * dx * dx };
      const moving = parabola(store, -0.2, point, basic.slope + 2 * basic.bend / basic.span * dx, -0.08);
      return { store, target, moving, expected: point };
    },
  },
  ...['ppc', 'rectangular-hyperbola', 'cobb-douglas', 'substitutes', 'quasilinear'].map(family => ({
    name: `${family} and PPC`, families: [family, 'ppc'],
    setup() {
      const store = createStore(); let target, moving;
      if (family === 'ppc') {
        target = store.addIndifference('cobb-douglas', { anchor: { x: 3, y: 3 } });
        moving = store.addIndifference('ppc', { anchor: { x: 3.05, y: 3.05 } });
      } else {
        target = store.addIndifference('ppc', { anchor: { x: 3, y: 3 } });
        moving = store.addIndifference(family, { anchor: { x: 3.05, y: 3.05 } });
        if (family === 'quasilinear') store.updateSelected({ shape: 3 });
      }
      return { store, target, moving };
    },
  })),
  // The Edgeworth case: a curve drawn from the opposite origin touches an origin-side curve.
  ...['cobb-douglas', 'substitutes', 'quasilinear'].map(family => ({
    name: `opposite ${family} and cobb-douglas`, families: [], opposite: family, expected: { x: 3, y: 3 },
    setup() {
      const store = createStore(), origin = { x: 8, y: 8 };
      const target = store.addIndifference('cobb-douglas', { anchor: { x: 3, y: 3 } });
      const moving = store.addIndifference(family, family === 'quasilinear' ? { anchor: { x: 3, y: 2.95 }, opposite: true, oppositeOrigin: origin }
        : { anchor: { x: 3.05, y: 3.05 }, opposite: true, oppositeOrigin: origin });
      if (family === 'quasilinear') store.updateSelected({ shape: 5 });
      return { store, target, moving, expected: this.expected };
    },
  })),
];
export const NON_SMOOTH_CONTACT_FAMILIES = ['complements'];
