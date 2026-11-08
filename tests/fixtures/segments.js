// Segment lines for tests: the same geometry the line tool stores for "선분".
import { lineFromPoints, lineEndPoints } from '../../src/graph/line-extent.js';
import { snapMovingEnds } from '../../src/graph/segment-magnets.js';

/** A plain line object from `a` to `b` (anchored at `a`), as a segment unless another kind is given. */
export function segmentLine(id, a, b, extra = {}, kind = 'segment') {
  return { id, type: 'line', name: id, color: '#7b879c', ...lineFromPoints(a, b, kind), ...extra };
}

/** [first point, second point] of a two-point line, in drawing order. */
export function segmentEnds(line) {
  const ends = lineEndPoints(line), anchor = line.anchor;
  const isAnchor = p => p && Math.hypot(p.x - anchor.x, p.y - anchor.y) < 1e-12;
  if (isAnchor(ends[0])) return [ends[0], ends[1]];
  if (isAnchor(ends[1])) return [ends[1], ends[0]];
  return ends;
}

/** Draw a segment with the store the way the line tool does; returns its id. */
export function drawSegment(store, a, b, { style = 'solid', kind = 'segment' } = {}) {
  store.setToolMode('line');
  return store.addLine(a, b, { kind, style });
}

/**
 * Whole-segment movement through the production end magnet (`snapMovingEnds`), reported as
 * `{ endpoint: 'anchor' | 'end', geometry: { anchor, end } }` for two-point assertions.
 */
export function snapMovingSegment(segment, targets, unit, options = {}) {
  const hit = snapMovingEnds([segment.anchor, segment.end], targets, unit, options);
  if (!hit) return null;
  const move = p => ({ x: p.x + hit.delta.x, y: p.y + hit.delta.y });
  return { ...hit, endpoint: hit.endIndex === 0 ? 'anchor' : 'end', geometry: { anchor: move(segment.anchor), end: move(segment.end) } };
}
