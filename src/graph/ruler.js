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

/**
 * Shift lock of a two-point drawing: horizontal ({axis:'x'}), vertical ({axis:'y'}) or one of
 * the given tangents ({direction, ids}), whichever is nearest the anchor→pointer heading.
 * A tangent along an axis takes that axis's place so its curve stays the feedback source.
 */
export function directionLock(anchor, point, tangents = []) {
  const dx = point.x - anchor.x, dy = point.y - anchor.y, length = Math.hypot(dx, dy);
  const fallback = { axis: Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y' };
  if (!tangents.length || length < 1e-12) return fallback;
  const options = [{ axis: 'x', direction: { x: 1, y: 0 } }, { axis: 'y', direction: { x: 0, y: 1 } }];
  for (const tangent of tangents) {
    const same = options.findIndex(option => Math.abs(option.direction.x * tangent.direction.y - option.direction.y * tangent.direction.x) < 1e-9);
    const option = { direction: tangent.direction, ids: tangent.ids };
    if (same < 0) options.push(option); else if (options[same].axis) options[same] = option;
  }
  const alignment = option => Math.abs(option.direction.x * dx + option.direction.y * dy) / length;
  const best = options.reduce((chosen, option) => alignment(option) > alignment(chosen) + 1e-12 ? option : chosen);
  return best.axis ? { axis: best.axis } : best;
}

/** The pointer projected onto the line through anchor along direction, kept inside bounds. */
export function alongDirection(anchor, point, direction, bounds) {
  let t = (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y;
  if (bounds) for (const [axis, min, max] of [['x', bounds.xMin, bounds.xMax], ['y', bounds.yMin, bounds.yMax]]) {
    if (Math.abs(direction[axis]) < 1e-15) continue;
    const a = (min - anchor[axis]) / direction[axis], b = (max - anchor[axis]) / direction[axis];
    t = Math.max(Math.min(a, b), Math.min(Math.max(a, b), t));
  }
  return { x: direction.x === 0 ? anchor.x : anchor.x + t * direction.x, y: direction.y === 0 ? anchor.y : anchor.y + t * direction.y };
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
