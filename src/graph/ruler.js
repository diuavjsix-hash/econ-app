export const validPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function rulerMetrics(ruler) {
  const dx = ruler.end.x - ruler.anchor.x, dy = ruler.end.y - ruler.anchor.y;
  return { dx, dy, length: Math.hypot(dx, dy) };
}

export function constrainRuler(anchor, point, mode = 'free', shiftKey = false) {
  if (mode === 'horizontal') return { x: point.x, y: anchor.y };
  if (mode === 'vertical') return { x: anchor.x, y: point.y };
  if (shiftKey) return Math.abs(point.x - anchor.x) >= Math.abs(point.y - anchor.y)
    ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
  return { ...point };
}

/** Clip a finite segment; never extend it into an infinite line. */
export function clipSegment(start, end, bounds) {
  let low = 0, high = 1;
  for (const [axis, min, max] of [['x', bounds.xMin, bounds.xMax], ['y', bounds.yMin, bounds.yMax]]) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) { if (start[axis] < min || start[axis] > max) return null; continue; }
    const a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
    if (low > high) return null;
  }
  return [low, high].map(t => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }));
}

/** Keep the full segment inside the domain when moving, without changing its length. */
export function translateRuler(ruler, delta, bounds) {
  const limit = (value, min, max) => min <= max ? Math.max(min, Math.min(max, value)) : value;
  const dx = limit(delta.x, bounds.xMin - Math.min(ruler.anchor.x, ruler.end.x), bounds.xMax - Math.max(ruler.anchor.x, ruler.end.x));
  const dy = limit(delta.y, bounds.yMin - Math.min(ruler.anchor.y, ruler.end.y), bounds.yMax - Math.max(ruler.anchor.y, ruler.end.y));
  return { anchor: { x: ruler.anchor.x + dx, y: ruler.anchor.y + dy }, end: { x: ruler.end.x + dx, y: ruler.end.y + dy } };
}
