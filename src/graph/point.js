import { faceToFace, panelAt } from './viewport.js';

/**
 * Display rounding only; full precision stays in the stored anchor. On a face-to-face
 * sheet the facing graph (internal x < 0) reads its own x as positive; on a panel sheet
 * (상하 2단·3단, 2×2) each graph reads its coordinates from its own origin.
 * `sheet` carries the panel sizes ({ lowerHeight, leftWidth }) of the graph being labelled.
 */
export function pointCoordinatesLabel(anchor, quadrantMode, sheet = {}) {
  const format = (value) => String(Number(value.toFixed(2)));
  const origin = panelAt(anchor, { ...sheet, quadrantMode })?.origin ?? { x: 0, y: 0 };
  const x = faceToFace(quadrantMode) ? Math.abs(anchor.x) : anchor.x - origin.x;
  return `(${format(x)}, ${format(anchor.y - origin.y)})`;
}
