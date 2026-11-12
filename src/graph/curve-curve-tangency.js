import { translatedSketch } from './sketch.js';
import { validPoint } from './ruler.js';
import { isLinePointVisible } from './display.js';
import { curveFamilyOf } from '../models/curve-families.js';
import { canAttach } from '../relations.js';
import { SNAP_RELEASE_PX, SHAPE_SNAP_POLICY } from './snap-policy.js';
import { contactBranches, strokeContactBranches, contactDirectionRanges, contactsAtDirection, searchContactDirections, isolatedContact, coincidentCurves } from './curve-contacts.js';
export { contactBranches } from './curve-contacts.js';

const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const length = p => Math.hypot(p.x, p.y);
const distance = (a, b) => length(sub(a, b));
const inside = (p, b) => validPoint(p) && p.x >= b.xMin - 1e-9 && p.x <= b.xMax + 1e-9 && p.y >= b.yMin - 1e-9 && p.y <= b.yMax + 1e-9;

function movement(curve, axis) {
  const family = curveFamilyOf(curve);
  // Radial families scale about their own center: the origin, or an opposite curve's origin.
  return { family, radial: family?.radial, center: family?.radial ? family.scaleCenter(curve) : null,
    axis: family?.translationAxis ? family.translationAxis(curve) : family ? null : axis };
}
const scaled = (p, center, scale) => ({ x: center.x + (p.x - center.x) * scale, y: center.y + (p.y - center.y) * scale });
function fit(curve, a, b, mode) {
  const delta = sub(b.point, a.point);
  if (mode.radial) {
    const from = sub(a.point, mode.center), to = sub(b.point, mode.center), anchor = sub(curve.anchor, mode.center);
    const scale = dot(to, from) / dot(from, from);
    if (!(scale > 0) || !Number.isFinite(scale) || Math.min(Math.abs(anchor.x), Math.abs(anchor.y)) * scale < 0.02) return null;
    if (distance(scaled(a.point, mode.center, scale), b.point) > 1e-7) return null;
    return { anchor: scaled(curve.anchor, mode.center, scale), scale };
  }
  if (mode.axis && Math.abs(delta[mode.axis === 'x' ? 'y' : 'x']) > 1e-7) return null;
  const anchor = mode.family ? mode.family.throughPoint(curve, b.point) : { x: curve.anchor.x + (mode.axis === 'y' ? 0 : delta.x), y: curve.anchor.y + (mode.axis === 'x' ? 0 : delta.y) };
  return validPoint(anchor) ? { anchor, scale: 1 } : null;
}
function coincidentPose(curve, target, anchor) {
  if (target.type === 'sum') return false; // A moved curve is never one of the sum's sources.
  const moved = curve.type === 'sketch' ? { ...curve, ...translatedSketch(curve, sub(anchor, curve.anchor)) } : { ...curve, anchor };
  return coincidentCurves(moved, target);
}

function pairCandidates(curve, target, a, b, mode, bounds, state, unit, reference, expanded) {
  if (a.straight && b.straight) return [];
  const ranges = contactDirectionRanges(a, b);
  const candidates = [];
  for (const range of ranges) {
    const contacts = theta => {
      const original = contactsAtDirection(a, b, theta); if (!original) return null;
      let { m, t } = original;
      if (a.straight || b.straight) {
        const line = a.straight ? a : b, fixed = a.straight ? t.point : m.point;
        if (mode.radial && b.straight) {
          const scale = cross(sub(line.a, mode.center), line.vector) / cross(sub(fixed, mode.center), line.vector);
          const p = scaled(fixed, mode.center, scale);
          if (!validPoint(p) || !line.contains(p)) return null;
          t = { ...t, point: p };
        } else if (mode.axis) {
          const axis = mode.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 }, denominator = cross(axis, line.vector);
          if (Math.abs(denominator) < 1e-12) return null;
          const amount = cross(sub(line.a, fixed), line.vector) / denominator, p = { x: fixed.x + amount * axis.x, y: fixed.y + amount * axis.y };
          if (!line.contains(p)) return null;
          if (a.straight) m = { ...m, point: p }; else t = { ...t, point: p };
        }
      }
      return { m, t };
    };
    const roots = mode.radial || Boolean(mode.axis);
    const residual = theta => {
      const pair = contacts(theta); if (!pair) return NaN;
      const { m, t } = pair;
      if (mode.radial) { const m0 = sub(m.point, mode.center); return cross(m0, sub(t.point, mode.center)) / Math.max(1e-12, length(m0)); }
      if (mode.axis) return t.point[mode.axis === 'x' ? 'y' : 'x'] - m.point[mode.axis === 'x' ? 'y' : 'x'];
      if (!inside(m.point, expanded) || !isLinePointVisible(t.point, bounds, state)) return Infinity;
      return distance(m.point, t.point) ** 2;
    };
    const parameters = range[1] - range[0] < 1e-12 ? [range[0]] : searchContactDirections(residual, ...range, roots);
    parameters.forEach((theta, index) => {
      const pair = contacts(theta); if (!pair) return;
      const pose = fit(curve, pair.m, pair.t, mode);
      if (!pose || !validPoint(pose.anchor) || !inside(pair.m.point, expanded) || !isLinePointVisible(pair.t.point, bounds, state)) return;
      const pixels = (mode.family ? mode.family.moveDistance(curve, pose.anchor) : distance(curve.anchor, pose.anchor)) * unit;
      if (!Number.isFinite(pixels) || pixels > SNAP_RELEASE_PX || !isolatedContact(a, b, theta, range, p => pose.scale !== 1
        ? scaled(p, mode.center, pose.scale)
        : { x: p.x + pose.anchor.x - curve.anchor.x, y: p.y + pose.anchor.y - curve.anchor.y }) || coincidentPose(curve, target, pose.anchor)) return;
      candidates.push({ key: `curve-tangent:${target.id}:${a.key}:${b.key}:${index}`, kind: 'tangent', label: '접점 맞춤', sourceId: target.id, ids: [curve.id, target.id],
        point: pair.t.point, anchor: pose.anchor, distance: Math.round(pixels * 1e9) / 1e9, pointerDistance: distance(pair.t.point, reference) * unit,
        movingContact: pair.m.point, tangent: pair.t.tangent });
    });
  }
  return candidates;
}

/** Fit a moving curve onto another curve without reshaping, rotating or creating bindings. */
export function snapCurveToCurveTangency(curve, state, bounds, unit, { previous = null, reference = curve.anchor, altKey = false, axis = null } = {}) {
  if (altKey || curve.binding || !['curve', 'sketch'].includes(curve.type) || !validPoint(curve.anchor) || !Number.isFinite(unit) || unit <= 0) return null;
  const margin = SNAP_RELEASE_PX / unit, expanded = { xMin: bounds.xMin - margin, xMax: bounds.xMax + margin, yMin: bounds.yMin - margin, yMax: bounds.yMax + margin };
  const moving = contactBranches(curve, expanded), mode = movement(curve, axis), candidates = [];
  if (!moving.length) return null;
  // Sums are stationary strokes too: their straight runs act like lines, curved runs like curves.
  for (const target of [...state.curves, ...(state.sketches ?? []), ...(state.sums ?? [])]) {
    if (target.id === curve.id || !canAttach(state, curve.id, target.id)) continue;
    const stationary = strokeContactBranches(target, state, bounds);
    for (const a of moving) for (const b of stationary) candidates.push(...pairCandidates(curve, target, a, b, mode, bounds, state, unit, reference, expanded));
  }
  return SHAPE_SNAP_POLICY.choose(candidates, previous);
}
