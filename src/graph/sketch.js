import { directionOf } from './math.js';
import { lineDisplayRegions, isLinePointVisible } from './display.js';
import { clipSegment, validPoint } from './ruler.js';

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function unitVector(vector) {
  const scale=Math.max(Math.abs(vector.x),Math.abs(vector.y));
  if (!Number.isFinite(scale) || scale<1e-10) return {x:1,y:0};
  const x=vector.x/scale,y=vector.y/scale,length=Math.hypot(x,y);
  return {x:x/length || 0,y:y/length || 0};
}
export function projectOnLine(point, line) {
  const direction = directionOf(line.slope);
  const parameter = (point.x - line.anchor.x) * direction.x + (point.y - line.anchor.y) * direction.y;
  return { point: { x: line.anchor.x + parameter * direction.x, y: line.anchor.y + parameter * direction.y }, parameter };
}

export const REACH_MIN = 0.05, REACH_MAX = 2;
export const clampReach = value => Math.max(REACH_MIN, Math.min(REACH_MAX, value));
const along = (point, direction, length) => ({ x: point.x + direction.x * length, y: point.y + direction.y * length });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * The points a sketch passes, in order: start, the through points on the start side, anchor,
 * the through points on the end side, end. Every inner point has a tangent direction and a
 * reach on each side; the two ends have neither. `key` is also the part's link role.
 */
export function sketchKnots(curve) {
  const through = Array.isArray(curve.through) ? curve.through : [];
  const inner = point => ({ key: `through:${point.id}`, id: point.id, point: point.point, tangent: point.tangent, leftReach: point.leftReach, rightReach: point.rightReach });
  return [{ key: 'start', point: curve.start },
    ...through.filter(point => point?.side === 'start').map(inner),
    { key: 'anchor', point: curve.anchor, tangent: curve.tangent, leftReach: curve.leftReach, rightReach: curve.rightReach },
    ...through.filter(point => point?.side === 'end').map(inner),
    { key: 'end', point: curve.end }];
}

/**
 * Quadratic Bezier pieces through every knot. Between an end and an inner point one piece uses
 * the inner point's tangent; between two inner points two pieces meet halfway between their
 * tangent controls, so the curve stays smooth. With only start, anchor and end this is the
 * original two-piece curve exactly.
 */
export function sketchPieces(curve) {
  const knots = sketchKnots(curve), pieces = [];
  for (let span = 0; span < knots.length - 1; span++) {
    const a = knots[span], b = knots[span + 1], length = distance(a.point, b.point);
    const out = a.tangent ? along(a.point, unitVector(a.tangent), length * a.rightReach) : null;
    const into = b.tangent ? along(b.point, unitVector(b.tangent), -(length * b.leftReach)) : null;
    if (out && into) {
      const middle = { x: (out.x + into.x) / 2, y: (out.y + into.y) / 2 };
      pieces.push({ points: [a.point, out, middle], span, part: 'first' }, { points: [middle, into, b.point], span, part: 'second' });
    } else pieces.push({ points: [a.point, out ?? into, b.point], span, part: 'single' });
  }
  return pieces;
}
export const sketchControls = curve => sketchPieces(curve).map(piece => piece.points);

export function validSketch(curve) {
  const through = curve.through ?? [];
  if (!Array.isArray(through)) return false;
  if (!through.every(point => point && typeof point.id === 'string' && point.id && ['start', 'end'].includes(point.side))) return false;
  if (new Set(through.map(point => point.id)).size !== through.length) return false;
  const sides = through.map(point => point.side);
  if (sides.includes('end') && sides.lastIndexOf('start') > sides.indexOf('end')) return false;
  const knots = sketchKnots(curve);
  if (!knots.every(knot => validPoint(knot.point))) return false;
  for (let i = 0; i < knots.length - 1; i++) {
    const gap = distance(knots[i].point, knots[i + 1].point);
    if (!Number.isFinite(gap) || gap <= 1e-6) return false;
  }
  const reach = distance(curve.start, curve.end);
  if (!Number.isFinite(reach) || reach <= 1e-6) return false;
  for (const knot of knots.slice(1, -1)) {
    if (!validPoint(knot.tangent) || !(Math.hypot(knot.tangent.x, knot.tangent.y) > 1e-8)) return false;
    if (![knot.leftReach, knot.rightReach].every(value => Number.isFinite(value) && value >= REACH_MIN && value <= REACH_MAX)) return false;
  }
  return sketchControls(curve).flat().every(validPoint);
}
export function quadraticPoint([a, b, c], t) {
  return { x: (1-t)**2*a.x + 2*(1-t)*t*b.x + t*t*c.x, y: (1-t)**2*a.y + 2*(1-t)*t*b.y + t*t*c.y };
}
export function sketchMinimum(curve) {
  const candidates = [{ ...curve.anchor }, { ...curve.start }, { ...curve.end }, ...(curve.through ?? []).map(point => ({ ...point.point }))];
  for (const points of sketchControls(curve)) {
    const [a,b,c] = points, denominator = a.y - 2*b.y + c.y;
    const t = denominator ? (a.y-b.y)/denominator : -1;
    if (t > 0 && t < 1) candidates.push(quadraticPoint(points,t));
  }
  return candidates.reduce((best, point) => point.y < best.y - 1e-10 ? point : best);
}
/** The minimum marker and its magnet share this: shown only when the option is on and visible. */
export function displayedSketchMinimum(curve, bounds, state) {
  if (!curve.showMinimum) return null;
  const point = sketchMinimum(curve);
  return isLinePointVisible(point, bounds, state) ? point : null;
}
export function displayedSketchSegments(curve, bounds, state) {
  const segments = [];
  const regions = lineDisplayRegions(bounds, state);
  function split(points, depth=0) {
    const [a,b,c] = points;
    if (depth < 14 && Math.hypot(a.x-2*b.x+c.x,a.y-2*b.y+c.y)/4 > 0.001) {
      const ab={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, bc={x:(b.x+c.x)/2,y:(b.y+c.y)/2};
      const mid={x:(ab.x+bc.x)/2,y:(ab.y+bc.y)/2};
      split([a,ab,mid],depth+1); split([mid,bc,c],depth+1);
    } else for (const region of regions) {
      const segment = clipSegment(a,c,region);
      if (segment && distance(...segment) > 1e-10) segments.push(segment);
    }
  }
  sketchControls(curve).forEach(points => split(points));
  return segments;
}

/** The point of a sketch a link role names: start, end, anchor or through:<id>. */
export function sketchRolePoint(curve, role) {
  if (role === 'start' || role === 'end' || role === 'anchor') return curve[role] ?? null;
  return sketchKnots(curve).find(knot => knot.key === role)?.point ?? null;
}
/** The link role of a sketch handle action, when the handle places a point of the curve. */
export function sketchActionRole(action) {
  if (action === 'sketch-start' || action === 'sketch-end') return action.slice(7);
  if (action === 'sketch-middle') return 'anchor';
  const match = /^sketch-point:(.+)$/.exec(action ?? '');
  return match ? `through:${match[1]}` : null;
}

/** An inner knot with its neighbours: the lengths its two reaches are measured against. */
function innerKnot(curve, key) {
  const knots = sketchKnots(curve), index = knots.findIndex(knot => knot.key === key);
  if (index <= 0 || index >= knots.length - 1) return null;
  const knot = knots[index];
  return { knot, before: distance(knots[index - 1].point, knot.point), after: distance(knots[index + 1].point, knot.point) };
}

/**
 * Handle positions. The tangent and reach handles belong to one inner point, `focus`
 * (anchor or through:<id>); the rest of the inner points show only their position.
 */
export function sketchHandlePoints(curve, focus = 'anchor') {
  const found = innerKnot(curve, focus) ?? innerKnot(curve, 'anchor'), { knot, before, after } = found;
  const direction = unitVector(knot.tangent);
  const reach = Math.max(0.5, Math.min(1.5, (before + after) / 4));
  return { start: curve.start, end: curve.end, middle: curve.anchor, focus: knot.key, center: knot.point,
    through: Object.fromEntries((curve.through ?? []).map(point => [point.id, point.point])),
    tangent: along(knot.point, direction, reach),
    leftReach: along(knot.point, direction, -(before * knot.leftReach)), rightReach: along(knot.point, direction, after * knot.rightReach) };
}

/** The reach a pointer sets for one side of an inner point: its distance along the tangent over the neighbour's. */
export function reachFromPoint(curve, key, side, point) {
  const found = innerKnot(curve, key);
  if (!found) return null;
  const { knot, before, after } = found, direction = unitVector(knot.tangent), sign = side === 'leftReach' ? -1 : 1;
  return sign * ((point.x - knot.point.x) * direction.x + (point.y - knot.point.y) * direction.y) / (side === 'leftReach' ? before : after);
}

/** A patch that changes one inner point (anchor or through:<id>): point, tangent, leftReach, rightReach. */
export function sketchKnotPatch(curve, key, changes) {
  if (key === 'anchor') {
    const patch = {};
    if (changes.point) patch.anchor = changes.point;
    for (const name of ['tangent', 'leftReach', 'rightReach']) if (name in changes) patch[name] = changes[name];
    return patch;
  }
  const id = key.replace(/^through:/, '');
  if (!(curve.through ?? []).some(point => point.id === id)) return null;
  return { through: curve.through.map(point => point.id !== id ? structuredClone(point) : {
    ...structuredClone(point), ...(changes.point ? { point: { ...changes.point } } : {}),
    ...(changes.tangent ? { tangent: unitVector(changes.tangent) } : {}),
    ...(Number.isFinite(changes.leftReach) ? { leftReach: clampReach(changes.leftReach) } : {}),
    ...(Number.isFinite(changes.rightReach) ? { rightReach: clampReach(changes.rightReach) } : {}),
  }) };
}

/** A clean through list: known fields only, unit tangents and reaches in range. */
export function normalizedThrough(through) {
  if (!Array.isArray(through)) return null;
  return through.map(point => ({ id: String(point?.id ?? ''), side: point?.side, point: { x: point?.point?.x, y: point?.point?.y },
    tangent: unitVector(point?.tangent ?? { x: 1, y: 0 }), leftReach: clampReach(Number(point?.leftReach)), rightReach: clampReach(Number(point?.rightReach)) }));
}

/** The nearest place on the curve to `at`: which piece and where along it. */
export function nearestOnSketch(curve, at) {
  let best = null;
  sketchPieces(curve).forEach((piece, index) => {
    const steps = 48;
    let t = 0, gap = Infinity;
    for (let i = 0; i <= steps; i++) {
      const d = distance(quadraticPoint(piece.points, i / steps), at);
      if (d < gap) { gap = d; t = i / steps; }
    }
    // Narrow the bracket around the best sample.
    let low = Math.max(0, t - 1 / steps), high = Math.min(1, t + 1 / steps);
    for (let i = 0; i < 40; i++) {
      const m1 = low + (high - low) / 3, m2 = high - (high - low) / 3;
      if (distance(quadraticPoint(piece.points, m1), at) < distance(quadraticPoint(piece.points, m2), at)) high = m2; else low = m1;
    }
    t = (low + high) / 2; gap = distance(quadraticPoint(piece.points, t), at);
    if (!best || gap < best.distance) best = { piece, index, t, distance: gap, point: quadraticPoint(piece.points, t) };
  });
  return best;
}

const nextThroughId = curve => `p${1 + Math.max(0, ...(curve.through ?? []).map(point => Number(/^p(\d+)$/.exec(point.id)?.[1] ?? 0)))}`;

/**
 * Add a through point on the curve nearest to `at`. The piece is split where the point lands
 * and the neighbours' reaches are set so the curve keeps its shape (exactly next to an end of
 * the curve; between two inner points the join of the far half moves slightly).
 * Returns { curve, id } or null.
 */
export function insertSketchPoint(curve, at) {
  if (!validPoint(at)) return null;
  const found = nearestOnSketch(curve, at);
  if (!found) return null;
  const { piece, t } = found, [a, b, c] = piece.points;
  const q0 = lerp(a, b, t), q1 = lerp(b, c, t), point = lerp(q0, q1, t);
  const span = piece.span, knots = sketchKnots(curve), left = knots[span], right = knots[span + 1];
  if (distance(point, left.point) <= 1e-4 || distance(point, right.point) <= 1e-4) return null;
  const heading = distance(q0, q1) > 1e-9 ? { x: q1.x - q0.x, y: q1.y - q0.y } : { x: c.x - a.x, y: c.y - a.y };
  const before = distance(left.point, point), after = distance(point, right.point);
  const id = nextThroughId(curve), anchorIndex = knots.findIndex(knot => knot.key === 'anchor');
  const added = { id, side: span < anchorIndex ? 'start' : 'end', point: { ...point }, tangent: unitVector(heading), leftReach: 0.5, rightReach: 0.5 };
  const inserted = { key: `through:${id}`, point, tangent: added.tangent };
  // Reaches that give each new span the controls of the split piece. A span between two inner
  // points draws one quadratic [X, Q, Y] exactly with halfway controls (X+Q)/2 and (Q+Y)/2.
  const reaches = new Map(), set = (knot, side, value) => reaches.set(knot.key, { ...reaches.get(knot.key), [side]: value });
  const single = (x, y, control, length) => {
    const half = x.tangent && y.tangent ? 2 : 1;
    if (x.tangent) set(x, 'rightReach', distance(control, x.point) / (half * length));
    if (y.tangent) set(y, 'leftReach', distance(y.point, control) / (half * length));
  };
  const pair = (x, y, out, into, length) => { set(x, 'rightReach', distance(out, x.point) / length); set(y, 'leftReach', distance(y.point, into) / length); };
  const sibling = part => sketchPieces(curve).find(p => p.span === span && p.part === part).points[1];
  if (piece.part === 'single') { single(left, inserted, q0, before); single(inserted, right, q1, after); }
  else if (piece.part === 'first') { single(left, inserted, q0, before); pair(inserted, right, q1, sibling('second'), after); }
  else { pair(left, inserted, sibling('first'), q0, before); single(inserted, right, q1, after); }
  Object.assign(added, Object.fromEntries(Object.entries(reaches.get(inserted.key) ?? {}).map(([name, value]) => [name, clampReach(value)])));
  reaches.delete(inserted.key);
  const next = structuredClone(curve), through = [...(next.through ?? [])];
  for (const [key, change] of reaches) {
    const target = key === 'anchor' ? next : through.find(p => `through:${p.id}` === key);
    for (const [name, value] of Object.entries(change)) if (Number.isFinite(value)) target[name] = clampReach(value);
  }
  // Keep the list in curve order: the new point goes right after the knot on its left.
  const leftIndex = left.key.startsWith('through:') ? through.findIndex(p => `through:${p.id}` === left.key) : -1;
  const position = leftIndex >= 0 ? leftIndex + 1 : left.key === 'anchor' ? through.filter(p => p.side === 'start').length : 0;
  through.splice(position, 0, added);
  next.through = through;
  return validSketch(next) ? { curve: next, id } : null;
}

/** Remove one through point; the curve then passes the remaining points. */
export function removeSketchPoint(curve, id) {
  if (!(curve.through ?? []).some(point => point.id === id)) return null;
  const next = structuredClone(curve);
  next.through = next.through.filter(point => point.id !== id);
  if (!next.through.length) delete next.through;
  return validSketch(next) ? next : null;
}

export function translatedSketch(curve, delta) {
  const moved = Object.fromEntries(['start','anchor','end'].map(key=>[key,{x:curve[key].x+delta.x,y:curve[key].y+delta.y}]));
  if (curve.through?.length) moved.through = curve.through.map(point => ({ ...structuredClone(point), point: { x: point.point.x + delta.x, y: point.point.y + delta.y } }));
  return moved;
}
