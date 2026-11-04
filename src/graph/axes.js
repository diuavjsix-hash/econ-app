/** Finite mathematical axes shared by snapping, feedback and enclosed-region painting. */
export function axisSegments(state, bounds) {
  const axes = [];
  if (bounds.yMin <= 0 && bounds.yMax >= 0) axes.push({ id: 'axis-x', points: [{ x: bounds.xMin, y: 0 }, { x: bounds.xMax, y: 0 }] });
  if (bounds.xMin <= 0 && bounds.xMax >= 0) axes.push({ id: 'axis-y', points: [{ x: 0, y: bounds.yMin }, { x: 0, y: bounds.yMax }] });
  if (state.quadrantMode === 'edgeworth') {
    const { width, height } = state.boxSize;
    axes.push({ id: 'axis-b-x', points: [{ x: 0, y: height }, { x: width, y: height }] },
      { id: 'axis-b-y', points: [{ x: width, y: 0 }, { x: width, y: height }] });
  }
  return axes;
}
