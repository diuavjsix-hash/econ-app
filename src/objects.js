export const OBJECT_LABELS = { line: '직선', curve: '곡선', point: '점', group: '폴더' };
export function objectsOf(state) {
  const objects = [...state.lines, ...state.curves, ...(state.points ?? []), ...(state.groups ?? [])];
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
