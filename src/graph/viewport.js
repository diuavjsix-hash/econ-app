export const QUADRANT_MODES = {
  first: { label: '1사분면', quadrants: [1], origin: 'bottom-left' },
  upper: { label: '1·2사분면', quadrants: [1, 2], origin: 'bottom-center' },
  all: { label: '전체 사분면', quadrants: [1, 2, 3, 4], origin: 'center' },
};

export function createViewport(width, height, mode, { flipX = false, flipY = false } = {}) {
  const unit = Math.max(8, Math.min(56, width / 16, height / 11));
  const padding = 36;
  const plot = { left: padding, right: width - padding, top: padding, bottom: height - padding };
  const baseCx = mode === 'first' ? plot.left : width / 2;
  const baseCy = mode === 'all' ? height / 2 : plot.bottom;
  const cx = flipX ? width - baseCx : baseCx;
  const cy = flipY ? height - baseCy : baseCy;
  const xDirection = flipX ? -1 : 1, yDirection = flipY ? -1 : 1;
  return {
    width, height, unit, cx, cy, plot, xDirection, yDirection,
    bounds: { xMin: (plot.left - baseCx) / unit, xMax: (plot.right - baseCx) / unit, yMin: (baseCy - plot.bottom) / unit, yMax: (baseCy - plot.top) / unit },
  };
}

export function toScreen(point, viewport) {
  return { x: viewport.cx + point.x * viewport.unit * viewport.xDirection, y: viewport.cy - point.y * viewport.unit * viewport.yDirection };
}

export function toWorld(point, viewport) {
  return { x: (point.x - viewport.cx) / (viewport.unit * viewport.xDirection), y: (viewport.cy - point.y) / (viewport.unit * viewport.yDirection) };
}

/** Rebase the visible editing handle along the same line when its anchor is outside the view. */
export function visibleAnchor(line, points, bounds) {
  const { x, y } = line.anchor;
  if (x > bounds.xMin && x < bounds.xMax && y > bounds.yMin && y < bounds.yMax) return { x, y };
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}
