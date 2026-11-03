/** Match dashed drawing: the larger displacement chooses horizontal or vertical. */
export function dragTranslation(anchor,start,pointer,shiftKey=false,bounds=null,margin=0) {
  const dx=pointer.x-start.x,dy=pointer.y-start.y;
  const axis=shiftKey?(Math.abs(dx)>=Math.abs(dy)?'x':'y'):null;
  const result={x:anchor.x+(axis==='y'?0:dx),y:anchor.y+(axis==='x'?0:dy)};
  if (bounds) for (const [key,min,max] of [['x',bounds.xMin,bounds.xMax],['y',bounds.yMin,bounds.yMax]]) {
    if (axis && axis!==key) continue;
    const low=min+margin,high=max-margin;
    result[key]=low<=high?Math.max(low,Math.min(high,result[key])):result[key];
  }
  return {anchor:result,axis};
}

/** A magnet may correct the active coordinate, never the coordinate locked by Shift. */
export function axisAlignedSnap(anchor,candidate,axis) {
  if (!axis) return candidate;
  const locked=axis==='x'?'y':'x';
  if (Math.abs(candidate[locked]-anchor[locked])>1e-9) return null;
  return {...candidate,[locked]:anchor[locked]};
}
