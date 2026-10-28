import { directionOf } from './math.js';
import { lineDisplayRegions } from './display.js';
import { clipSegment, validPoint } from './ruler.js';

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function unitVector(vector) {
  const scale=Math.max(Math.abs(vector.x),Math.abs(vector.y));
  if (!Number.isFinite(scale) || scale<1e-10) return {x:1,y:0};
  const x=vector.x/scale,y=vector.y/scale,length=Math.hypot(x,y);
  return {x:x/length || 0,y:y/length || 0};
}
export function projectOnLine(point, line) {
  const direction = directionOf(line.slope);
  const parameter = (point.x - line.anchor.x) * direction.x + (point.y - line.anchor.y) * direction.y;
  return { point: { x: line.anchor.x + parameter * direction.x, y: line.anchor.y + parameter * direction.y }, parameter };
}
export function validSketch(curve) {
  return ['start', 'anchor', 'end', 'tangent'].every(key => validPoint(curve[key]))
    && [distance(curve.start,curve.anchor),distance(curve.end,curve.anchor),distance(curve.start,curve.end)].every(Number.isFinite)
    && distance(curve.start, curve.anchor) > 1e-6 && distance(curve.end, curve.anchor) > 1e-6
    && distance(curve.start, curve.end) > 1e-6 && Math.hypot(curve.tangent.x, curve.tangent.y) > 1e-8
    && [curve.leftReach, curve.rightReach].every(value => Number.isFinite(value) && value >= 0.05 && value <= 2)
    && sketchControls(curve).flat().every(validPoint);
}
/** Two quadratic pieces pass through all three points and share a tangent at the middle. */
export function sketchControls(curve) {
  const direction = unitVector(curve.tangent), middle = curve.anchor;
  const control = (side, endpoint, reach) => {
    const length = distance(endpoint, middle) * reach * side;
    return { x: middle.x + direction.x * length, y: middle.y + direction.y * length };
  };
  return [[curve.start, control(-1, curve.start, curve.leftReach), middle], [middle, control(1, curve.end, curve.rightReach), curve.end]];
}
export function quadraticPoint([a, b, c], t) {
  return { x: (1-t)**2*a.x + 2*(1-t)*t*b.x + t*t*c.x, y: (1-t)**2*a.y + 2*(1-t)*t*b.y + t*t*c.y };
}
export function sketchMinimum(curve) {
  const candidates = [{ ...curve.anchor }, { ...curve.start }, { ...curve.end }];
  for (const points of sketchControls(curve)) {
    const [a,b,c] = points, denominator = a.y - 2*b.y + c.y;
    const t = denominator ? (a.y-b.y)/denominator : -1;
    if (t > 0 && t < 1) candidates.push(quadraticPoint(points,t));
  }
  return candidates.reduce((best, point) => point.y < best.y - 1e-10 ? point : best);
}
export function displayedSketchSegments(curve, bounds, state) {
  const segments = [];
  const regions = lineDisplayRegions(bounds, state);
  function split(points, depth=0) {
    const [a,b,c] = points;
    if (depth < 14 && Math.hypot(a.x-2*b.x+c.x,a.y-2*b.y+c.y)/4 > 0.001) {
      const ab={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, bc={x:(b.x+c.x)/2,y:(b.y+c.y)/2};
      const mid={x:(ab.x+bc.x)/2,y:(ab.y+bc.y)/2};
      split([a,ab,mid],depth+1); split([mid,bc,c],depth+1);
    } else for (const region of regions) {
      const segment = clipSegment(a,c,region);
      if (segment && distance(...segment) > 1e-10) segments.push(segment);
    }
  }
  sketchControls(curve).forEach(points => split(points));
  return segments;
}
export function sketchHandlePoints(curve) {
  const pieces=sketchControls(curve), direction=unitVector(curve.tangent);
  const reach=Math.max(0.5,Math.min(1.5,(distance(curve.start,curve.anchor)+distance(curve.end,curve.anchor))/4));
  return { start:curve.start, end:curve.end, middle:curve.anchor,
    tangent:{x:curve.anchor.x+direction.x*reach,y:curve.anchor.y+direction.y*reach},
    leftReach:pieces[0][1], rightReach:pieces[1][1] };
}
export function translatedSketch(curve, delta) {
  return Object.fromEntries(['start','anchor','end'].map(key=>[key,{x:curve[key].x+delta.x,y:curve[key].y+delta.y}]));
}
