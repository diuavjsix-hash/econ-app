import { faceToFace } from './viewport.js';

/**
 * Display rounding only; full precision stays in the stored anchor. On a face-to-face
 * sheet the facing graph (internal x < 0) reads its own x as positive.
 */
export function pointCoordinatesLabel(anchor, quadrantMode) {
  const format = (value) => String(Number(value.toFixed(2)));
  const x = faceToFace(quadrantMode) ? Math.abs(anchor.x) : anchor.x;
  return `(${format(x)}, ${format(anchor.y)})`;
}
