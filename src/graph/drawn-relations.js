import { buildSnapTargets, guidedSnapCandidates } from './snap.js';
import { curveTangentsAt } from './curve-contacts.js';
import { lineEndPoints } from './line-extent.js';
import { directionOf } from './math.js';
import { sumValue } from './sum.js';
import { PANEL_SHEETS, panelSheet, lowerHeightOf, leftWidthOf } from './viewport.js';

/**
 * Relations a reader of the exported JSON cannot see from coordinates alone: which strokes
 * and axes pass through a placed point or a drawn end, and which of them touch there with the
 * same direction (a contact). They are recomputed from the current geometry on every export,
 * so a relation made with a magnet and later broken by moving a shape is not reported.
 * Nothing here is stored in the document or creates a following relation.
 */

// Exact magnet results sit within ~1e-9; a curve/curve crossing found on display chords sits
// within the chords' 0.001 flatness. Hand placement is never this close at any zoom.
export const ON_TOLERANCE = 2e-3;
// |sin| of the angle between two directions; ≈0.06°. A crossing this shallow reads as a contact.
export const TANGENT_TOLERANCE = 1e-3;
// Every axis id: the plain axes, Edgeworth B's, and each panel graph's (axis-lower-x, axis-right-y, …).
const STRAIGHT_AXES = Object.fromEntries(['', '-b', ...[...new Set(Object.values(PANEL_SHEETS).flat(2))].filter(key => key !== 'upper').map(key => `-${key}`)]
  .flatMap(key => [[`axis${key}-x`, { x: 1, y: 0 }], [`axis${key}-y`, { x: 0, y: 1 }]]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const finite = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/** A view-independent area that holds every drawn coordinate, restricted to the format's quadrants. */
export function documentBounds(state) {
  if (state.quadrantMode === 'edgeworth') return { xMin: 0, xMax: state.boxSize.width, yMin: 0, yMax: state.boxSize.height };
  let reach = 10;
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (finite(value)) reach = Math.max(reach, Math.abs(value.x), Math.abs(value.y));
      Object.values(value).forEach(visit);
    }
  };
  for (const key of ['lines', 'curves', 'sketches', 'points', 'fills']) visit(state[key]);
  const r = reach * 1.5 + 10;
  if (panelSheet(state.quadrantMode)) {
    const rows = PANEL_SHEETS[state.quadrantMode];
    return { xMin: 0, xMax: (rows[0].length - 1) * leftWidthOf(state) + r, yMin: -(rows.length - 1) * lowerHeightOf(state), yMax: r };
  }
  return { xMin: state.quadrantMode === 'first' ? 0 : -r, xMax: r, yMin: state.quadrantMode === 'all' ? -r : 0, yMax: r };
}

/**
 * A sum is y(x) (vertical) or x(y) (horizontal) evaluated from its sources. Its direction is the
 * derivative there; where the two one-sided derivatives differ (a source starts or stops) it is a
 * corner with no single direction, like a kink.
 */
function sumDirectionAt(sum, point, state) {
  const vertical = sum.direction === 'vertical', input = vertical ? point.x : point.y, h = 1e-6 * Math.max(1, Math.abs(input));
  const value = t => sumValue(sum, state, t), middle = value(input), before = value(input - h), after = value(input + h);
  if (middle === null) return null;
  const left = before === null ? null : (middle - before) / h, right = after === null ? null : (after - middle) / h;
  if (left === null && right === null) return null;
  if (left !== null && right !== null && Math.abs(left - right) > 1e-4 * Math.max(1, Math.abs(left), Math.abs(right))) return null;
  const derivative = left === null ? right : right === null ? left : (left + right) / 2;
  const d = vertical ? { x: 1, y: derivative } : { x: derivative, y: 1 }, length = Math.hypot(d.x, d.y);
  return { direction: { x: d.x / length, y: d.y / length }, straight: false };
}

function directionAt(id, point, state, bounds) {
  if (STRAIGHT_AXES[id]) return { direction: STRAIGHT_AXES[id], straight: true };
  const line = state.lines.find(line => line.id === id);
  if (line) return { direction: directionOf(line.slope), straight: true };
  const sum = (state.sums ?? []).find(sum => sum.id === id);
  if (sum) return sumDirectionAt(sum, point, state);
  const [found] = curveTangentsAt(state, bounds, point, [id], ON_TOLERANCE);
  return found ? { direction: found.direction, straight: false } : null;
}

const slopeOf = d => Math.abs(d.x) < 1e-12 ? null : d.y / d.x;

/** Pairs through `point` that share a direction there (at least one of them curved), and each curve's slope there. */
function contactsAt(ids, point, state, bounds) {
  const directions = ids.map(id => [id, directionAt(id, point, state, bounds)]).filter(([, d]) => d);
  const pairs = [], slopes = {};
  for (const [id, d] of directions) if (!d.straight) slopes[id] = slopeOf(d.direction);
  for (let i = 0; i < directions.length; i++) for (let j = i + 1; j < directions.length; j++) {
    const [a, da] = directions[i], [b, db] = directions[j];
    if (da.straight && db.straight) continue; // Parallel straight strokes through one point coincide.
    if (Math.abs(cross(da.direction, db.direction)) <= TANGENT_TOLERANCE) pairs.push([a, b]);
  }
  return { pairs, slopes };
}

/** Every location worth reporting, with what passes through it. One diagram at a time. */
export function describeRelations(state) {
  const bounds = documentBounds(state), targets = buildSnapTargets(state, bounds);
  const ends = [];
  for (const line of state.lines) lineEndPoints(line).forEach((end, i) => { if (end) ends.push({ point: end, object: line.id, kind: i ? 'end' : 'start' }); });
  for (const sketch of state.sketches ?? []) {
    ends.push({ point: sketch.start, object: sketch.id, kind: 'start' }, { point: sketch.end, object: sketch.id, kind: 'end' });
  }
  const locations = [
    ...(state.points ?? []).map(point => ({ point: point.anchor, marker: true })),
    ...ends.map(({ point }) => ({ point })),
    ...targets.crossings.filter(c => c.kind !== 'endpoint').map(({ point }) => ({ point, crossingOnly: true })),
  ].filter(({ point }) => finite(point));

  const entries = [];
  for (const { point, marker, crossingOnly } of locations) {
    if (entries.some(entry => distance(entry.at, point) <= ON_TOLERANCE)) continue;
    const on = new Set(), features = [];
    for (const candidate of guidedSnapCandidates(point, targets, 1, null, ON_TOLERANCE)) {
      for (const id of candidate.ids ?? []) on.add(id);
      if (candidate.kind === 'kink' || candidate.kind === 'minimum') {
        if (!features.some(f => f.object === candidate.ids[0] && f.kind === candidate.kind)) features.push({ object: candidate.ids[0], kind: candidate.kind });
      }
    }
    for (const end of ends) if (distance(end.point, point) <= ON_TOLERANCE) { on.add(end.object); features.push({ object: end.object, kind: end.kind }); }
    const points = (state.points ?? []).filter(p => distance(p.anchor, point) <= ON_TOLERANCE).map(p => p.id);
    const ids = [...on], { pairs: tangent, slopes } = contactsAt(ids, point, state, bounds);
    // Bare crossings are implied by the equations; report them only when they are contacts.
    if (crossingOnly && !tangent.length) continue;
    if (!(ids.length >= 2 || (marker && ids.length >= 1))) continue;
    entries.push({ at: { ...point }, ...(points.length ? { points } : {}), on: ids,
      ...(tangent.length ? { tangent } : {}), ...(Object.keys(slopes).length ? { slopes } : {}), ...(features.length ? { features } : {}) });
  }
  return entries;
}
