import { clipLine } from './math.js';

export const CURVE_PRESETS = {
  descending: { label: '우하향', slope: -0.75, color: '#6068e8' },
  ascending: { label: '우상향', slope: 0.75, color: '#43a999' },
};
export const MAX_BEND = 0.35;

/** A finite, gently bowed quadratic curve, parameterized over -1 <= t <= 1. */
export function curvePoint(curve, t) {
  return {
    x: curve.anchor.x + curve.span * t,
    y: curve.anchor.y + curve.span * (curve.slope * t + curve.bend * t * t),
  };
}

export function curveControlPoints(curve) {
  return [curvePoint(curve, -1), { x: curve.anchor.x, y: curve.anchor.y - curve.span * curve.bend }, curvePoint(curve, 1)];
}

/** Continue outward along each endpoint tangent, preserving ascending/descending monotonicity. */
export function curveTangentRays(curve) {
  return [
    { anchor: curvePoint(curve, -1), direction: { x: -1, y: 2 * curve.bend - curve.slope } },
    { anchor: curvePoint(curve, 1), direction: { x: 1, y: curve.slope + 2 * curve.bend } },
  ];
}

/** The quadratic core and its tangent continuations cover the whole visible domain. */
export function clipCurveWithExtensions(curve, bounds) {
  const [left, right] = curveTangentRays(curve);
  function clipRay(ray) {
    const rayBounds = { ...bounds };
    if (ray.direction.x < 0) rayBounds.xMax = Math.min(bounds.xMax, ray.anchor.x);
    else rayBounds.xMin = Math.max(bounds.xMin, ray.anchor.x);
    if (rayBounds.xMin >= rayBounds.xMax) return [];
    const points = clipLine({ anchor: ray.anchor, slope: ray.direction.y / ray.direction.x }, rayBounds);
    if (!points) return [];
    const [start, end] = points;
    if (start.x === end.x && start.y === end.y) return [];
    // Represent each straight continuation as a quadratic to share the SVG path builder.
    return [[start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end]];
  }
  return [...clipRay(left), ...clipCurve(curve, bounds), ...clipRay(right)];
}

/** Clip the centerline, leaving the renderer free to draw complete strokes and round caps. */
export function clipCurve(curve, bounds) {
  const cuts = [-1, 1];
  const addCut = (t) => { if (Number.isFinite(t) && t > -1 && t < 1) cuts.push(t); };
  for (const x of [bounds.xMin, bounds.xMax]) addCut((x - curve.anchor.x) / curve.span);
  for (const y of [bounds.yMin, bounds.yMax]) {
    const a = curve.bend;
    const b = curve.slope;
    const c = (curve.anchor.y - y) / curve.span;
    if (a === 0) {
      if (b !== 0) addCut(-c / b);
      continue;
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    // This form avoids cancellation when an intersection lies close to t = 0.
    const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    if (q === 0) addCut(-b / (2 * a));
    else { addCut(q / a); addCut(c / q); }
  }
  cuts.sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < cuts.length; i++) {
    const from = cuts[i - 1];
    const to = cuts[i];
    if (to <= from) continue;
    const point = curvePoint(curve, (from + to) / 2);
    if (point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax) continue;
    const previous = intervals.at(-1);
    if (previous && previous[1] === from) previous[1] = to;
    else intervals.push([from, to]);
  }
  return intervals.map(([from, to]) => {
    const start = curvePoint(curve, from);
    const halfSpan = curve.span * (to - from) / 2;
    return [start, {
      x: start.x + halfSpan,
      y: start.y + halfSpan * (curve.slope + 2 * curve.bend * from),
    }, curvePoint(curve, to)];
  });
}

export function bendFromPoint(curve, point, t = 0.6) {
  const bend = (point.y - curve.anchor.y - curve.slope * curve.span * t) / (curve.span * t * t);
  return Math.max(0, Math.min(MAX_BEND, bend));
}
