import { objectsOf } from '../objects.js';
import { displayedLineSegments, displayedCurveSegments } from './display.js';
import { displayedSketchSegments } from './sketch.js';
import { displayedSumSegments } from './sum.js';
import { clipSegment } from './ruler.js';
import { fillTouchesRectangle } from './fill.js';

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
  const contains=p=>p.x>=rectangle.xMin && p.x<=rectangle.xMax && p.y>=rectangle.yMin && p.y<=rectangle.yMax;
  return objectsOf(state).filter(object=>{
    if (object.type==='point') return contains(object.anchor);
    if (object.type==='line') return displayedLineSegments(object,rectangle,state).length>0;
    if (object.type==='curve') return displayedCurveSegments(object,rectangle,state).length>0;
    if (object.type==='sketch') return displayedSketchSegments(object,rectangle,state).length>0;
    if (object.type==='sum') return displayedSumSegments(object,state,rectangle).length>0;
    if (object.type==='dashed') return Boolean(clipSegment(object.anchor,object.end,rectangle));
    if (object.type==='fill') return fillTouchesRectangle(object,rectangle);
    return false; // Folders and the retired ruler have no selectable canvas stroke.
  }).map(object=>object.id);
}
