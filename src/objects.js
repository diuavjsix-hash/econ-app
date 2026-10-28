export const OBJECT_LABELS = { line: '직선', curve: '곡선', sketch: '자유 곡선', sum: '합', point: '점', dashed: '점선', ruler: '자', group: '폴더' };
export function objectsOf(state) {
  const objects = [...state.lines, ...state.curves, ...(state.sketches ?? []), ...(state.sums ?? []), ...(state.points ?? []), ...(state.dashedLines ?? []), ...(state.rulers ?? []), ...(state.groups ?? [])];
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
