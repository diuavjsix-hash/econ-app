import { ROLE_COLORS } from '../models/palette.js';
import { displayedSketchSegments, sketchHandlePoints } from './sketch.js';
import { isLinePointVisible } from './display.js';
import { toScreen } from './viewport.js';
import { STROKE_RENDERER } from './svg-renderer.js';
const node=(...args)=>STROKE_RENDERER.element(...args);
export function drawSketch(curve, viewport, state, {selected=false, editable=false, clipId, preview=false, handlesOnly=false}={}) {
  const group=node('g',{class:handlesOnly?'sketch-handles':preview?'sketch-draft':'graph-sketch',style:`--line-color:${curve.color??ROLE_COLORS.sketch}`});
  const d=STROKE_RENDERER.pathData(displayedSketchSegments(curve,viewport.bounds,state),viewport);
  if (!handlesOnly) STROKE_RENDERER.append(group,curve,d,{selected,clipId,interactive:!preview});
  if (!selected || !editable || preview) return group;
  const points=sketchHandlePoints(curve), labels={start:'시작점',end:'끝점',middle:'가운데 점',tangent:'접선 방향',leftReach:'시작 쪽 휘어짐',rightReach:'끝 쪽 휘어짐'};
  for (const key of ['leftReach','rightReach','tangent']) {
    if (key==='tangent' && curve.binding) continue;
    const a=toScreen(curve.anchor,viewport),b=toScreen(points[key],viewport);
    group.append(node('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'sketch-guide','clip-path':`url(#${clipId})`}));
  }
  for (const key of ['leftReach','rightReach','tangent','start','end','middle']) {
    if ((key==='tangent' && curve.binding) || !isLinePointVisible(points[key],viewport.bounds,state)) continue;
    const p=toScreen(points[key],viewport);
    const handle=node('circle',{cx:p.x,cy:p.y,r:['start','end','middle'].includes(key)?6:4.5,class:'rotate-handle sketch-handle','data-id':curve.id,'data-action':`sketch-${key}`,tabindex:0,role:'button','aria-label':`${curve.name} ${labels[key]}`});
    handle.append(node('title',{},labels[key]));group.append(handle);
  }
  return group;
}
