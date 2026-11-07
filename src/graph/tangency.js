import { onLineExtent } from './line-extent.js';
import { directionOf } from './math.js';
import { displayedCurveSegments, isLinePointVisible, lineDisplayRegions } from './display.js';
import { sketchControls, quadraticPoint } from './sketch.js';
import { clipSegment, validPoint } from './ruler.js';
import { canAttach } from '../relations.js';
import { isIndifference, indifferenceContact, indifferenceOnLine, indifferenceMoveDistance } from './indifference.js';
import { SNAP_CAPTURE_PX, SNAP_RELEASE_PX, SHAPE_SNAP_POLICY } from './snap-policy.js';

export const TANGENT_CAPTURE_PX = SNAP_CAPTURE_PX;
export const TANGENT_RELEASE_PX = SNAP_RELEASE_PX;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

// A straight quadratic can reverse direction. Include its extremum before clipping.
function straightContacts(points, reference, direction, bounds, state) {
  const [a,b,c] = points, axis = Math.abs(direction.x) >= Math.abs(direction.y) ? 'x' : 'y';
  const denominator = a[axis] - 2*b[axis] + c[axis];
  const t = denominator ? (a[axis] - b[axis]) / denominator : -1;
  const extremes = [a,c];
  if (t > 0 && t < 1) extremes.push(quadraticPoint(points,t));
  extremes.sort((p,q) => p[axis] - q[axis]);
  return (bounds?lineDisplayRegions(bounds,state):[null]).flatMap(region => {
    const segment = region?clipSegment(extremes[0],extremes.at(-1),region):[extremes[0],extremes.at(-1)];
    if (!segment) return [];
    const [start,end] = segment, delta = subtract(end,start), length = delta.x**2 + delta.y**2;
    if (length < 1e-18) return [];
    const fraction = Math.max(0,Math.min(1,((reference.x-start.x)*delta.x+(reference.y-start.y)*delta.y)/length));
    return [{x:start.x+fraction*delta.x,y:start.y+fraction*delta.y}];
  });
}

/** Exact tangency on quadratic pieces, including horizontal and true vertical lines. */
function contacts(points, direction, reference, bounds, state) {
  const [a,b,c] = points, start = subtract(b,a), end = subtract(c,b);
  const scale = Math.max(Math.hypot(start.x,start.y),Math.hypot(end.x,end.y));
  if (!Number.isFinite(scale) || scale < 1e-12) return [];
  const from = cross(start,direction)/scale, to = cross(end,direction)/scale;
  if (Math.abs(from) < 1e-12 && Math.abs(to) < 1e-12) return straightContacts(points,reference,direction,bounds,state);
  if (Math.abs(to-from) < 1e-12) return [];
  const root = -from/(to-from);
  if (root < -1e-10 || root > 1+1e-10) return [];
  const t = Math.max(0,Math.min(1,root));
  const derivative = {x:(1-t)*start.x+t*end.x,y:(1-t)*start.y+t*end.y};
  if (Math.hypot(derivative.x,derivative.y)/scale < 1e-12) return [];
  const point = quadraticPoint(points,t);
  return validPoint(point) && (!bounds || isLinePointVisible(point,bounds,state)) ? [point] : [];
}

function normalTranslation(offset,normal,axis) {
  if (axis && Math.abs(normal[axis])<1e-12 && Math.abs(offset)>1e-9) return null;
  const correction=axis?(Math.abs(normal[axis])<1e-12?0:offset/normal[axis]):offset;
  const delta=axis?{x:axis==='x'?correction:0,y:axis==='y'?correction:0}
    :{x:correction*normal.x,y:correction*normal.y};
  return validPoint(delta)?{delta,distance:Math.abs(correction)}:null;
}
function chooseCandidate(candidates,previous) {
  return SHAPE_SNAP_POLICY.choose(candidates,previous);
}

/** Translate only. The raw pointer-derived anchor, never the last snapped anchor, drives release. */
export function snapLineToTangency(line, state, bounds, unit, { previous = null, reference = line.anchor, altKey = false, axis = null } = {}) {
  if (altKey || line.binding || !validPoint(line.anchor) || !Number.isFinite(unit) || unit <= 0) return null;
  const direction = directionOf(line.slope), normal = {x:-direction.y,y:direction.x};
  const candidates = [];
  for (const curve of [...state.curves,...(state.sketches ?? [])]) {
    // A curve that follows this line cannot be a stationary magnet for the same line.
    if (!canAttach(state,line.id,curve.id)) continue;
    if (isIndifference(curve)) {
      const point=indifferenceContact(curve,line.slope,reference);
      if (!point || !isLinePointVisible(point,bounds,state)) continue;
      const offset=(point.x-line.anchor.x)*normal.x+(point.y-line.anchor.y)*normal.y;
      const movement=normalTranslation(offset,normal,axis);
      if (!movement || !onLineExtent({...line,anchor:{x:line.anchor.x+movement.delta.x,y:line.anchor.y+movement.delta.y}},point,1e-7)) continue;
      candidates.push({key:`${curve.id}:indifference`,sourceId:curve.id,point,
        anchor:{x:line.anchor.x+movement.delta.x,y:line.anchor.y+movement.delta.y},
        distance:movement.distance*unit,pointerDistance:Math.hypot(point.x-reference.x,point.y-reference.y)*unit,
        ...(curve.family==='complements'?{label:'꺾임 맞춤'}:curve.family==='substitutes' && Math.abs(line.slope+curve.shape)>1e-9?{label:'모서리 맞춤'}:{})});
      continue;
    }
    const pieces = curve.type === 'sketch' ? sketchControls(curve) : displayedCurveSegments(curve,bounds,state);
    pieces.forEach((points,index) => {
      contacts(points,direction,reference,bounds,state).forEach((point,contactIndex) => {
        const offset = (point.x-line.anchor.x)*normal.x + (point.y-line.anchor.y)*normal.y;
        const movement=normalTranslation(offset,normal,axis);
        if (!movement) return;
        const anchor = {x:line.anchor.x+movement.delta.x,y:line.anchor.y+movement.delta.y};
        if (!validPoint(anchor) || !onLineExtent({...line,anchor},point,1e-7)) return;
        candidates.push({key:`${curve.id}:${index}:${contactIndex}`,sourceId:curve.id,point,anchor,
          distance:movement.distance*unit, pointerDistance:Math.hypot(point.x-reference.x,point.y-reference.y)*unit});
      });
    });
  }
  return chooseCandidate(candidates,previous);
}

/** Move the whole curve onto a stationary line, preserving its exact shape and direction. */
export function snapCurveToTangency(curve,state,bounds,unit,{previous=null,reference=curve.anchor,altKey=false,axis=null}={}) {
  if (altKey || curve.binding || !['curve','sketch'].includes(curve.type) || !validPoint(curve.anchor) || !Number.isFinite(unit) || unit<=0) return null;
  const margin=TANGENT_RELEASE_PX/unit;
  const expanded={xMin:bounds.xMin-margin,xMax:bounds.xMax+margin,yMin:bounds.yMin-margin,yMax:bounds.yMax+margin};
  if (isIndifference(curve)) {
    const candidates=[];
    for (const line of state.lines) {
      if (!canAttach(state,curve.id,line.id)) continue;
      const candidate=indifferenceOnLine(curve,line,reference);
      if (!candidate || !isLinePointVisible(candidate.point,bounds,state) || !onLineExtent(line,candidate.point,1e-7)) continue;
      candidates.push({...candidate,key:`${line.id}:indifference`,sourceId:line.id,
        distance:indifferenceMoveDistance(curve,candidate.anchor)*unit,
        pointerDistance:Math.hypot(candidate.point.x-reference.x,candidate.point.y-reference.y)*unit,
        ...(curve.family==='complements'?{label:'꺾임 맞춤'}:curve.family==='substitutes' && Math.abs(line.slope+curve.shape)>1e-9?{label:'모서리 맞춤'}:{})});
    }
    return chooseCandidate(candidates,previous);
  }
  const pieces=curve.type==='sketch'?sketchControls(curve):displayedCurveSegments(curve,expanded,{...state,axisGapEnabled:false});
  const candidates=[];
  for (const line of state.lines) {
    // A line derived from this moving curve is not a stationary target.
    if (!canAttach(state,curve.id,line.id)) continue;
    const direction=directionOf(line.slope),normal={x:-direction.y,y:direction.x};
    pieces.forEach((points,index)=>{
      for (const rawPoint of contacts(points,direction,reference,null,state)) {
        const offset=(line.anchor.x-rawPoint.x)*normal.x+(line.anchor.y-rawPoint.y)*normal.y;
        const movement=normalTranslation(offset,normal,axis);
        if (!movement || movement.distance*unit>TANGENT_RELEASE_PX) continue;
        const {delta}=movement,anchor={x:curve.anchor.x+delta.x,y:curve.anchor.y+delta.y};
        if (!validPoint(anchor)) continue;
        const shifted=points.map(point=>({x:point.x+delta.x,y:point.y+delta.y}));
        // Clip after translation; a hidden raw contact can become visible after correction.
        contacts(shifted,direction,reference,bounds,state).forEach((point,contactIndex)=>{
          if (!onLineExtent(line,point,1e-7)) return;
          candidates.push({key:`${line.id}:${index}:${contactIndex}`,sourceId:line.id,point,anchor,
            distance:movement.distance*unit,pointerDistance:Math.hypot(point.x-reference.x,point.y-reference.y)*unit});
        });
      }
    });
  }
  return chooseCandidate(candidates,previous);
}
