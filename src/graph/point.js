/** Display rounding only; full precision stays in the stored anchor. */
export function pointCoordinatesLabel(anchor) {
  const format = (value) => String(Number(value.toFixed(2)));
  return `(${format(anchor.x)}, ${format(anchor.y)})`;
}

/** Axis projections or full-domain guides, clipped as finite mathematical segments. */
export function pointGuides(point, bounds) {
  const { x, y } = point.anchor;
  const result = [];
  const full = point.guides.extent === 'full';
  if (point.guides.horizontal !== 'none' && y >= bounds.yMin && y <= bounds.yMax) {
    const from = full ? bounds.xMin : Math.max(bounds.xMin, Math.min(0, x));
    const to = full ? bounds.xMax : Math.min(bounds.xMax, Math.max(0, x));
    if (from < to) result.push({ axis: 'horizontal', style: point.guides.horizontal, start: { x: from, y }, end: { x: to, y } });
  }
  if (point.guides.vertical !== 'none' && x >= bounds.xMin && x <= bounds.xMax) {
    const from = full ? bounds.yMin : Math.max(bounds.yMin, Math.min(0, y));
    const to = full ? bounds.yMax : Math.min(bounds.yMax, Math.max(0, y));
    if (from < to) result.push({ axis: 'vertical', style: point.guides.vertical, start: { x, y: from }, end: { x, y: to } });
  }
  return result;
}
