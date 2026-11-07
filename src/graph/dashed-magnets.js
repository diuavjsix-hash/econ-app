import { guidedSnapCandidates } from './snap.js';
import { translateRuler } from './ruler.js';
import { directionOf } from './math.js';
import { SNAP_CAPTURE_PX, SNAP_RELEASE_PX, chooseSnapCandidate } from './snap-policy.js';

export const DASHED_CAPTURE_PX = SNAP_CAPTURE_PX;
export const DASHED_RELEASE_PX = SNAP_RELEASE_PX;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const visible = (point, bounds) => !bounds || (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax);

function candidates(point, targets, unit, { axis = null, guide = null, points = [], bounds } = {}) {
  if (!guide && !visible(point, bounds)) return [];
  const result = guidedSnapCandidates(point, targets, unit, axis, DASHED_RELEASE_PX, guide);
  const locked = axis === 'x' ? 'y' : 'x', normal = guide && (d => ({ x: -d.y, y: d.x }))(directionOf(guide.slope));
  for (const target of points) {
    if (!visible(target.anchor, bounds) || (axis && Math.abs(target.anchor[locked] - point[locked]) > 1e-9)) continue;
    if (guide && Math.abs((target.anchor.x - guide.anchor.x) * normal.x + (target.anchor.y - guide.anchor.y) * normal.y) > 1e-9) continue;
    const aligned = axis ? { ...target.anchor, [locked]: point[locked] } : { ...target.anchor };
    const pixels = distance(point, aligned) * unit;
    if (pixels <= DASHED_RELEASE_PX) result.push({ point: aligned, kind: 'point', ids: [target.id], key: `point:${target.id}`, priority: 0, distance: pixels });
  }
  return result.filter(candidate => visible(candidate.point, bounds));
}

function choose(candidates, previous) {
  return chooseSnapCandidate(candidates,previous);
}

/** Drawing and endpoint editing share exact axis intersections and sticky targets. */
export function snapDashedPoint(point, targets, unit, options = {}) {
  if (options.altKey || options.enabled === false) return null;
  return choose(candidates(point, targets, unit, options), options.previous);
}

/** Translate both endpoints together; never stretch, rotate or break the Shift lock. */
export function snapMovingDashed(segment, targets, unit, options = {}) {
  if (options.altKey || options.enabled === false) return null;
  const choices = [];
  for (const endpoint of ['anchor', 'end']) for (const candidate of candidates(segment[endpoint], targets, unit, options)) {
    const delta = { x: candidate.point.x - segment[endpoint].x, y: candidate.point.y - segment[endpoint].y };
    const geometry = options.bounds ? translateRuler(segment, delta, options.bounds) : {
      anchor: { x: segment.anchor.x + delta.x, y: segment.anchor.y + delta.y },
      end: { x: segment.end.x + delta.x, y: segment.end.y + delta.y },
    };
    if (distance(geometry[endpoint], candidate.point) > 1e-9) continue;
    if (options.axis && Math.abs(geometry.anchor[options.axis === 'x' ? 'y' : 'x'] - segment.anchor[options.axis === 'x' ? 'y' : 'x']) > 1e-9) continue;
    choices.push({ ...candidate, key: `${endpoint}:${candidate.key}`, endpoint, geometry });
  }
  return choose(choices, options.previous);
}
