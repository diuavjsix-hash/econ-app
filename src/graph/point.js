import { faceToFace, stacked } from './viewport.js';

/**
 * Display rounding only; full precision stays in the stored anchor. On a face-to-face
 * sheet the facing graph (internal x < 0) reads its own x as positive; on a stacked sheet the
 * lower graph (internal y < 0) reads its own y from its origin at -lowerHeight.
 */
export function pointCoordinatesLabel(anchor, quadrantMode, lowerHeight = 0) {
  const format = (value) => String(Number(value.toFixed(2)));
  const x = faceToFace(quadrantMode) ? Math.abs(anchor.x) : anchor.x;
  const y = stacked(quadrantMode) && anchor.y < 0 ? anchor.y + lowerHeight : anchor.y;
  return `(${format(x)}, ${format(y)})`;
}
