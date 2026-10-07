export const QUADRANT_MODES = {
  first: { label: '1사분면', quadrants: [1], origin: 'bottom-left' },
  upper: { label: '1·2사분면', quadrants: [1, 2], origin: 'bottom-center' },
  all: { label: '전체 사분면', quadrants: [1, 2, 3, 4], origin: 'center' },
};

export function createViewport(width, height, mode) {
  const unit = Math.max(32, Math.min(56, width / 16, height / 11));
  const padding = 36;
  const plot = { left: padding, right: width - padding, top: padding, bottom: height - padding };
  const cx = mode === 'first' ? plot.left : width / 2;
  const cy = mode === 'all' ? height / 2 : plot.bottom;
  return {
    width, height, unit, cx, cy, plot,
    bounds: { xMin: (plot.left - cx) / unit, xMax: (plot.right - cx) / unit, yMin: (cy - plot.bottom) / unit, yMax: (cy - plot.top) / unit },
  };
}

/** Rebase the visible editing handle along the same line when its anchor is outside the view. */
export function visibleAnchor(line, points, bounds) {
  const { x, y } = line.anchor;
  if (x > bounds.xMin && x < bounds.xMax && y > bounds.yMin && y < bounds.yMax) return { x, y };
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}
