import { buildInterceptTargets } from './snap.js';
import { directionOf } from './math.js';
import { canAttach } from '../relations.js';
import { snapLineToTangency, TANGENT_CAPTURE_PX, TANGENT_RELEASE_PX } from './tangency.js';
import { snapShapeToPoint, chooseShapeMagnet } from './point-magnets.js';

function lineIntercept(line,axis) {
  const d=directionOf(line.slope);
  const value=axis==='x'?(d.y===0?null:line.anchor.x-line.anchor.y*(d.x/d.y))
    :(d.x===0?null:line.anchor.y-line.anchor.x*(d.y/d.x));
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
    const interceptDistance=target.axis==='origin'?Math.min(...[x,y].filter(value=>value!==null).map(Math.abs))
      :Math.abs(own-target.point[target.axis]);
    const offset=(target.point.x-line.anchor.x)*normal.x+(target.point.y-line.anchor.y)*normal.y;
    if (axis && Math.abs(normal[axis])<1e-12 && Math.abs(offset)>1e-9) continue;
    const correction=axis?(Math.abs(normal[axis])<1e-12?0:offset/normal[axis]):offset;
    const anchor=axis?{...line.anchor,[axis]:line.anchor[axis]+correction}
      :{x:line.anchor.x+offset*normal.x,y:line.anchor.y+offset*normal.y};
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
    candidates.push({...target,key:`intercept:${target.sourceId??'axes'}:${target.axis}:${target.point.x}:${target.point.y}`,anchor,
      distance:Math.max(interceptDistance,Math.abs(correction))*unit,kind:'intercept'});
  }
  const retained=previous && candidates.find(candidate=>candidate.key===previous.key && candidate.distance<=TANGENT_RELEASE_PX);
  return retained || candidates.filter(candidate=>candidate.distance<=TANGENT_CAPTURE_PX).sort((a,b)=>a.distance-b.distance)[0] || null;
}

/** Keep a captured magnet stable, then choose the nearest eligible intercept or tangent. */
export function snapMovingLine(line,state,bounds,unit,options={}) {
  const previous=options.previous;
  const point=snapShapeToPoint(line,state,bounds,unit,{...options,previous:previous?.kind==='point'?previous:null});
  const intercept=snapLineToIntercept(line,state,bounds,unit,{...options,previous:previous?.kind==='intercept'?previous:null});
  const tangent=snapLineToTangency(line,state,bounds,unit,{...options,previous:previous?.kind==='tangent'?previous:null});
  return chooseShapeMagnet([point,intercept,tangent?{...tangent,kind:'tangent'}:null],previous);
}
