/** Display rounding only; full precision stays in the stored anchor. */
export function pointCoordinatesLabel(anchor) {
  const format = (value) => String(Number(value.toFixed(2)));
  return `(${format(anchor.x)}, ${format(anchor.y)})`;
}
