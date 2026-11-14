import { sheetPanels } from './viewport.js';

/** Finite mathematical axes shared by snapping, feedback and enclosed-region painting. */
export function coordinateOrigins(state, bounds) {
  const panels = sheetPanels(state);
  const origins = panels.length ? panels.map(panel => ({ point: { ...panel.origin }, ids: [...panel.axisIds], label: panel.label }))
    : [{ point: { x: 0, y: 0 }, ids: ['axis-x', 'axis-y'], label: state.quadrantMode === 'edgeworth' ? 'A 원점' : '원점' }];
  const b = boxOrigin(state);
  if (b) origins.push({ point: b, ids: ['axis-b-x', 'axis-b-y'], label: 'B 원점' });
  return origins.filter(({ point: p }) => p.x >= bounds.xMin && p.x <= bounds.xMax && p.y >= bounds.yMin && p.y <= bounds.yMax);
}

export function axisSegments(state, bounds) {
  const panels = sheetPanels(state);
  // A panel sheet: each graph's axes start at its origin and stop short of the next graph's axes.
  if (panels.length) return panels.flatMap(({ origin: o, xEnd, yEnd, axisIds: [xId, yId] }) => {
    const toX = Math.min(xEnd ?? bounds.xMax, bounds.xMax), toY = Math.min(yEnd ?? bounds.yMax, bounds.yMax), axes = [];
    if (o.y >= bounds.yMin && o.y <= bounds.yMax && o.x >= bounds.xMin && o.x < toX) axes.push({ id: xId, points: [{ x: o.x, y: o.y }, { x: toX, y: o.y }] });
    if (o.x >= bounds.xMin && o.x <= bounds.xMax && o.y >= bounds.yMin && o.y < toY) axes.push({ id: yId, points: [{ x: o.x, y: o.y }, { x: o.x, y: toY }] });
    return axes;
  });
  const axes = [];
  if (bounds.yMin <= 0 && bounds.yMax >= 0) axes.push({ id: 'axis-x', points: [{ x: bounds.xMin, y: 0 }, { x: bounds.xMax, y: 0 }] });
  if (bounds.xMin <= 0 && bounds.xMax >= 0) axes.push({ id: 'axis-y', points: [{ x: 0, y: bounds.yMin }, { x: 0, y: bounds.yMax }] });
  if (state.quadrantMode === 'edgeworth') {
    const { width, height } = state.boxSize;
    axes.push({ id: 'axis-b-x', points: [{ x: 0, y: height }, { x: width, y: height }] },
      { id: 'axis-b-y', points: [{ x: width, y: 0 }, { x: width, y: height }] });
  }
  return axes;
}

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
