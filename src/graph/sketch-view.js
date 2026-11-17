import { ROLE_COLORS } from '../models/palette.js';
import { displayedSketchSegments, sketchHandlePoints } from './sketch.js';
import { isLinePointVisible } from './display.js';
import { toScreen } from './viewport.js';
import { STROKE_RENDERER } from './svg-renderer.js';
const node=(...args)=>STROKE_RENDERER.element(...args);
/** The inner point whose tangent and reach handles show: the focused through point, else the anchor. */
export function sketchFocusOf(curve, state) {
  const focus=state?.sketchFocus;
  return focus?.sketchId===curve.id && (curve.through ?? []).some(point=>`through:${point.id}`===focus.key) ? focus.key : 'anchor';
}
export function drawSketch(curve, viewport, state, {selected=false, editable=false, clipId, preview=false, handlesOnly=false}={}) {
  const group=node('g',{class:handlesOnly?'sketch-handles':preview?'sketch-draft':'graph-sketch',style:`--line-color:${curve.color??ROLE_COLORS.sketch}`});
  const d=STROKE_RENDERER.pathData(displayedSketchSegments(curve,viewport.bounds,state),viewport);
  if (!handlesOnly) STROKE_RENDERER.append(group,curve,d,{selected,clipId,interactive:!preview});
  if (!selected || !editable || preview) return group;
  const focus=sketchFocusOf(curve,state), points=sketchHandlePoints(curve,focus), suffix=focus==='anchor'?'':`:${focus.slice(8)}`;
  // A bound curve keeps the anchor's tangent along its line; through points stay free.
  const lockedTangent=focus==='anchor'&&curve.binding;
  const labels={start:'시작점',end:'끝점',middle:'가운데 점',tangent:'접선 방향',leftReach:'시작 쪽 휘어짐',rightReach:'끝 쪽 휘어짐',point:'지나는 점'};
  const handle=(point,action,label,large)=>{
    if (!isLinePointVisible(point,viewport.bounds,state)) return;
    const p=toScreen(point,viewport);
    const circle=node('circle',{cx:p.x,cy:p.y,r:large?6:4.5,class:'rotate-handle sketch-handle','data-id':curve.id,'data-action':action,tabindex:0,role:'button','aria-label':`${curve.name} ${label}`});
    circle.append(node('title',{},label));group.append(circle);
  };
  for (const key of ['leftReach','rightReach','tangent']) {
    if (key==='tangent' && lockedTangent) continue;
    const a=toScreen(points.center,viewport),b=toScreen(points[key],viewport);
    group.append(node('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'sketch-guide','clip-path':`url(#${clipId})`}));
  }
  for (const key of ['leftReach','rightReach','tangent']) if (!(key==='tangent' && lockedTangent)) handle(points[key],`sketch-${key}${suffix}`,labels[key],false);
  for (const key of ['start','end','middle']) handle(points[key],`sketch-${key}`,labels[key],true);
  (curve.through ?? []).forEach((point,index)=>handle(point.point,`sketch-point:${point.id}`,`${labels.point} ${index+1}`,true));
  return group;
}
