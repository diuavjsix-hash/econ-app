import { OBJECT_COLLECTIONS } from './models/object-types.js';
export { OBJECT_LABELS } from './models/object-types.js';
export function selectedIdsOf(state) {
  return state.selectedIds ?? (state.selectedId ? [state.selectedId] : []);
}
export function objectsOf(state) {
  const objects = OBJECT_COLLECTIONS.flatMap(collection => state[collection] ?? []);
  const order = new Map((state.objectOrder ?? []).map((id, index) => [id, index]));
  return objects.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
/** Every object nested under id, at any depth (a set's members). */
export function descendantsOf(state, id) {
  const objects = objectsOf(state), found = [], seen = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const object of objects) if (!seen.has(object.id) && seen.has(object.parentId)) { seen.add(object.id); found.push(object); changed = true; }
  }
  return found;
}
/** The outermost set (group) that contains id, or null when it belongs to none. */
export function outermostGroup(state, id) {
  const byId = new Map(objectsOf(state).map(object => [object.id, object])), seen = new Set();
  let top = null;
  for (let parent = byId.get(id)?.parentId ?? null; parent !== null && !seen.has(parent); parent = byId.get(parent)?.parentId ?? null) {
    seen.add(parent);
    if (byId.get(parent)?.type === 'group') top = byId.get(parent);
  }
  return top;
}
/**
 * A canvas click picks the whole outermost set. Once a member of that set is selected
 * (entered with a double-click), clicks pick members of the same set directly.
 */
export function canvasPick(state, id) {
  const top = outermostGroup(state, id);
  if (!top) return id;
  const current = state.selectedId;
  return current && current !== top.id && outermostGroup(state, current)?.id === top.id ? id : top.id;
}
/** Selected ids plus every member of a selected set: what the canvas highlights. */
export function selectionClosure(state) {
  const ids = new Set(selectedIdsOf(state));
  for (const id of [...ids]) for (const member of descendantsOf(state, id)) ids.add(member.id);
  return ids;
}
/**
 * The drawn shapes a color choice paints: each selected shape, and every shape inside a
 * selected set. Sets themselves have no drawn color.
 */
export function colorTargets(state) {
  const ids = selectionClosure(state);
  return objectsOf(state).filter(object => ids.has(object.id) && object.type !== 'group');
}
export function canReparent(objects, id, parentId) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  if (!byId.has(id) || (parentId !== null && !byId.has(parentId))) return false;
  const visited = new Set();
  for (let parent = parentId; parent !== null; parent = byId.get(parent)?.parentId ?? null) {
    if (parent === id || visited.has(parent)) return false;
    visited.add(parent);
  }
  return true;
}
