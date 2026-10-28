import { curvePoint } from './curve.js';
import { lineDisplayRegions } from './display.js';
import { clipSegment } from './ruler.js';

export const SUM_TOLERANCE = 0.001; // Mathematical units, shared by rendering and snapping.

export function sumSources(sum, state) {
  const byId = new Map([...state.lines, ...state.curves].map(source => [source.id, source]));
  return sum.sourceIds.map(id => byId.get(id));
}

export function sumError(sources, direction) {
  if (!['vertical', 'horizontal'].includes(direction)) return '합 방향을 선택해 주세요.';
  if (sources.length < 2 || sources.some(source => !source || !['line', 'curve'].includes(source.type))) return '직선·곡선을 두 개 이상 선택해 주세요.';
  if (direction === 'vertical' && sources.some(source => source.type === 'line' && source.slope === null)) return '수직선은 수직합에 사용할 수 없습니다. 수평합을 선택해 주세요.';
  if (direction === 'horizontal' && sources.some(source => source.type === 'line' && source.slope === 0)) return '수평선은 수평합에 사용할 수 없습니다. 수직합을 선택해 주세요.';
  return null;
}

/** Evaluate the existing quadratic core and its exact tangent continuations. */
export function sourceValue(source, input, direction) {
  if (source.type === 'line') return direction === 'vertical'
    ? source.anchor.y + source.slope * (input - source.anchor.x)
    : source.slope === null ? source.anchor.x : source.anchor.x + (input - source.anchor.y) / source.slope;
  const { anchor, span, slope, bend } = source;
  if (direction === 'vertical') {
    const t = (input - anchor.x) / span;
    if (Math.abs(t) <= 1) return anchor.y + span * (slope * t + bend * t * t);
    const edge = Math.sign(t), point = curvePoint(source, edge);
    return point.y + (slope + 2 * bend * edge) * (input - point.x);
  }
  const left = curvePoint(source, -1), right = curvePoint(source, 1);
  if ((input - left.y) * Math.sign(slope) < 0) return left.x + (input - left.y) / (slope - 2 * bend);
  if ((input - right.y) * Math.sign(slope) > 0) return right.x + (input - right.y) / (slope + 2 * bend);
  const delta = (input - anchor.y) / span;
  // Rationalized root chooses the monotone branch without cancellation near the anchor.
  const t = bend === 0 ? delta / slope : 2 * delta / (slope + Math.sign(slope) * Math.sqrt(Math.max(0, slope * slope + 4 * bend * delta)));
  return anchor.x + span * t;
}

export function sumValue(sum, state, input) {
  const sources = sumSources(sum, state);
  if (sumError(sources, sum.direction) || (sum.nonnegative && input < 0)) return null;
  let total = 0;
  for (const source of sources) {
    const value = sourceValue(source, input, sum.direction);
    if (!Number.isFinite(value)) return null;
    total += sum.nonnegative ? Math.max(0, value) : value;
  }
  return Number.isFinite(total) ? total : null;
}

/** Split at every core boundary and zero contribution so economic kinks stay exact. */
export function sumBreakpoints(sum, state, min, max) {
  const cuts = [min, max], dependent = sum.direction === 'vertical' ? 'x' : 'y';
  for (const source of sumSources(sum, state)) {
    if (source.type === 'curve') cuts.push(curvePoint(source, -1)[dependent], curvePoint(source, 1)[dependent]);
    if (sum.nonnegative) {
      const inverse = sum.direction === 'vertical' ? 'horizontal' : 'vertical';
      if (!(source.type === 'line' && (inverse === 'horizontal' ? source.slope === 0 : source.slope === null))) cuts.push(sourceValue(source, 0, inverse));
    }
  }
  return [...new Set(cuts.filter(value => Number.isFinite(value) && value >= min && value <= max))].sort((a, b) => a - b);
}

/** Adaptive display approximation only; the document stores source references, never pixels. */
export function displayedSumSegments(sum, state, bounds) {
  if (sumError(sumSources(sum, state), sum.direction)) return [];
  const vertical = sum.direction === 'vertical';
  const min = Math.max(vertical ? bounds.xMin : bounds.yMin, sum.nonnegative ? 0 : -Infinity);
  const max = vertical ? bounds.xMax : bounds.yMax;
  if (min >= max) return [];
  const pointAt = input => {
    const value = sumValue(sum, state, input);
    return value === null ? null : vertical ? { x: input, y: value } : { x: value, y: input };
  };
  const raw = [];
  function subdivide(a, b, depth = 0) {
    const start = pointAt(a), end = pointAt(b);
    if (!start || !end) return;
    let error = 0;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const point = pointAt(a + (b - a) * fraction);
      if (!point) return;
      error = Math.max(error, Math.hypot(point.x - start.x - fraction * (end.x - start.x), point.y - start.y - fraction * (end.y - start.y)));
    }
    if (error > SUM_TOLERANCE && depth < 14) {
      const middle = a + (b - a) / 2;
      subdivide(a, middle, depth + 1); subdivide(middle, b, depth + 1);
    } else raw.push([start, end]);
  }
  const cuts = sumBreakpoints(sum, state, min, max);
  for (let i = 1; i < cuts.length; i++) subdivide(cuts[i - 1], cuts[i]);
  return raw.flatMap(([a, b]) => lineDisplayRegions(bounds, state).map(region => clipSegment(a, b, region)).filter(segment => segment && Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y) > 1e-10));
}
