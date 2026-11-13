import { stacked, lowerHeightOf, LOWER_TOP } from './viewport.js';

/** Finite mathematical axes shared by snapping, feedback and enclosed-region painting. */
export function coordinateOrigins(state, bounds) {
  const origins = [{ point: { x: 0, y: 0 }, ids: ['axis-x', 'axis-y'], label: state.quadrantMode === 'edgeworth' ? 'A 원점' : '원점' }];
  const b = boxOrigin(state);
  if (b) origins.push({ point: b, ids: ['axis-b-x', 'axis-b-y'], label: 'B 원점' });
  const lower = lowerOrigin(state);
  if (lower) origins.push({ point: lower, ids: ['axis-lower-x', 'axis-lower-y'], label: '아래 원점' });
  return origins.filter(({ point: p }) => p.x >= bounds.xMin && p.x <= bounds.xMax && p.y >= bounds.yMin && p.y <= bounds.yMax);
}

export function axisSegments(state, bounds) {
  const axes = [];
  if (bounds.yMin <= 0 && bounds.yMax >= 0) axes.push({ id: 'axis-x', points: [{ x: bounds.xMin, y: 0 }, { x: bounds.xMax, y: 0 }] });
  // A stacked sheet has two y axes on x = 0: the upper one above y = 0, the lower one below.
  const upperFrom = stacked(state.quadrantMode) ? Math.max(0, bounds.yMin) : bounds.yMin;
  if (bounds.xMin <= 0 && bounds.xMax >= 0 && upperFrom < bounds.yMax) axes.push({ id: 'axis-y', points: [{ x: 0, y: upperFrom }, { x: 0, y: bounds.yMax }] });
  const lower = lowerOrigin(state);
  if (lower && lower.y >= bounds.yMin && bounds.xMin <= 0 && bounds.xMax >= 0) {
    axes.push({ id: 'axis-lower-x', points: [{ x: bounds.xMin, y: lower.y }, { x: bounds.xMax, y: lower.y }] },
      { id: 'axis-lower-y', points: [{ x: 0, y: lower.y }, { x: 0, y: Math.min(LOWER_TOP, bounds.yMax) }] });
  }
  if (state.quadrantMode === 'edgeworth') {
    const { width, height } = state.boxSize;
    axes.push({ id: 'axis-b-x', points: [{ x: 0, y: height }, { x: width, y: height }] },
      { id: 'axis-b-y', points: [{ x: width, y: 0 }, { x: width, y: height }] });
  }
  return axes;
}

/** The lower graph's origin on a stacked sheet; null on any other format. */
export const lowerOrigin = state => stacked(state.quadrantMode) ? { x: 0, y: -lowerHeightOf(state) } : null;
/** The B origin of an Edgeworth box; null on a plain graph. */
export const boxOrigin = state => state.quadrantMode === 'edgeworth' ? { x: state.boxSize.width, y: state.boxSize.height } : null;
const sameOrigin = (a, b) => Boolean(a && b) && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
/** An opposite curve at the box's B origin stays attached to it; elsewhere the origin is a handle. */
export const oppositeOriginEditable = (curve, state) => !sameOrigin(curve.oppositeOrigin, boxOrigin(state));
/** Opposite curves use the B origin in a box; on a plain graph the anchor stays where it was. */
export const defaultOppositeOrigin = (state, anchor) => boxOrigin(state) ?? { x: anchor.x * 2, y: anchor.y * 2 };
/** Keep B-origin curves attached when a box's totals change (one document edit). */
export function followBoxOrigin(document, previous) {
  const next = boxOrigin(document), before = { x: previous.width, y: previous.height };
  if (!next || sameOrigin(next, before)) return;
  for (const curve of document.curves ?? []) if (curve.orientation === 'opposite' && sameOrigin(curve.oppositeOrigin, before)) {
    curve.oppositeOrigin = { ...next };
    curve.anchor = { x: curve.anchor.x + next.x - before.x, y: curve.anchor.y + next.y - before.y };
  }
}
