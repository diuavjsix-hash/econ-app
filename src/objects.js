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
