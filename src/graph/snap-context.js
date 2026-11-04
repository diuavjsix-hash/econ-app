import { OBJECT_COLLECTIONS } from '../models/object-types.js';
import { dependentIds } from '../relations.js';

/** One source selection for every target builder, including exact/intercept paths. */
export function independentSnapState(state, excludeObjectId = null) {
  if (excludeObjectId === null) return state;
  const excluded = dependentIds(state, excludeObjectId);
  return { ...state, ...Object.fromEntries(OBJECT_COLLECTIONS.map(key =>
    [key, (state[key] ?? []).filter(object => !excluded.has(object.id))])) };
}

/** All mathematical geometry inputs; pointer/tool/selection state never belongs here. */
export function geometryKey(state, bounds) {
  return JSON.stringify([bounds, state.activeDiagramId, state.quadrantMode, state.boxSize,
    state.axisGapEnabled, state.axisGap, state.lines, state.curves, state.sketches, state.sums, state.dashedLines]);
}
