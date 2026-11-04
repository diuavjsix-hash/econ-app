import { objectsOf } from '../objects.js';
import { objectModel } from '../models/objects.js';

/** Transient mathematical rectangle; projection and axis reflections do not change hit testing. */
export function selectionRectangle(start,end,bounds) {
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const a={x:clamp(start.x,bounds.xMin,bounds.xMax),y:clamp(start.y,bounds.yMin,bounds.yMax)};
  const b={x:clamp(end.x,bounds.xMin,bounds.xMax),y:clamp(end.y,bounds.yMin,bounds.yMax)};
  return {xMin:Math.min(a.x,b.x),xMax:Math.max(a.x,b.x),yMin:Math.min(a.y,b.y),yMax:Math.max(a.y,b.y)};
}

/** Select visible strokes touching the rectangle, even when their anchors lie outside it. */
export function objectsInRectangle(state,rectangle) {
  if (rectangle.xMax<=rectangle.xMin || rectangle.yMax<=rectangle.yMin) return [];
  return objectsOf(state).filter(object=>objectModel(object).touchesRectangle(rectangle,state)).map(object=>object.id);
}
