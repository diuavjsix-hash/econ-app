import { displayedLineSegments, displayedCurveSegments } from './display.js';
import { displayedSketchSegments } from './sketch.js';
import { displayedSumSegments } from './sum.js';
import { clipSegment } from './ruler.js';
import { toScreen } from './viewport.js';
import { pointCoordinatesLabel } from './point.js';

export const SNAP_MARKER = Object.freeze({ ring:11, core:5, free:9, gap:16, offset:28, padding:8 });
const NS='http://www.w3.org/2000/svg';
const node=(tag,attributes,text)=>{
  const element=document.createElementNS(NS,tag);
  for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
  if (text!==undefined) element.textContent=text;
  return element;
};

/** Adapters pass geometry results here; no tool creates its own marker or wording. */
export function snapFeedbackModel(candidate,{coordinates=false}={}) {
  if (!candidate?.point) return null;
  const kind=candidate.kind??'tangent';
  const ids=[...new Set([...(candidate.ids??[]),...(candidate.sourceId?[candidate.sourceId]:[])])];
  const label=candidate.label??(kind==='free'?'':kind==='tangent'?'접점 맞춤':kind==='kink'?'꺾임 맞춤':kind==='point'?'점 맞춤':kind==='intersection'?'교점 맞춤'
    :kind==='intercept'?(candidate.axis==='origin'?'원점':['x','y'].includes(candidate.axis)?`${candidate.axis}절편`:'절편 맞춤'):ids.some(id=>id.startsWith('axis-'))?'축 맞춤':'선 맞춤');
  return {point:candidate.point,kind,ids,label,text:[label,coordinates?pointCoordinatesLabel(candidate.point):''].filter(Boolean).join(' ')};
}

/** Same visible target geometry for every source of feedback, including flipped axes. */
export function snapFeedbackTargets(ids,state,viewport) {
  const selected=new Set(ids),targets=[],{bounds}=viewport;
  const path=(id,pieces,quadratic=false)=>{
    if (!pieces.length) return;
    const d=pieces.map(piece=>{
      const [a,b,c]=piece.map(p=>toScreen(p,viewport));
      return `M${a.x} ${a.y}${quadratic?`Q${b.x} ${b.y} ${c.x} ${c.y}`:`L${b.x} ${b.y}`}`;
    }).join(' ');
    targets.push({id,tag:'path',attributes:{d}});
  };
  for (const line of state.lines??[]) if (selected.has(line.id)) path(line.id,displayedLineSegments(line,bounds,state));
  for (const curve of state.curves??[]) if (selected.has(curve.id)) path(curve.id,displayedCurveSegments(curve,bounds,state),true);
  for (const curve of state.sketches??[]) if (selected.has(curve.id)) path(curve.id,displayedSketchSegments(curve,bounds,state));
  for (const sum of state.sums??[]) if (selected.has(sum.id)) path(sum.id,displayedSumSegments(sum,state,bounds));
  for (const dashed of state.dashedLines??[]) if (selected.has(dashed.id)) {
    const segment=clipSegment(dashed.anchor,dashed.end,bounds); if (segment) path(dashed.id,[segment]);
  }
  for (const point of state.points??[]) if (selected.has(point.id)) {
    const screen=toScreen(point.anchor,viewport);
    targets.push({id:point.id,tag:'circle',attributes:{cx:screen.x,cy:screen.y,r:9}});
  }
  if (selected.has('axis-x')&&bounds.yMin<=0&&bounds.yMax>=0) path('axis-x',[[{x:bounds.xMin,y:0},{x:bounds.xMax,y:0}]]);
  if (selected.has('axis-y')&&bounds.xMin<=0&&bounds.xMax>=0) path('axis-y',[[{x:0,y:bounds.yMin},{x:0,y:bounds.yMax}]]);
  return targets;
}

/** A single non-interactive overlay: source highlight, one marker, one bounded label. */
export function renderSnapFeedback(layer,candidate,{state,viewport,clipId,coordinates=false}={}) {
  layer.replaceChildren();
  const model=snapFeedbackModel(candidate,{coordinates});
  if (!model) return;
  const {x,y}=toScreen(model.point,viewport),{width,height}=viewport;
  const root=node('g',{class:'snap-feedback','data-snap-kind':model.kind,'pointer-events':'none','aria-hidden':'true'});
  if (model.kind!=='free') {
    const targets=node('g',{class:'snap-feedback-target','clip-path':`url(#${clipId})`});
    for (const target of snapFeedbackTargets(model.ids,state,viewport)) targets.append(node(target.tag,{...target.attributes,'data-snap-source':target.id}));
    root.append(targets);
  }
  const marker=node('g',{class:'snap-feedback-marker'});
  if (model.kind==='free') marker.append(node('circle',{cx:x,cy:y,r:SNAP_MARKER.free,class:'snap-feedback-free'}));
  else marker.append(node('circle',{cx:x,cy:y,r:SNAP_MARKER.ring,class:'snap-feedback-ring'}),node('circle',{cx:x,cy:y,r:SNAP_MARKER.core,class:'snap-feedback-core'}));
  root.append(marker);
  const text=node('text',{x:x+SNAP_MARKER.gap,y:y+SNAP_MARKER.offset,class:'snap-feedback-label'},model.text);
  root.append(text);layer.append(root);
  const available=Math.max(1,width-2*SNAP_MARKER.padding),length=text.getComputedTextLength();
  if (length>available) {text.setAttribute('textLength',available);text.setAttribute('lengthAdjust','spacingAndGlyphs');}
  text.setAttribute('x',Math.max(SNAP_MARKER.padding,Math.min(width-Math.min(length,available)-SNAP_MARKER.padding,x+SNAP_MARKER.gap)));
  text.setAttribute('y',Math.max(16,Math.min(height-SNAP_MARKER.padding,y+SNAP_MARKER.offset>height-SNAP_MARKER.padding?y-18:y+SNAP_MARKER.offset)));
}
