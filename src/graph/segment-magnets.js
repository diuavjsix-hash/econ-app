import { guidedSnapCandidates } from './snap.js';
import { translateRuler } from './ruler.js';
import { directionOf } from './math.js';
import { SNAP_CAPTURE_PX, SNAP_RELEASE_PX, chooseSnapCandidate } from './snap-policy.js';

export const SEGMENT_CAPTURE_PX = SNAP_CAPTURE_PX;
export const SEGMENT_RELEASE_PX = SNAP_RELEASE_PX;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const visible = (point, bounds) => !bounds || (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax);

function candidates(point, targets, unit, { axis = null, guide = null, points = [], bounds } = {}) {
  if (!guide && !visible(point, bounds)) return [];
  const result = guidedSnapCandidates(point, targets, unit, axis, SEGMENT_RELEASE_PX, guide);
  const locked = axis === 'x' ? 'y' : 'x', normal = guide && (d => ({ x: -d.y, y: d.x }))(directionOf(guide.slope));
  for (const target of points) {
    if (!visible(target.anchor, bounds) || (axis && Math.abs(target.anchor[locked] - point[locked]) > 1e-9)) continue;
    if (guide && Math.abs((target.anchor.x - guide.anchor.x) * normal.x + (target.anchor.y - guide.anchor.y) * normal.y) > 1e-9) continue;
    const aligned = axis ? { ...target.anchor, [locked]: point[locked] } : { ...target.anchor };
    const pixels = distance(point, aligned) * unit;
    if (pixels <= SEGMENT_RELEASE_PX) result.push({ point: aligned, kind: 'point', ids: [target.id], key: `point:${target.id}`, priority: 0, distance: pixels });
  }
  return result.filter(candidate => visible(candidate.point, bounds));
}

function choose(candidates, previous) {
  return chooseSnapCandidate(candidates,previous);
}

/** Drawing and endpoint editing share exact axis intersections and sticky targets. */
export function snapSegmentPoint(point, targets, unit, options = {}) {
  if (options.altKey || options.enabled === false) return null;
  return choose(candidates(point, targets, unit, options), options.previous);
}

/**
 * Translate a shape so one of its drawn ends lands on a shared target (trimmed line ends).
 * Returns the chosen candidate with `endIndex` and the translation `delta`; Shift keeps the locked axis.
 */
export function snapMovingEnds(ends, targets, unit, options = {}) {
  if (options.altKey || options.enabled === false) return null;
  const choices = [], locked = options.axis === 'x' ? 'y' : 'x';
  ends.forEach((end, index) => {
    if (!end) return;
    for (const candidate of candidates(end, targets, unit, { ...options, guide: null })) {
      const delta = { x: candidate.point.x - end.x, y: candidate.point.y - end.y };
      if (options.axis && Math.abs(delta[locked]) > 1e-9) continue;
      choices.push({ ...candidate, key: `line-end${index}:${candidate.key}`, endIndex: index, delta });
    }
  });
  return choose(choices, options.previous);
}

