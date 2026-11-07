import { onLineExtent } from './line-extent.js';
import { directionOf } from './math.js';
import { displayedCurveSegments } from './display.js';
import { sketchControls } from './sketch.js';
import { validPoint } from './ruler.js';
import { nearestQuadraticPoint, quadraticCoordinatePoints } from './snap.js';
import { canAttach } from '../relations.js';
import { snapCurveToTangency, TANGENT_CAPTURE_PX, TANGENT_RELEASE_PX } from './tangency.js';
import { isIndifference, indifferenceThroughPoint, indifferenceMoveDistance } from './indifference.js';
import { SHAPE_SNAP_POLICY } from './snap-policy.js';
import { snapCurveToCurveTangency } from './curve-curve-tangency.js';

/** Translate a whole line or curve through a visible, independent, existing point. */
export function snapShapeToPoint(shape,state,bounds,unit,{previous=null,reference=shape.anchor,altKey=false,axis=null}={}) {
  if (altKey || shape.binding || !['line','curve','sketch'].includes(shape.type) || !validPoint(shape.anchor) || !Number.isFinite(unit) || unit<=0) return null;
  const margin=TANGENT_RELEASE_PX/unit;
  const expanded={xMin:bounds.xMin-margin,xMax:bounds.xMax+margin,yMin:bounds.yMin-margin,yMax:bounds.yMax+margin};
  const pieces=isIndifference(shape)?[]:shape.type==='sketch'?sketchControls(shape):shape.type==='curve'?displayedCurveSegments(shape,expanded,{...state,axisGapEnabled:false}):[];
  const direction=shape.type==='line'?directionOf(shape.slope):null;
  const normal=direction?{x:-direction.y,y:direction.x}:null,candidates=[];
  for (const target of state.points??[]) {
    const point=target.anchor;
    if (!validPoint(point) || point.x<bounds.xMin || point.x>bounds.xMax || point.y<bounds.yMin || point.y>bounds.yMax || !canAttach(state,shape.id,target.id)) continue;
    const add=(delta,key)=>{
      const anchor={x:shape.anchor.x+delta.x,y:shape.anchor.y+delta.y};
      const distance=(isIndifference(shape)?indifferenceMoveDistance(shape,anchor):Math.hypot(delta.x,delta.y))*unit;
      if (!validPoint(anchor) || !Number.isFinite(distance) || distance>TANGENT_RELEASE_PX) return;
      if (shape.type==='line' && !onLineExtent({...shape,anchor},point,1e-7)) return; // Only the drawn part meets the point.
      candidates.push({key:`point:${target.id}:${key}`,kind:'point',label:'점 맞춤',sourceId:target.id,point:{...point},anchor,distance,
        pointerDistance:Math.hypot(point.x-reference.x,point.y-reference.y)*unit});
    };
    if (isIndifference(shape)) {
      const anchor=indifferenceThroughPoint(shape,point);
      if (anchor) add({x:anchor.x-shape.anchor.x,y:anchor.y-shape.anchor.y},'indifference');
    } else if (normal) {
      const offset=(point.x-shape.anchor.x)*normal.x+(point.y-shape.anchor.y)*normal.y;
      if (axis && Math.abs(normal[axis])<1e-12 && Math.abs(offset)>1e-9) continue;
      const correction=axis?(Math.abs(normal[axis])<1e-12?0:offset/normal[axis]):offset;
      add(axis?{x:axis==='x'?correction:0,y:axis==='y'?correction:0}:{x:normal.x*correction,y:normal.y*correction},'line');
    } else pieces.forEach((points,index)=>{
      const locked=axis==='x'?'y':'x';
      const matches=axis?quadraticCoordinatePoints(points,locked,point[locked]):null;
      const contacts=matches??[nearestQuadraticPoint(points,point)];
      contacts.forEach((contact,contactIndex)=>{
        if (!validPoint(contact)) return;
        add({x:axis==='y'?0:point.x-contact.x,y:axis==='x'?0:point.y-contact.y},`${index}:${contactIndex}`);
      });
    });
  }
  return SHAPE_SNAP_POLICY.choose(candidates,previous);
}

/** An explicit point can take over from a farther computed magnet; keep point capture stable. */
export function chooseShapeMagnet(candidates,previous) {
  const available=candidates.filter(Boolean);
  const captured=previous && available.find(candidate=>candidate.kind===previous.kind && candidate.key===previous.key);
  if (captured) {
    const point=available.find(candidate=>candidate.kind==='point' && candidate.distance<=TANGENT_CAPTURE_PX && candidate.distance<=captured.distance);
    return captured.kind!=='point' && point?point:captured;
  }
  return available.sort((a,b)=>a.distance-b.distance)[0]??null;
}

export function snapMovingCurve(curve,state,bounds,unit,options={}) {
  const point=snapShapeToPoint(curve,state,bounds,unit,{...options,previous:options.previous?.kind==='point'?options.previous:null});
  const tangent=snapCurveToTangency(curve,state,bounds,unit,{...options,previous:options.previous?.kind==='tangent'?options.previous:null});
  const curveTangent=snapCurveToCurveTangency(curve,state,bounds,unit,{...options,previous:options.previous?.key?.startsWith('curve-tangent:')?options.previous:null});
  return chooseShapeMagnet([point,tangent?{...tangent,kind:'tangent'}:null,curveTangent],options.previous);
}
