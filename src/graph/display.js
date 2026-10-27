import { clipLine } from './math.js';
import { clipCurveWithExtensions } from './curve.js';

export const DEFAULT_AXIS_GAP = 0.75;
export const MIN_AXIS_GAP = 0.25;
export const MAX_AXIS_GAP = 2;

/** Cut out mathematical bands around both axes, without modifying stored shapes. */
export function lineDisplayRegions(bounds, state) {
  if (!state.axisGapEnabled) return [bounds];
  const gap = state.axisGap ?? DEFAULT_AXIS_GAP;
  const intervals = (min, max) => [[min, Math.min(max, -gap)], [Math.max(min, gap), max]]
    .filter(([from, to]) => to > from);
  return intervals(bounds.xMin, bounds.xMax).flatMap(([xMin, xMax]) =>
    intervals(bounds.yMin, bounds.yMax).map(([yMin, yMax]) => ({ xMin, xMax, yMin, yMax })));
}

export function isLinePointVisible(point, bounds, state) {
  return lineDisplayRegions(bounds, state).some(({ xMin, xMax, yMin, yMax }) =>
    point.x >= xMin && point.x <= xMax && point.y >= yMin && point.y <= yMax);
}

export function displayedLineSegments(line, bounds, state) {
  return lineDisplayRegions(bounds, state).map((region) => clipLine(line, region)).filter(Boolean);
}

export function displayedCurveSegments(curve, bounds, state) {
  return lineDisplayRegions(bounds, state).flatMap((region) => clipCurveWithExtensions(curve, region))
    .sort((a, b) => a[0].x - b[0].x);
}

/** Place editing handles on one visible section, including when the anchor is hidden. */
export function lineEditingGeometry(line, segments) {
  if (!segments.length) return null;
  const distanceTo = ([a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((line.anchor.x - a.x) * dx + (line.anchor.y - a.y) * dy) / lengthSquared)) : 0;
    return Math.hypot(line.anchor.x - a.x - t * dx, line.anchor.y - a.y - t * dy);
  };
  const points = [...segments].sort((a, b) => distanceTo(a) - distanceTo(b))[0];
  const atEndpoint = points.some((point) => Math.hypot(point.x - line.anchor.x, point.y - line.anchor.y) < 1e-8);
  const anchor = distanceTo(points) < 1e-8 && !atEndpoint ? { ...line.anchor }
    : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  return { points, anchor };
}
