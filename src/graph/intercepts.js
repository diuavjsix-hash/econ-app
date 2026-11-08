import { onLineExtent, lineEndPoints } from './line-extent.js';
import { snapMovingEnds } from './segment-magnets.js';
import { independentSnapState } from './snap-context.js';
import { buildInterceptTargets } from './snap.js';
import { directionOf } from './math.js';
import { canAttach } from '../relations.js';
import { snapLineToTangency } from './tangency.js';
import { snapShapeToPoint, chooseShapeMagnet } from './point-magnets.js';
import { INTERCEPT_SNAP_POLICY } from './snap-policy.js';

function lineIntercept(line,axis,origin={x:0,y:0}) {
  const d=directionOf(line.slope);
  const x=line.anchor.x-origin.x,y=line.anchor.y-origin.y;
  const value=axis==='x'?(d.y===0?null:x-y*(d.x/d.y))
    :(d.x===0?null:y-x*(d.y/d.x));
  return Number.isFinite(value)?value:null;
}

/** Match another shape's intercept without changing slope or the axis locked by Shift. */
export function snapLineToIntercept(line,state,bounds,unit,{previous=null,altKey=false,axis=null}={}) {
  if (altKey || line.binding || !Number.isFinite(unit) || unit<=0) return null;
  const direction=directionOf(line.slope),normal={x:-direction.y,y:direction.x},candidates=[];
  const x=lineIntercept(line,'x'),y=lineIntercept(line,'y');
  for (const target of buildInterceptTargets(state,bounds,line.id)) {
    if (target.sourceId && (!canAttach(state,line.id,target.sourceId) || state.sums?.some(sum=>sum.id===target.sourceId && sum.sourceIds.includes(line.id)))) continue;
    const own=target.axis==='x'?x:target.axis==='y'?y:null;
    if (target.axis!=='origin' && own===null) continue;
    const interceptDistance=target.axis==='origin'?Math.min(...['x','y'].map(axis=>lineIntercept(line,axis,target.point)).filter(value=>value!==null).map(Math.abs))
      :Math.abs(own-target.point[target.axis]);
    const offset=(target.point.x-line.anchor.x)*normal.x+(target.point.y-line.anchor.y)*normal.y;
    if (axis && Math.abs(normal[axis])<1e-12 && Math.abs(offset)>1e-9) continue;
    const correction=axis?(Math.abs(normal[axis])<1e-12?0:offset/normal[axis]):offset;
    const anchor=axis?{...line.anchor,[axis]:line.anchor[axis]+correction}
      :{x:line.anchor.x+offset*normal.x,y:line.anchor.y+offset*normal.y};
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
    if (!onLineExtent({...line,anchor},target.point,1e-7)) continue; // A trimmed line meets the intercept on its drawn part.
    candidates.push({...target,key:`intercept:${target.sourceId??'axes'}:${target.axis}:${target.point.x}:${target.point.y}`,anchor,
      distance:Math.max(interceptDistance,Math.abs(correction))*unit,kind:'intercept'});
  }
  return INTERCEPT_SNAP_POLICY.choose(candidates,previous);
}

/**
 * A drawn end of a moving segment or ray meets a shared point target (crossing, intercept,
 * point, contact, another end, or a stroke). The line keeps its slope and length.
 * `targets` are the shared snap targets without this line and its dependents.
 */
export function snapLineEnds(line,state,bounds,unit,{targets=null,previous=null,altKey=false,axis=null}={}) {
  if (!targets || line.binding) return null;
  const ends=lineEndPoints(line);
  if (!ends.some(Boolean)) return null;
  const hit=snapMovingEnds(ends,targets,unit,{altKey,axis,bounds,previous,points:independentSnapState(state,line.id).points});
  return hit&&{...hit,anchor:{x:line.anchor.x+hit.delta.x,y:line.anchor.y+hit.delta.y}};
}

/** Keep a captured magnet stable, then choose the nearest eligible intercept, tangent, point or drawn end. */
export function snapMovingLine(line,state,bounds,unit,options={}) {
  const previous=options.previous,isEnd=previous?.key?.startsWith('line-end');
  const point=snapShapeToPoint(line,state,bounds,unit,{...options,previous:!isEnd&&previous?.kind==='point'?previous:null});
  const intercept=snapLineToIntercept(line,state,bounds,unit,{...options,previous:!isEnd&&previous?.kind==='intercept'?previous:null});
  const tangent=snapLineToTangency(line,state,bounds,unit,{...options,previous:!isEnd&&previous?.kind==='tangent'?previous:null});
  const end=snapLineEnds(line,state,bounds,unit,{...options,previous:isEnd?previous:null});
  return chooseShapeMagnet([point,intercept,tangent?{...tangent,kind:'tangent'}:null,end],previous);
}
