import { createStore } from '../../src/state.js';
import { curveFamilyOf } from '../../src/models/curve-families.js';
import { curvePoint } from '../../src/graph/curve.js';
import { sketchControls, quadraticPoint } from '../../src/graph/sketch.js';

import { OPPOSITE_CURVE_FAMILIES } from '../../src/models/curve-families.js';

const families = ['ppc', 'rectangular-hyperbola', 'cobb-douglas', 'substitutes', 'complements', 'quasilinear'];
const OPPOSITE_ORIGIN = { x: 8, y: 8 };

// Unit and mounted-canvas checks share the same original geometry, never display vertices.
export const DASHED_CURVE_CASES = [
  ...['basic', 'free', ...families].map(family => ({ name: `${family} crossing`, family, tangent: false })),
  ...['free', ...families.filter(f => !['substitutes', 'complements'].includes(f))]
    .map(family => ({ name: `${family} tangent`, family, tangent: true })),
  { name: 'quasilinear swapped tangent', family: 'quasilinear', tangent: true, swapped: true },
  ...OPPOSITE_CURVE_FAMILIES.map(family => ({ name: `opposite ${family} crossing`, family, tangent: false, opposite: true })),
  ...OPPOSITE_CURVE_FAMILIES.filter(f => !['substitutes', 'complements'].includes(f))
    .map(family => ({ name: `opposite ${family} tangent`, family, tangent: true, opposite: true })),
].map(config => ({ ...config, setup(orientation = 'oblique') {
  const store = createStore(); let curve, point, slope;
  if (config.family === 'basic') {
    const id = store.addCurve({ anchor: { x: 3, y: 3 }, span: 2 });
    curve = store.getState().curves.find(c => c.id === id); point = curvePoint(curve, 0.37);
  } else if (config.family === 'free') {
    const id = store.addSketch({ x: 1, y: 5 }, { x: 6, y: 5 }, { x: 3, y: 2 }, { mode: 'horizontal' });
    curve = store.getState().sketches.find(c => c.id === id);
    const [a, b, c] = sketchControls(curve)[1], t = 0.37;
    point = quadraticPoint([a, b, c], t);
    slope = ((1 - t) * (b.y - a.y) + t * (c.y - b.y)) / ((1 - t) * (b.x - a.x) + t * (c.x - b.x));
  } else {
    const id = store.addIndifference(config.family, { anchor: { x: 3, y: 3 }, ...(config.opposite ? { opposite: true, oppositeOrigin: OPPOSITE_ORIGIN } : {}) });
    if (config.swapped) store.updateSelected({ linearAxis: 'x' });
    curve = store.getState().curves.find(c => c.id === id);
    const family = curveFamilyOf(curve);
    // An opposite complements kink opens toward the lower left.
    // Opposite curves are sampled mid-arc, away from the axes (their own parameter 4.6).
    point = config.family === 'complements' ? { x: 3, y: config.opposite ? 1.87 : 4.13 } : family.pointAt(curve, config.opposite ? 4.6 : 3.37);
    const direction = family.tangentVector(curve, point);
    slope = direction && direction.y / direction.x;
  }
  slope = config.tangent ? slope : orientation === 'vertical' ? null : orientation === 'horizontal' ? 0 : 0.45;
  const direction = slope === null ? { x: 0, y: 1 } : { x: 1, y: slope };
  const length = Math.hypot(direction.x, direction.y);
  const endpoint = scale => ({ x: point.x + scale * direction.x / length, y: point.y + scale * direction.y / length });
  const dashed = store.addDashedLine(endpoint(-1.2), endpoint(1.2));
  return { store, curve: curve.id, dashed, point, kind: config.tangent ? 'tangent' : 'intersection', direction };
} }));
