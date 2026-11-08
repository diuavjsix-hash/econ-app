import { guidedSnapCandidates, pointSnapCandidates } from './snap.js';
import { translateRuler } from './ruler.js';
import { SNAP_CAPTURE_PX, SNAP_RELEASE_PX, chooseSnapCandidate } from './snap-policy.js';

export const SEGMENT_CAPTURE_PX = SNAP_CAPTURE_PX;
export const SEGMENT_RELEASE_PX = SNAP_RELEASE_PX;
const visible = (point, bounds) => !bounds || (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax);

function candidates(point, targets, unit, { axis = null, guide = null, points = [], bounds } = {}) {
  if (!guide && !visible(point, bounds)) return [];
  const result = [...guidedSnapCandidates(point, targets, unit, axis, SEGMENT_RELEASE_PX, guide),
    ...pointSnapCandidates(point, points, unit, { axis, guide, bounds, radius: SEGMENT_RELEASE_PX })];
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

