import { clipLine } from './math.js';
import { clipCurveWithExtensions } from './curve.js';
import { pointGuides } from './point.js';

export const SNAP_RADIUS = 10;
export const INTERSECTION_RADIUS = 16;
const EPS = 1e-9;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (t) => t >= -EPS && t <= 1 + EPS;
const clamp = (t) => Math.max(0, Math.min(1, t));

function evaluate(coefficients, t) {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) result = result * t + coefficients[i];
  return result;
}

/** Isolate roots on monotone intervals, retaining double roots at tangencies. */
function roots(coefficients, min = 0, max = 1) {
  const scale = Math.max(...coefficients.map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0 || min > max) return [];
  const c = coefficients.map((value) => value / scale);
  while (c.length > 1 && Math.abs(c.at(-1)) < 1e-14) c.pop();
  if (c.length === 1) return [];
  if (c.length === 2) {
    const t = -c[0] / c[1];
    return t >= min - EPS && t <= max + EPS ? [Math.max(min, Math.min(max, t))] : [];
  }
  const critical = roots(c.slice(1).map((value, i) => value * (i + 1)), min, max);
  const cuts = [min, ...critical, max].sort((a, b) => a - b);
  const found = [];
  const add = (t) => { if (!found.some((value) => Math.abs(value - t) < 1e-8)) found.push(t); };
  for (const t of cuts) if (Math.abs(evaluate(c, t)) < 1e-12) add(t);
  for (let i = 1; i < cuts.length; i++) {
    let low = cuts[i - 1], high = cuts[i];
    let fLow = evaluate(c, low);
    if (fLow * evaluate(c, high) >= 0) continue;
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2;
      const fMiddle = evaluate(c, middle);
      if (fLow * fMiddle <= 0) high = middle;
      else { low = middle; fLow = fMiddle; }
    }
    add((low + high) / 2);
  }
  return found.sort((a, b) => a - b);
}

function piece(id, points) {
  const [a, b, c] = points;
  const v = { x: 2 * (b.x - a.x), y: 2 * (b.y - a.y) };
  const q = { x: a.x - 2 * b.x + c.x, y: a.y - 2 * b.y + c.y };
  const linear = Math.hypot(q.x, q.y) <= 1e-12 * Math.max(1, distance(a, c));
  return { id, a, v: linear ? sub(c, a) : v, q: linear ? { x: 0, y: 0 } : q, linear };
}

function at(shape, t) {
  return { x: shape.a.x + t * (shape.v.x + t * shape.q.x), y: shape.a.y + t * (shape.v.y + t * shape.q.y) };
}

function straightPiece(id, start, end) {
  return piece(id, [start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end]);
}

function nearest(shape, point) {
  const w = sub(shape.a, point);
  const parameters = shape.linear
    ? [clamp(-dot(w, shape.v) / (dot(shape.v, shape.v) || 1))]
    : [0, 1, ...roots([dot(w, shape.v), dot(shape.v, shape.v) + 2 * dot(w, shape.q), 3 * dot(shape.v, shape.q), 2 * dot(shape.q, shape.q)])];
  let best = null;
  for (const t of parameters) {
    const candidate = at(shape, t);
    if (!best || distance(point, candidate) < distance(point, best)) best = candidate;
  }
  return best;
}

function intersections(a, b) {
  if (a.linear && b.linear) {
    const denominator = cross(a.v, b.v);
    if (Math.abs(denominator) <= 1e-13 * Math.hypot(a.v.x, a.v.y) * Math.hypot(b.v.x, b.v.y)) return [];
    const delta = sub(b.a, a.a);
    const u = cross(delta, b.v) / denominator;
    const v = cross(delta, a.v) / denominator;
    return inside(u) && inside(v) ? [at(a, clamp(u))] : [];
  }
  if (a.linear) [a, b] = [b, a];
  if (b.linear) {
    const lengthSquared = dot(b.v, b.v);
    if (!lengthSquared) return [];
    return roots([cross(sub(a.a, b.a), b.v), cross(a.v, b.v), cross(a.q, b.v)])
      .map((t) => at(a, t)).filter((point) => inside(dot(sub(point, b.a), b.v) / lengthSquared));
  }
  // Rendered curve pieces have linear x and quadratic y, so curve/curve roots are quadratic.
  const dxA = a.v.x, dxB = b.v.x;
  if (!dxA || !dxB) return [];
  const low = Math.max(a.a.x, b.a.x), high = Math.min(at(a, 1).x, at(b, 1).x);
  if (low > high + EPS) return [];
  const v0 = (a.a.x - b.a.x) / dxB, v1 = dxA / dxB;
  const coefficients = [
    a.a.y - b.a.y - b.v.y * v0 - b.q.y * v0 * v0,
    a.v.y - b.v.y * v1 - 2 * b.q.y * v0 * v1,
    a.q.y - b.q.y * v1 * v1,
  ];
  return roots(coefficients, clamp((low - a.a.x) / dxA), clamp((high - a.a.x) / dxA))
    .filter((u) => inside(v0 + v1 * u)).map((u) => at(a, u));
}

/** Use exactly the visible straight, quadratic and tangent geometry; no stored pixels. */
export function buildSnapTargets(state, bounds, excludePointId = null) {
  const shapes = [];
  for (const line of state.lines) {
    const points = clipLine(line, bounds);
    if (points) shapes.push(straightPiece(line.id, ...points));
  }
  for (const curve of state.curves) {
    shapes.push(...clipCurveWithExtensions(curve, bounds).map((points) => piece(curve.id, points)));
  }
  for (const point of state.points ?? []) {
    if (point.id === excludePointId) continue;
    for (const guide of pointGuides(point, bounds)) shapes.push(straightPiece(`guide-${point.id}-${guide.axis}`, guide.start, guide.end));
  }
  if (bounds.yMin <= 0 && bounds.yMax >= 0) shapes.push(straightPiece('axis-x', { x: bounds.xMin, y: 0 }, { x: bounds.xMax, y: 0 }));
  if (bounds.xMin <= 0 && bounds.xMax >= 0) shapes.push(straightPiece('axis-y', { x: 0, y: bounds.yMin }, { x: 0, y: bounds.yMax }));
  const crossings = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (shapes[i].id === shapes[j].id) continue;
      for (const point of intersections(shapes[i], shapes[j])) {
        if (!crossings.some((item) => distance(point, item.point) < 1e-7)) crossings.push({ point, ids: [shapes[i].id, shapes[j].id] });
      }
    }
  }
  return { shapes, crossings };
}

/** Intersections get a larger capture radius and take priority over the nearest stroke. */
export function snapPoint(point, targets, unit) {
  let crossing = null, bestDistance = INTERSECTION_RADIUS;
  for (const candidate of targets.crossings) {
    const pixels = distance(point, candidate.point) * unit;
    if (pixels <= bestDistance) { crossing = candidate; bestDistance = pixels; }
  }
  if (crossing) return { point: { ...crossing.point }, kind: 'intersection', ids: [...crossing.ids] };
  let snapped = null;
  bestDistance = SNAP_RADIUS;
  for (const shape of targets.shapes) {
    const candidate = nearest(shape, point);
    const pixels = distance(point, candidate) * unit;
    if (pixels <= bestDistance) {
      snapped = { point: candidate, kind: 'shape', ids: [shape.id] };
      bestDistance = pixels;
    }
  }
  return snapped;
}
