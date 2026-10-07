/** A null slope represents a vertical line; finite slopes have no application limit. */
export function normalizeSlope(value) {
  if (value === null || value === Infinity || value === -Infinity) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Object.is(number, -0) ? 0 : number;
}

export function slopeFromAngle(angle) {
  if (Math.abs(angle) >= 90) return null;
  return normalizeSlope(Number(Math.tan(angle * Math.PI / 180).toPrecision(12)));
}

export function angleFromSlope(slope) {
  return slope === null ? 90 : Math.atan(slope) * 180 / Math.PI;
}

export function directionOf(slope) {
  if (slope === null) return { x: 0, y: 1 };
  const length = Math.hypot(1, slope);
  return { x: 1 / length, y: slope / length };
}

export function interceptOf(line) {
  if (line.slope === null) return null;
  const intercept = line.anchor.y - line.slope * line.anchor.x;
  return Number.isFinite(intercept) ? (intercept === 0 ? 0 : intercept) : null;
}

export function formatNumber(value) {
  if (value === 0) return '0';
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) return value.toExponential(2).replace('-', '−');
  return String(Number(value.toPrecision(6))).replace('-', '−');
}

export function equation(slope, intercept = 0) {
  const coefficient = slope === 1 ? 'x' : slope === -1 ? '−x' : `${formatNumber(slope)}x`;
  const offset = Number(intercept.toPrecision(6));
  if (slope === 0) return `y = ${formatNumber(offset)}`;
  return `y = ${coefficient}${offset === 0 ? '' : ` ${offset < 0 ? '−' : '+'} ${formatNumber(Math.abs(offset))}`}`;
}

export function lineEquation(line) {
  if (line.slope === null) return `x = ${formatNumber(line.anchor.x)}`;
  const intercept = interceptOf(line);
  if (intercept !== null) return equation(line.slope, intercept);
  return `y − (${formatNumber(line.anchor.y)}) = ${formatNumber(line.slope)}(x − (${formatNumber(line.anchor.x)}))`;
}

/** Parametric rectangle clipping avoids slope division and handles true vertical lines. */
export function clipLine(line, bounds) {
  const direction = directionOf(line.slope);
  let start = -Infinity;
  let end = Infinity;
  for (const [axis, min, max] of [['x', bounds.xMin, bounds.xMax], ['y', bounds.yMin, bounds.yMax]]) {
    if (direction[axis] === 0) {
      if (line.anchor[axis] < min || line.anchor[axis] > max) return null;
      continue;
    }
    const t1 = (min - line.anchor[axis]) / direction[axis];
    const t2 = (max - line.anchor[axis]) / direction[axis];
    start = Math.max(start, Math.min(t1, t2));
    end = Math.min(end, Math.max(t1, t2));
    if (start > end) return null;
  }
  return [start, end].map((t) => ({
    x: Math.max(bounds.xMin, Math.min(bounds.xMax, line.anchor.x + t * direction.x)),
    y: Math.max(bounds.yMin, Math.min(bounds.yMax, line.anchor.y + t * direction.y)),
  }));
}

/** Retained for symmetric viewport callers. */
export function lineEndpoints(slope, halfWidth, halfHeight, intercept = 0) {
  return clipLine({ slope, anchor: { x: 0, y: intercept } }, { xMin: -halfWidth, xMax: halfWidth, yMin: -halfHeight, yMax: halfHeight });
}
