// Positions and directions belong to the document, never to screen pixels.
const slot = (row, column, flipX = false, flipY = false) => ({ row, column, flipX, flipY });
export const LAYOUTS = {
  single: { label: '그래프 1개', slots: [slot(0, 0)] },
  horizontal2: { label: '가로 2개', slots: [slot(0, 0), slot(0, 1)] },
  horizontal3: { label: '가로 3개', slots: [slot(0, 0), slot(0, 1), slot(0, 2)] },
  vertical2: { label: '세로 2개', slots: [slot(0, 0), slot(1, 0)] },
  vertical3: { label: '세로 3개', slots: [slot(0, 0), slot(1, 0), slot(2, 0)] },
  corner3: { label: 'ㄴ자 3개', slots: [slot(0, 0), slot(1, 0), slot(1, 1)] },
  face2: { label: '좌우 대면', slots: [slot(0, 0, true), slot(0, 1)] },
  faceVertical2: { label: '상하 대면', slots: [slot(0, 0), slot(1, 0, false, true)] },
  grid4: { label: '격자 4개', slots: [slot(0, 0), slot(0, 1), slot(1, 0), slot(1, 1)] },
};

export function normalizeSlots(slots) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 9) return null;
  const seen = new Set();
  for (const item of slots) {
    if (!item || !Number.isInteger(item.row) || !Number.isInteger(item.column) || item.row < 0 || item.row > 2 || item.column < 0 || item.column > 2) return null;
    const key = `${item.row}:${item.column}`;
    if (seen.has(key)) return null;
    seen.add(key);
  }
  const minRow = Math.min(...slots.map(s => s.row)), minColumn = Math.min(...slots.map(s => s.column));
  return slots.map(s => slot(s.row - minRow, s.column - minColumn, Boolean(s.flipX), Boolean(s.flipY)));
}
