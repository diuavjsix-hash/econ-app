export const QUADRANT_MODES = {
  first: { label: '1사분면', quadrants: [1], origin: 'bottom-left' },
  upper: { label: '1·2사분면', quadrants: [1, 2], origin: 'bottom-center' },
  all: { label: '전체 사분면', quadrants: [1, 2, 3, 4], origin: 'center' },
  edgeworth: { label: '에지워드 상자', quadrants: [1], origin: 'bottom-left' },
};

/** View zoom limits; within 3% of 1 it returns to exactly 1 so the default view is reachable. */
export const ZOOM_MIN = 0.2, ZOOM_MAX = 10;
export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  return Math.abs(Math.log(clamped)) < 0.03 ? 1 : clamped;
}
/** Mouse wheel → next zoom: one notch (100px) scales by about 1.16; the box format keeps its fit. */
export function wheelZoom(zoom, deltaY) { return clampZoom((zoom ?? 1) * Math.exp(-deltaY * 0.0015)); }
export const zoomable = mode => mode !== 'edgeworth';

/** Grid spacing in math units: 1 near the default, coarser zoomed out, finer zoomed in. */
export function gridStep(unit) {
  if (unit < 8) return [2, 5, 10, 20, 50, 100].find(step => step * unit >= 8) ?? 100;
  if (unit > 120) return [0.1, 0.2, 0.5].find(step => step * unit >= 24) ?? 0.5;
  return 1;
}

export function createViewport(width, height, mode, { flipX = false, flipY = false, boxSize = { width: 10, height: 8 }, zoom = 1 } = {}) {
  if (mode==='edgeworth') {
    const unit=Math.max(0.01,Math.min((width-96)/boxSize.width,(height-96)/boxSize.height));
    const left=(width-boxSize.width*unit)/2,top=(height-boxSize.height*unit)/2;
    const plot={left,right:width-left,top,bottom:height-top};
    return {width,height,unit,plot,cx:flipX?plot.right:plot.left,cy:flipY?plot.top:plot.bottom,
      xDirection:flipX?-1:1,yDirection:flipY?-1:1,bounds:{xMin:0,xMax:boxSize.width,yMin:0,yMax:boxSize.height}};
  }
  // Zoom scales about the fixed origin, so the axes and the visible quadrants stay put.
  const unit = Math.max(8, Math.min(56, width / 16, height / 11)) * clampZoom(zoom);
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
  const world = { x: (point.x - viewport.cx) / (viewport.unit * viewport.xDirection), y: (viewport.cy - point.y) / (viewport.unit * viewport.yDirection) };
  for (const key of ['x','y']) for (const limit of [viewport.bounds[`${key}Min`],viewport.bounds[`${key}Max`]]) {
    if (Math.abs(world[key]-limit) < 1e-10) world[key]=limit;
  }
  return world;
}

/** Rebase the visible editing handle along the same line when its anchor is outside the view. */
export function visibleAnchor(line, points, bounds) {
  const { x, y } = line.anchor;
  if (x > bounds.xMin && x < bounds.xMax && y > bounds.yMin && y < bounds.yMax) return { x, y };
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}
