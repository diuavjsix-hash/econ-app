import { directionOf, clipLineParameters } from './math.js';
import { lineDisplayRegions } from './display.js';

/**
 * A line may stop at either end. `extent` is [from, to]: signed distances along
 * directionOf(slope) from the anchor, null for an end that continues to the edge.
 * Stored in mathematical units, so vertical lines (slope null) need no special case.
 */
export const LINE_END_ACTIONS = Object.freeze({ 'line-from': 0, 'line-to': 1 });
export const MIN_LINE_LENGTH = 1e-6;
const dot = (a, b) => a.x * b.x + a.y * b.y;

export const isTrimmed = line => Array.isArray(line?.extent) && line.extent.some(value => value !== null);
export const lineParameter = (line, point) => dot({ x: point.x - line.anchor.x, y: point.y - line.anchor.y }, directionOf(line.slope));
export function linePointAt(line, t) {
  const d = directionOf(line.slope);
  return { x: line.anchor.x + t * d.x, y: line.anchor.y + t * d.y };
}
/** Whether a point on the supporting line lies on the drawn part. */
export function onLineExtent(line, point, tolerance = 1e-9) {
  if (!isTrimmed(line)) return true;
  const t = lineParameter(line, point), [from, to] = line.extent;
  return (from === null || t >= from - tolerance) && (to === null || t <= to + tolerance);
}
/** A valid stored extent, or null for an untrimmed line. Invalid input is undefined. */
export function normalizeExtent(extent) {
  if (extent === null) return null;
  if (!Array.isArray(extent) || extent.length !== 2) return undefined;
  const [from, to] = extent.map(value => value === null ? null : Number(value));
  if ([from, to].some(value => value !== null && !Number.isFinite(value))) return undefined;
  if (from !== null && to !== null && to - from < MIN_LINE_LENGTH) return undefined;
  return from === null && to === null ? null : [from === 0 ? 0 : from, to === 0 ? 0 : to];
}
/** The same drawn ends measured from another anchor on the same line. */
export function rebasedExtent(line, anchor) {
  if (!isTrimmed(line)) return null;
  const shift = lineParameter(line, anchor);
  return line.extent.map(value => value === null ? null : value - shift);
}
/** The same physical ends after a slope change. `heading` is where the old +direction now points. */
export function rotatedExtent(extent, slope, heading) {
  if (!extent) return null;
  const [from, to] = extent;
  return dot(directionOf(slope), heading) < 0 ? [to === null ? null : -to, from === null ? null : -from] : [from, to];
}
/** Stored end points; null for an open end. */
export function lineEndPoints(line) {
  return isTrimmed(line) ? line.extent.map(t => t === null ? null : linePointAt(line, t)) : [null, null];
}
/** Visible ends of the drawn part across every display region; `open` ends meet the edge. */
export function visibleLineEnds(line, bounds, state) {
  let low = Infinity, high = -Infinity, edgeLow = Infinity, edgeHigh = -Infinity;
  for (const region of lineDisplayRegions(bounds, state)) {
    const full = clipLineParameters({ ...line, extent: null }, region);
    if (full) { edgeLow = Math.min(edgeLow, full[0]); edgeHigh = Math.max(edgeHigh, full[1]); }
    const drawn = clipLineParameters(line, region);
    if (drawn) { low = Math.min(low, drawn[0]); high = Math.max(high, drawn[1]); }
  }
  if (!(low <= high)) return null;
  const [from, to] = line.extent ?? [null, null];
  return { edge: [edgeLow, edgeHigh], ends: [
    { t: low, open: from === null || from < edgeLow, point: linePointAt(line, low) },
    { t: high, open: to === null || to > edgeHigh, point: linePointAt(line, high) },
  ] };
}

/** The three drawn kinds of a straight line. Stored only as `extent`; the kind is derived. */
export const LINE_KINDS = Object.freeze(['line', 'ray', 'segment']);
export const LINE_STYLES = Object.freeze(['solid', 'dashed']);
export function lineKindOf(line) {
  if (!isTrimmed(line)) return 'line';
  return line.extent.every(value => value !== null) ? 'segment' : 'ray';
}
/** Slope through two points: exactly null (vertical) when they share x, never a huge finite stand-in. */
export function slopeThrough(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) <= 1e-12 * Math.max(1, Math.abs(dy))) return null;
  const slope = dy / dx;
  return Object.is(slope, -0) ? 0 : slope;
}
/**
 * Geometry of a line drawn from `from` to `to`: anchored at the first point. A ray starts
 * there and runs through the second point; a segment ends at the second point.
 * Returns null for coincident points.
 */
export function lineFromPoints(from, to, kind = 'line') {
  if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_LINE_LENGTH) return null;
  const line = { anchor: { x: from.x === 0 ? 0 : from.x, y: from.y === 0 ? 0 : from.y }, slope: slopeThrough(from, to), extent: null };
  const t = lineParameter(line, to);
  if (kind === 'ray') line.extent = t > 0 ? [0, null] : [null, 0];
  else if (kind === 'segment') line.extent = normalizeExtent(t > 0 ? [0, t] : [t, 0]) ?? null;
  return line;
}
/**
 * The extent that shows an existing line as another kind. Ends the line already has are
 * kept; a missing end is placed inside the visible part (`edge` from visibleLineEnds), so
 * the change is visible and both ends stay draggable.
 */
export function extentForKind(line, kind, edge) {
  if (kind === 'line') return null;
  const [from, to] = line.extent ?? [null, null];
  if (kind === 'ray') {
    if (from !== null && to !== null) return [from, null];
    if (from !== null || to !== null) return [from, to];
    const middle = edge ? (edge[0] + edge[1]) / 2 : 0;
    return [middle, null];
  }
  if (!edge) return from !== null && to !== null ? [from, to] : undefined;
  // A new end goes halfway to the visible edge (a quarter view length if that edge is behind it).
  const [low, high] = edge, quarter = (high - low) / 4;
  const start = from ?? (to === null ? low + quarter : to > low ? (low + to) / 2 : to - quarter);
  const end = to ?? (from === null ? high - quarter : from < high ? (from + high) / 2 : from + quarter);
  return normalizeExtent([start, end]);
}
