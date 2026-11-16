import { OBJECT_COLLECTIONS, STROKE_GEOMETRY_COLLECTIONS } from '../models/object-types.js';
import { dependentIds } from '../relations.js';
import { descendantsOf } from '../objects.js';

const setMembers = (state, id) => (state.groups ?? []).some(group => group.id === id) ? descendantsOf(state, id) : [];

/** One source selection for every target builder, including exact/intercept paths. */
export function independentSnapState(state, excludeObjectId = null) {
  if (excludeObjectId === null) return state;
  const excluded = dependentIds(state, excludeObjectId);
  // A moving set carries all its members (and what follows them); they never snap to each other.
  for (const member of setMembers(state, excludeObjectId)) for (const id of dependentIds(state, member.id)) excluded.add(id);
  return { ...state, ...Object.fromEntries(OBJECT_COLLECTIONS.map(key =>
    [key, (state[key] ?? []).filter(object => !excluded.has(object.id))])) };
}

/** All mathematical geometry inputs; pointer/tool/selection state never belongs here. */
export function geometryKey(state, bounds) {
  return JSON.stringify([bounds, state.activeDiagramId, state.quadrantMode, state.boxSize,
    state.axisGapEnabled, state.axisGap, ...STROKE_GEOMETRY_COLLECTIONS.map(key => state[key])]);
}
