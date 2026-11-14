export const QUADRANT_MODES = {
  first: { label: '1사분면', quadrants: [1], origin: 'bottom-left' },
  upper: { label: '1·2사분면', quadrants: [1, 2], origin: 'bottom-center' },
  all: { label: '전체 사분면', quadrants: [1, 2, 3, 4], origin: 'center' },
  edgeworth: { label: '에지워드 상자', quadrants: [1], origin: 'bottom-left' },
  // Two graphs back to back on one sheet: a shared y axis, x read as positive on both sides.
  face: { label: '대면', quadrants: [1, 2], origin: 'bottom-center' },
  // Several graphs on one sheet with one scale. The upper-left origin is (0,0); rows step down by
  // lowerHeight and the right column starts at x = leftWidth (see PANEL_SHEETS).
  stacked: { label: '상하 2단', quadrants: [1, 4], origin: 'middle-left' },
  stacked3: { label: '상하 3단', quadrants: [1, 4], origin: 'middle-left' },
  grid: { label: '2×2', quadrants: [1, 4], origin: 'middle-left' },
};
/** Face-to-face sheets read internal x < 0 as the facing graph's positive x. */
export const faceToFace = mode => mode === 'face';

/**
 * Panel sheets: rows of graphs (top first), each row listing its graphs from left to right.
 * Every graph is a first-quadrant graph with its own origin and axes in one coordinate plane.
 */
export const PANEL_SHEETS = Object.freeze({
  stacked: [['upper'], ['lower']],
  stacked3: [['upper'], ['middle'], ['lower']],
  grid: [['upper', 'right'], ['lower', 'lower-right']],
});
/** Korean names of the graphs that are not the upper-left one, for axis labels and settings. */
export const PANEL_NAMES = Object.freeze({ upper: '', middle: '가운데', lower: '아래', right: '오른쪽', 'lower-right': '오른쪽 아래' });
export const panelSheet = mode => Object.hasOwn(PANEL_SHEETS, mode ?? '');
export const DEFAULT_LOWER_HEIGHT = 6, MIN_LOWER_HEIGHT = 2, MAX_LOWER_HEIGHT = 40;
export const DEFAULT_LEFT_WIDTH = 9, MIN_LEFT_WIDTH = 2, MAX_LEFT_WIDTH = 40;
/** A graph's axes end this far (math units) short of the next graph's axes. */
export const PANEL_GAP = 0.5;
const clampSize = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
/** Height of each graph below the top row. */
export const lowerHeightOf = state => clampSize(state?.lowerHeight, MIN_LOWER_HEIGHT, MAX_LOWER_HEIGHT, DEFAULT_LOWER_HEIGHT);
/** Width of the left column on a 2×2 sheet; the right column gets the rest of the view. */
export const leftWidthOf = state => clampSize(state?.leftWidth, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH, DEFAULT_LEFT_WIDTH);

/**
 * The graphs of a panel sheet with their origins and the far ends of their axes (xEnd/yEnd null:
 * to the edge of the view). Empty on any other format.
 */
export function sheetPanels(state) {
  const rows = PANEL_SHEETS[state?.quadrantMode];
  if (!rows) return [];
  const height = lowerHeightOf(state), width = leftWidthOf(state);
  return rows.flatMap((keys, row) => keys.map((key, column) => ({
    key, row, column, name: PANEL_NAMES[key],
    origin: { x: column * width, y: row === 0 ? 0 : -row * height },
    xEnd: column === keys.length - 1 ? null : (column + 1) * width - PANEL_GAP,
    yEnd: row === 0 ? null : -(row - 1) * height - PANEL_GAP,
    axisIds: key === 'upper' ? ['axis-x', 'axis-y'] : [`axis-${key}-x`, `axis-${key}-y`],
    label: key === 'upper' ? '원점' : `${PANEL_NAMES[key]} 원점`,
  })));
}
/** The graph a point belongs to: rows split at each x axis, columns at the right graph's y axis. */
export function panelAt(point, state) {
  const panels = sheetPanels(state);
  if (!panels.length) return null;
  const rows = PANEL_SHEETS[state.quadrantMode], height = lowerHeightOf(state), width = leftWidthOf(state);
  const row = point.y >= 0 ? 0 : Math.max(1, Math.min(rows.length - 1, Math.ceil(-point.y / height - 1e-9)));
  const column = Math.max(0, Math.min(rows[row].length - 1, Math.floor(point.x / width + 1e-9)));
  return panels.find(panel => panel.row === row && panel.column === column);
}

/** View zoom limits; within 3% of 1 it returns to exactly 1 so the default view is reachable. */
export const ZOOM_MIN = 0.2, ZOOM_MAX = 10;
export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  return Math.abs(Math.log(clamped)) < 0.03 ? 1 : clamped;
}
/** Mouse wheel → next zoom: one notch (100px) scales by about 1.16; the box format keeps its fit. */
export function wheelZoom(zoom, deltaY) { return clampZoom((zoom ?? 1) * Math.exp(-deltaY * 0.0015)); }
export const zoomable = mode => mode !== 'edgeworth' && !panelSheet(mode);

/** Grid spacing in math units: 1 near the default, coarser zoomed out, finer zoomed in. */
export function gridStep(unit) {
  if (unit < 8) return [2, 5, 10, 20, 50, 100].find(step => step * unit >= 8) ?? 100;
  if (unit > 120) return [0.1, 0.2, 0.5].find(step => step * unit >= 24) ?? 0.5;
  return 1;
}

export function createViewport(width, height, mode, { flipX = false, flipY = false, boxSize = { width: 10, height: 8 }, zoom = 1, lowerHeight, leftWidth } = {}) {
  if (panelSheet(mode)) {
    // Each lower row is lowerHeight tall and the left column leftWidth wide; the top row and the
    // right column get the rest of the view. No zoom.
    const rows = PANEL_SHEETS[mode], columns = rows[0].length, padding = 36;
    const depth = lowerHeightOf({ lowerHeight }), across = leftWidthOf({ leftWidth });
    const plot = { left: padding, right: width - padding, top: padding, bottom: height - padding };
    const unit = Math.max(0.5, Math.min(56, width / 16, (plot.bottom - plot.top) / (rows.length * depth),
      columns > 1 ? (plot.right - plot.left) / (columns * across) : Infinity));
    const baseCx = plot.left, baseCy = plot.bottom - (rows.length - 1) * depth * unit;
    const xDirection = flipX ? -1 : 1, yDirection = flipY ? -1 : 1;
    return { width, height, unit, plot, xDirection, yDirection, cx: flipX ? width - baseCx : baseCx, cy: flipY ? height - baseCy : baseCy,
      bounds: { xMin: 0, xMax: (plot.right - plot.left) / unit, yMin: -(rows.length - 1) * depth, yMax: (baseCy - plot.top) / unit } };
  }
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
