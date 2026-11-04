import { clipSegment } from './ruler.js';

// The anchor lies on the arc at 45 degrees; both radii are mathematical lengths.
export const ppcRadii = c => ({ x: c.anchor.x * Math.SQRT2, y: c.anchor.y * Math.SQRT2 });
export function ppcValue(c, input, direction = 'vertical') {
  const r = ppcRadii(c), key = direction === 'horizontal' ? 'y' : 'x', other = key === 'x' ? 'y' : 'x';
  if (input < 0 || input > r[key]) return NaN;
  return r[other] * Math.sqrt(Math.max(0, 1 - (input / r[key]) ** 2));
}
export function clipPpc(c, bounds) {
  const r = ppcRadii(c), segments = [];
  const at = t => ({ x: r.x * Math.cos(t), y: r.y * Math.sin(t) });
  function split(low, high, depth = 0) {
    const a = at(low), b = at(high), m = at((low + high) / 2);
    if (depth < 18 && Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2) > 0.0005) {
      split(low, (low + high) / 2, depth + 1); split((low + high) / 2, high, depth + 1);
    } else {
      const segment = clipSegment(a, b, bounds);
      if (segment) { const [p, q] = segment; segments.push([p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, q]); }
    }
  }
  split(0, Math.PI / 2);
  return segments;
}
export function ppcContact(c, slope) {
  const r = ppcRadii(c);
  if (slope === null) return { x: r.x, y: 0 };
  if (slope > 0) return null;
  if (slope === 0) return { x: 0, y: r.y };
  const length = Math.hypot(slope * r.x, r.y);
  return { x: (-slope * r.x / length) * r.x, y: (r.y / length) * r.y };
}
export function ppcThroughPoint(c, point) {
  const r = ppcRadii(c), scale = Math.hypot(point.x / r.x, point.y / r.y);
  return scale > 0 && Math.min(c.anchor.x, c.anchor.y) * scale >= 0.02
    ? { x: c.anchor.x * scale, y: c.anchor.y * scale } : null;
}
export function ppcOnLine(c, line) {
  const point = ppcContact(c, line.slope);
  if (!point) return null;
  const level = p => line.slope === null ? p.x : p.y - line.slope * p.x;
  const scale = level(line.anchor) / level(point);
  if (!(scale > 0) || !Number.isFinite(scale) || Math.min(c.anchor.x, c.anchor.y) * scale < 0.02) return null;
  return { anchor: { x: c.anchor.x * scale, y: c.anchor.y * scale }, point: { x: point.x * scale, y: point.y * scale } };
}
export function ppcLineIntersections(c, line, bounds) {
  const r = ppcRadii(c), vertical = line.slope === null;
  // Solve in normalized ellipse coordinates with a unit direction, including vertical lines.
  const length = vertical ? 1 : Math.hypot(1, line.slope);
  const d = vertical ? { x: 0, y: 1 } : { x: 1 / length, y: line.slope / length };
  const a = (d.x / r.x) ** 2 + (d.y / r.y) ** 2;
  const b = 2 * (line.anchor.x * d.x / r.x ** 2 + line.anchor.y * d.y / r.y ** 2);
  const k = (line.anchor.x / r.x) ** 2 + (line.anchor.y / r.y) ** 2 - 1;
  const discriminant = b * b - 4 * a * k;
  const tolerance = 64 * Number.EPSILON * (b * b + 4 * a * ((line.anchor.x / r.x) ** 2 + (line.anchor.y / r.y) ** 2 + 1));
  if (discriminant < -tolerance) return [];
  const tangent = Math.abs(discriminant) <= tolerance;
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(Math.max(0, discriminant)));
  const roots = tangent ? [-b / (2 * a)] : q ? [q / a, k / q] : [0];
  return roots.map(t => ({ x: line.anchor.x + t * d.x, y: line.anchor.y + t * d.y }))
    .filter(p => p.x >= -1e-9 && p.y >= -1e-9 && p.x >= bounds.xMin - 1e-9 && p.x <= bounds.xMax + 1e-9 && p.y >= bounds.yMin - 1e-9 && p.y <= bounds.yMax + 1e-9)
    .map(p => ({ point: { x: Math.max(0, p.x), y: Math.max(0, p.y) }, kind: tangent ? 'tangent' : 'intersection' }));
}
