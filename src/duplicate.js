import { OBJECT_LABELS } from './objects.js';
import { directionOf } from './graph/math.js';
import { isIndifference, radialIndifference, linearAxis, moveIndifference } from './graph/indifference.js';

export const DUPLICATABLE = ['line', 'curve', 'sketch', 'point', 'dashed', 'group'];

function nearbyOffset(object) {
  if (isIndifference(object)) {
    if (radialIndifference(object)) {const length=Math.hypot(object.anchor.x,object.anchor.y);return {x:object.anchor.x/length,y:object.anchor.y/length};}
    if (object.family==='quasilinear') return linearAxis(object)==='x'?{x:1,y:0}:{x:0,y:1};
    const length=Math.hypot(object.shape,1);return {x:object.shape/length,y:1/length};
  }
  const slope=object.type==='line' || object.type==='curve' ? object.slope
    : object.type==='dashed' ? (object.end.x===object.anchor.x?null:(object.end.y-object.anchor.y)/(object.end.x-object.anchor.x)) : undefined;
  if (slope===undefined) return {x:1,y:0};
  const d=directionOf(slope),sign=d.y>0?-1:1;
  return {x:-d.y*sign,y:d.x*sign};
}
function shiftedCopy(object,offset) {
  const copy=structuredClone(object);
  for (const key of ['anchor','start','end']) if (copy[key]) {
    const point={x:copy[key].x+offset.x,y:copy[key].y+offset.y};
    copy[key]=isIndifference(copy) && key==='anchor'?moveIndifference(copy,copy.anchor,point):point;
    if (!Number.isFinite(copy[key].x) || !Number.isFinite(copy[key].y)) return null;
  }
  return copy;
}
function sameGeometry(a,b) {
  if (a.type!==b.type || !a.anchor || !b.anchor) return false;
  if (a.type==='line') {
    const d=directionOf(a.slope),e=directionOf(b.slope);
    return Math.abs(d.x*e.y-d.y*e.x)<1e-10 && Math.abs((a.anchor.x-b.anchor.x)*d.y-(a.anchor.y-b.anchor.y)*d.x)<1e-8;
  }
  for (const key of ['anchor','start','end','tangent']) {
    if (Boolean(a[key])!==Boolean(b[key])) return false;
    if (a[key] && Math.hypot(a[key].x-b[key].x,a[key].y-b[key].y)>1e-8) return false;
  }
  return ['slope','span','bend','leftReach','rightReach','family','shape','linearAxis'].every(key=>a[key]===b[key]);
}

/** Keep a copied hierarchy together and leave room for repeated copies of one source. */
export function placeCopiesNearby(copies,objects,sourceId) {
  const reference=copies.find(copy=>copy.id===sourceId && copy.anchor) ?? copies.find(copy=>copy.anchor);
  if (!reference) return copies;
  const offset=nearbyOffset(reference);
  for (let step=1;step<=objects.length+1;step++) {
    const delta={x:offset.x*step,y:offset.y*step},candidate=shiftedCopy(reference,delta);
    if (!candidate) return null;
    if (objects.some(object=>sameGeometry(candidate,object))) continue;
    const placed=copies.map(copy=>shiftedCopy(copy,delta));
    return placed.every(Boolean)?placed:null;
  }
  return null;
}

/** Prepare a copy without changing the source or allocating IDs. */
export function prepareDuplicate(source, { slopeFactor = 1 } = {}) {
  if (!source || !DUPLICATABLE.includes(source.type)) return { error: '복제할 도형을 선택해 주세요.' };
  if (![0.5, 1, 2].includes(slopeFactor)) return { error: '복제 기울기를 확인해 주세요.' };
  const object = structuredClone(source);
  if ('binding' in object) object.binding=null;
  object.name = `${(source.name || OBJECT_LABELS[source.type]).slice(0, 79)}′`;
  object.collapsed = false;
  if (object.type === 'line' && object.slope !== null) {
    const slope = object.slope * slopeFactor;
    if (!Number.isFinite(slope) || (object.slope !== 0 && slope === 0)) return { error: '이 기울기는 숫자 범위를 벗어납니다.' };
    object.slope = slope;
  }
  return { object, error: null };
}
