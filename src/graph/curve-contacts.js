import { curveControlPoints, curveTangentRays } from './curve.js';
import { sketchControls, quadraticPoint } from './sketch.js';
import { clipLine } from './math.js';
import { validPoint } from './ruler.js';
import { isLinePointVisible } from './display.js';
import { curveFamilyOf } from '../models/curve-families.js';
import { independentSnapState } from './snap-context.js';
import { sumSources, sumError, sourceValue, sumBreakpoints } from './sum.js';

const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const length = p => Math.hypot(p.x, p.y);
const distance = (a, b) => length(sub(a, b));
const unitVector = p => { const n = length(p); return n > 1e-12 ? { x: p.x / n, y: p.y / n } : null; };
const direction = angle => ({ x: Math.cos(angle), y: Math.sin(angle) });
function angles(a, b) {
  const start = Math.atan2(a.y, a.x), turn = Math.atan2(cross(a, b), dot(a, b));
  return [Math.min(start, start + turn), Math.max(start, start + turn)];
}

/** Contact adapters return original geometry at a tangent direction, never mesh chords. */
export class ContactBranch {
  constructor(key) { if (new.target === ContactBranch) throw new TypeError('ContactBranch is abstract'); this.key = key; }
  contact() { throw new TypeError('A contact branch must implement contact()'); }
}
class StraightBranch extends ContactBranch {
  constructor(key, a, b) { super(key); this.a = a; this.b = b; this.vector = unitVector(sub(b, a)); this.straight = true; this.angle = Math.atan2(this.vector.y, this.vector.x); }
  contact(angle, reference = this.a) {
    const v = sub(this.b, this.a), t = Math.max(0, Math.min(1, dot(sub(reference, this.a), v) / dot(v, v)));
    return { point: { x: this.a.x + t * v.x, y: this.a.y + t * v.y }, tangent: this.vector };
  }
  contains(p) { return distance(this.contact(this.angle, p).point, p) < 1e-7; }
  /** How far p is from the branch, and the direction there. */
  tangentAt(p) { return { distance: distance(this.contact(this.angle, p).point, p), tangent: this.vector }; }
}
class QuadraticBranch extends ContactBranch {
  constructor(key, points) {
    super(key); this.points = points;
    this.from = sub(points[1], points[0]); this.to = sub(points[2], points[1]);
    this.range = angles(this.from, this.to);
  }
  contact(angle) {
    const d = direction(angle), from = cross(this.from, d), to = cross(this.to, d), denominator = from - to;
    if (Math.abs(denominator) < 1e-13 * Math.max(length(this.from), length(this.to))) return null;
    const t = from / denominator;
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    const u = Math.max(0, Math.min(1, t));
    const tangent = unitVector({ x: this.from.x * (1 - u) + this.to.x * u, y: this.from.y * (1 - u) + this.to.y * u });
    return tangent ? { point: quadraticPoint(this.points, u), tangent, parameter: u } : null;
  }
  tangentAt(p) {
    const gap = u => distance(quadraticPoint(this.points, u), p), steps = 32;
    let best = 0;
    for (let i = 1; i <= steps; i++) if (gap(i / steps) < gap(best / steps)) best = i;
    const u = minimum(gap, Math.max(0, (best - 1) / steps), Math.min(1, (best + 1) / steps));
    const tangent = unitVector({ x: this.from.x * (1 - u) + this.to.x * u, y: this.from.y * (1 - u) + this.to.y * u });
    return tangent ? { distance: gap(u), tangent } : null;
  }
}
class AnalyticBranch extends ContactBranch {
  constructor(key, curve, family, pieces) {
    super(key); this.curve = curve; this.family = family;
    this.range = angles(family.tangentVector(curve, pieces[0][0]), family.tangentVector(curve, pieces.at(-1).at(-1)));
  }
  contact(angle) {
    const d = direction(angle), slope = Math.abs(d.x) < 1e-12 ? null : d.y / d.x;
    const point = this.family.contact(this.curve, slope);
    if (!validPoint(point)) return null;
    const tangent = unitVector(this.family.tangentVector(this.curve, point));
    return tangent ? { point, tangent } : null;
  }
}
/**
 * One smooth, direction-monotone stretch of a function graph: y(u) for a vertical sum, x(u) for a
 * horizontal one. The direction comes from the evaluated derivative, never from display chords.
 */
class FunctionBranch extends ContactBranch {
  constructor(key, value, vertical, low, high) {
    super(key); this.value = value; this.vertical = vertical; this.low = low; this.high = high;
    this.range = angles(this.raw(low), this.raw(high));
  }
  point(u) { const v = this.value(u); return v === null ? null : this.vertical ? { x: u, y: v } : { x: v, y: u }; }
  slope(u) { return functionSlope(this.value, u, this.low, this.high); }
  raw(u) { const s = this.slope(u); return this.vertical ? { x: 1, y: s } : { x: s, y: 1 }; }
  contact(angle) {
    const d = direction(angle), g = u => cross(this.raw(u), d);
    let low = this.low, high = this.high, gLow = g(low), gHigh = g(high), u;
    if (Math.abs(gLow) < 1e-12) u = low;
    else if (Math.abs(gHigh) < 1e-12) u = high;
    else if (!(gLow * gHigh < 0)) return null;
    else {
      for (let i = 0; i < 64; i++) { const mid = (low + high) / 2, gMid = g(mid); if (gLow * gMid <= 0) high = mid; else { low = mid; gLow = gMid; } }
      u = (low + high) / 2;
    }
    const point = this.point(u), tangent = unitVector(this.raw(u));
    return point && tangent ? { point, tangent, parameter: u } : null;
  }
  tangentAt(p) {
    const u = Math.max(this.low, Math.min(this.high, this.vertical ? p.x : p.y)), point = this.point(u), tangent = unitVector(this.raw(u));
    return point && tangent ? { distance: distance(point, p), tangent } : null;
  }
}
/** Derivative inside [low, high] only, so a corner at either end never leaks into the branch. */
function functionSlope(value, u, low, high) {
  const h = Math.min(1e-6 * Math.max(1, Math.abs(u)), (high - low) / 4);
  const a = Math.max(low, u - h), b = Math.min(high, u + h), va = value(a), vb = value(b);
  return va === null || vb === null || b <= a ? NaN : (vb - va) / (b - a);
}

/**
 * A vertical or horizontal sum as contact branches: straight runs where it is linear (sums of
 * lines) and direction-monotone function runs elsewhere, split at the sum's own breakpoints.
 */
export function sumContactBranches(sum, state, bounds) {
  const sources = sumSources(sum, state);
  if (sumError(sources, sum.direction)) return [];
  const vertical = sum.direction === 'vertical';
  const value = u => {
    if (sum.nonnegative && u < 0) return null;
    let total = 0;
    for (const source of sources) {
      const v = sourceValue(source, u, sum.direction);
      if (!Number.isFinite(v)) return null;
      total += sum.nonnegative ? Math.max(0, v) : v;
    }
    return Number.isFinite(total) ? total : null;
  };
  const min = Math.max(vertical ? bounds.xMin : bounds.yMin, sum.nonnegative ? 0 : -Infinity), max = vertical ? bounds.xMax : bounds.yMax;
  if (!(min < max)) return [];
  const cuts = sumBreakpoints(sum, state, min, max), branches = [];
  for (let i = 1; i < cuts.length; i++) {
    const low = cuts[i - 1], high = cuts[i];
    if (high - low < 1e-9) continue;
    const at = u => vertical ? { x: u, y: value(u) } : { x: value(u), y: u };
    const samples = Array.from({ length: 25 }, (_, k) => low + (high - low) * k / 24), slopes = samples.map(u => functionSlope(value, u, low, high));
    if (slopes.some(s => !Number.isFinite(s))) continue;
    if (Math.max(...slopes) - Math.min(...slopes) <= 1e-9 * Math.max(1, ...slopes.map(Math.abs))) {
      const a = at(low), b = at(high);
      if (validPoint(a) && validPoint(b) && distance(a, b) > 1e-10) branches.push(new StraightBranch(`sum-${i}`, a, b));
      continue;
    }
    // Split where the slope stops rising or falling so each run has one contact per direction.
    let start = 0, trend = 0;
    for (let k = 1; k < samples.length; k++) {
      const step = Math.sign(slopes[k] - slopes[k - 1]);
      if (step && trend && step !== trend) { branches.push(new FunctionBranch(`sum-${i}-${start}`, value, vertical, samples[start], samples[k - 1])); start = k - 1; }
      if (step) trend = step;
    }
    branches.push(new FunctionBranch(`sum-${i}-${start}`, value, vertical, samples[start], high));
  }
  return branches;
}

/** Contact branches of any stroke that can be touched: curves, free curves and sums. */
export function strokeContactBranches(object, state, bounds) {
  return object.type === 'sum' ? sumContactBranches(object, state, bounds) : contactBranches(object, bounds);
}

function quadraticBranch(key, points) {
  const from = sub(points[1], points[0]), to = sub(points[2], points[1]);
  if (Math.abs(cross(from, to)) > 1e-12 * length(from) * length(to) && length(from) > 1e-12 && length(to) > 1e-12) return new QuadraticBranch(key, points);
  // Collinear/reversing quadratics cover one finite interval; exclude zero-length pieces.
  const axis = Math.abs(from.x) + Math.abs(to.x) >= Math.abs(from.y) + Math.abs(to.y) ? 'x' : 'y', cuts = [points[0], points[2]];
  const denominator = points[0][axis] - 2 * points[1][axis] + points[2][axis], t = denominator ? (points[0][axis] - points[1][axis]) / denominator : -1;
  if (t > 0 && t < 1) cuts.push(quadraticPoint(points, t));
  cuts.sort((a, b) => a[axis] - b[axis]);
  return distance(cuts[0], cuts.at(-1)) > 1e-10 ? new StraightBranch(key, cuts[0], cuts.at(-1)) : null;
}
export function contactBranches(curve, bounds) {
  const family = curveFamilyOf(curve);
  if (family) {
    if (family.contactGeometry === 'kink') return []; // An explicit family capability, shared by every consumer.
    const pieces = family.clip(curve, bounds);
    if (!pieces.length) return [];
    if (family.contactGeometry === 'linear') return [new StraightBranch('analytic-line', pieces[0][0], pieces.at(-1).at(-1))];
    return [new AnalyticBranch('analytic', curve, family, pieces)];
  }
  if (curve.type === 'sketch') return sketchControls(curve).map((points, i) => quadraticBranch(`piece-${i}`, points)).filter(Boolean);
  if (curve.type !== 'curve') return [];
  const branches = [quadraticBranch('center', curveControlPoints(curve))];
  curveTangentRays(curve).forEach((ray, i) => {
    const b = { ...bounds };
    if (i === 0) b.xMax = Math.min(b.xMax, ray.anchor.x); else b.xMin = Math.max(b.xMin, ray.anchor.x);
    if (b.xMin >= b.xMax) return;
    const segment = clipLine({ anchor: ray.anchor, slope: ray.direction.y / ray.direction.x }, b);
    if (segment && distance(...segment) > 1e-10) branches.push(new StraightBranch(`extension-${i}`, ...segment));
  });
  return branches.filter(Boolean);
}

export function contactDirectionRanges(a, b) {
  if (a.straight && b.straight) return [];
  if (a.straight || b.straight) return [[(a.straight ? a : b).angle, (a.straight ? a : b).angle]];
  const ranges = [];
  for (let shift = -2; shift <= 2; shift++) {
    const low = Math.max(a.range[0], b.range[0] + shift * Math.PI), high = Math.min(a.range[1], b.range[1] + shift * Math.PI);
    if (high >= low - 1e-12) ranges.push([low, Math.max(low, high)]);
  }
  return ranges;
}
function minimum(fn, low, high) {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = high - ratio * (high - low), b = low + ratio * (high - low), fa = fn(a), fb = fn(b);
  for (let i = 0; i < 64; i++) {
    if (fa <= fb) { high = b; b = a; fb = fa; a = high - ratio * (high - low); fa = fn(a); }
    else { low = a; a = b; fa = fb; b = low + ratio * (high - low); fb = fn(b); }
  }
  return (low + high) / 2;
}
/** One-dimensional search on the common tangent direction, with double-root recovery. */
export function searchContactDirections(fn, low, high, roots) {
  if (high - low < 1e-12) return [low];
  const count = 48, samples = Array.from({ length: count + 1 }, (_, i) => low + (high - low) * i / count), values = samples.map(fn);
  const found = [low, high];
  for (let i = 1; i <= count; i++) {
    if (roots && Number.isFinite(values[i - 1]) && Number.isFinite(values[i]) && values[i - 1] * values[i] < 0) {
      let a = samples[i - 1], b = samples[i], fa = values[i - 1];
      for (let j = 0; j < 64; j++) { const mid = (a + b) / 2, f = fn(mid); if (fa * f <= 0) b = mid; else { a = mid; fa = f; } }
      found.push((a + b) / 2);
    }
    if (i < count && Number.isFinite(values[i]) && (roots ? Math.abs(values[i]) <= Math.abs(values[i - 1]) && Math.abs(values[i]) <= Math.abs(values[i + 1])
      : values[i] <= values[i - 1] && values[i] <= values[i + 1])) {
      found.push(minimum(roots ? t => fn(t) ** 2 : fn, samples[i - 1], samples[i + 1]));
    }
    if (roots && Math.abs(values[i]) < 1e-9) found.push(samples[i]);
  }
  return found.sort((a, b) => a - b).filter((t, i, all) => !i || Math.abs(t - all[i - 1]) > 1e-8);
}
export function isolatedContact(a, b, theta, range, transformPoint = p => p) {
  if (a.straight && b.straight) return false;
  if (a.straight || b.straight) return true;
  const step = Math.max(1e-4, Math.min(0.02, (range[1] - range[0]) * 0.1));
  let probes = 0;
  for (const t of [theta - step, theta + step]) {
    if (t < range[0] || t > range[1]) continue;
    const m = a.contact(t), target = b.contact(t);
    if (!m || !target) continue;
    probes++;
    const point = transformPoint(m.point);
    if (distance(point, target.point) > 1e-7) return true;
  }
  return !probes; // Isolated shared endpoint directions need no invented extension.
}

/** Both moving fits and stationary targets use the same original-geometry contacts. */
export function contactsAtDirection(a, b, theta) {
  let m = a.straight ? null : a.contact(theta), t = b.straight ? null : b.contact(theta);
  if (a.straight && t) m = a.contact(theta, t.point);
  if (b.straight && m) t = b.contact(theta, m.point);
  return m && t && Math.abs(cross(m.tangent, t.tangent)) <= 1e-7 ? { m, t } : null;
}

/** Existing contacts only: never fit or move either curve to create a point target. */
export function curvePairContacts(a, b) {
  const found = [];
  for (const range of contactDirectionRanges(a, b)) {
    const residual = theta => {
      const pair = contactsAtDirection(a, b, theta);
      return pair ? distance(pair.m.point, pair.t.point) ** 2 : Infinity;
    };
    for (const theta of searchContactDirections(residual, ...range, false)) {
      const pair = contactsAtDirection(a, b, theta);
      if (!pair || distance(pair.m.point, pair.t.point) > 1e-7 || !isolatedContact(a, b, theta, range)) continue;
      if (!found.some(contact => distance(contact.point, pair.t.point) < 1e-7)) found.push({ point: pair.t.point, tangent: pair.t.tangent });
    }
  }
  return found;
}

export function coincidentCurves(curve, target) {
  const a = curveFamilyOf(curve), b = curveFamilyOf(target);
  if (a && b) {
    const points = [0.25, 0.75, 1.25, 2, 3, 5, 8, 13];
    let compared = 0;
    for (const x of points) {
      const y = a.value(curve, x), other = b.value(target, x);
      if (!Number.isFinite(y) || !Number.isFinite(other)) continue;
      compared++;
      if (Math.abs(y - other) > 1e-7 * Math.max(1, Math.abs(y), Math.abs(other))) return false;
    }
    return compared >= 3;
  }
  if (a || b || curve.type !== target.type) return false;
  const points = c => c.type === 'sketch' ? sketchControls(c).flat() : curveControlPoints(c);
  const left = points(curve), right = points(target);
  return left.length === right.length && (left.every((p, i) => distance(p, right[i]) < 1e-8) || left.every((p, i) => distance(p, right[right.length - 1 - i]) < 1e-8));
}

/** Shared discrete targets for points, line ends and other guided consumers. */
export function buildCurveContactTargets(state, bounds, excludeObjectId = null) {
  state = independentSnapState(state, excludeObjectId);
  const curves = [...(state.curves ?? []), ...(state.sketches ?? []), ...(state.sums ?? [])];
  const branches = curves.map(c => strokeContactBranches(c, state, bounds)), targets = [];
  for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
    const [a, b] = [curves[i], curves[j]];
    if (a.type === 'sum' || b.type === 'sum') {
      // A sum overlaps its own sources wherever the others add nothing; that is not a contact.
      if ((a.type === 'sum' && b.type === 'sum') || (a.type === 'sum' ? a : b).sourceIds.includes((a.type === 'sum' ? b : a).id)) continue;
    } else if (coincidentCurves(a, b)) continue;
    for (const a of branches[i]) for (const b of branches[j]) for (const { point, tangent } of curvePairContacts(a, b)) {
      if (!isLinePointVisible(point, bounds, state)) continue;
      const ids = [curves[i].id, curves[j].id];
      if (!targets.some(t => t.ids[0] === ids[0] && t.ids[1] === ids[1] && distance(t.point, point) < 1e-7)) {
        targets.push({ point, ids, kind: 'tangent', contactTangent: tangent });
      }
    }
  }
  return targets;
}

/**
 * Tangent directions of the listed curves at a point lying on them, from the original
 * geometry (analytic family or quadratic piece). Parallel directions merge their ids;
 * a kink or a point off the curve gives none.
 */
export function curveTangentsAt(state, bounds, point, ids, tolerance = 1e-6) {
  const listed = new Set(ids ?? []), found = [];
  if (!listed.size || !validPoint(point)) return found;
  const limit = tolerance * Math.max(1, length(point));
  for (const curve of [...(state.curves ?? []), ...(state.sketches ?? [])]) {
    if (!listed.has(curve.id)) continue;
    const family = curveFamilyOf(curve);
    let tangent = null;
    if (family) {
      const nearest = family.contactGeometry === 'kink' ? null : family.nearestPoint(curve, point, bounds);
      if (nearest && distance(nearest, point) <= limit) tangent = unitVector(family.tangentVector(curve, point) ?? { x: 0, y: 0 });
    } else {
      let best = null;
      for (const branch of contactBranches(curve, bounds)) {
        const hit = branch.tangentAt(point);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      if (best && best.distance <= limit) tangent = best.tangent;
    }
    if (!tangent) continue;
    const same = found.find(entry => Math.abs(cross(entry.direction, tangent)) < 1e-9);
    if (same) same.ids.push(curve.id); else found.push({ direction: tangent, ids: [curve.id] });
  }
  return found;
}

export const slopeOfDirection = d => Math.abs(d.x) < 1e-12 ? null : d.y / d.x;
/** Existing curve-curve contacts at this point, with their shared tangent. A kink has none. */
export function contactTangentsAt(crossings, point, tolerance = 1e-6) {
  return crossings.filter(target => target.kind === 'tangent' && target.contactTangent && distance(target.point, point) < tolerance);
}
/** Slope of the common tangent when a point sits on a curve-curve contact, else null. */
export function contactTangentSlope(state, bounds, point) {
  const [contact] = contactTangentsAt(buildCurveContactTargets(state, bounds), point);
  return contact ? { slope: slopeOfDirection(contact.contactTangent), ids: contact.ids } : null;
}
