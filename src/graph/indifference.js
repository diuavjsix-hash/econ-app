import { clipLine } from './math.js';
import { clipSegment } from './ruler.js';

export const INDIFFERENCE_FAMILIES = {
  'rectangular-hyperbola': { label: '직각 쌍곡선', movement: '축을 점근선으로 유지 · 크기 조절', shape: '크기', color: '#6068e8' },
  'cobb-douglas': { label: '콥더글라스', movement: '원점 기준 확대·축소', shape: '휘어짐', color: '#6068e8' },
  substitutes: { label: '완전대체재', movement: '기울기 유지 · 평행이동', shape: '기울기', color: '#43a999' },
  complements: { label: '완전보완재', movement: '원점 기준 · 꺾임 이동', shape: '꺾임 비율', color: '#b67836' },
  quasilinear: { label: '준선형효용', movement: '선형 축으로 평행이동', shape: '휘어짐', color: '#ad5265' },
};
export const isIndifference = curve => Boolean(curve && Object.hasOwn(INDIFFERENCE_FAMILIES, curve.family));
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
export const radialIndifference = c => ['rectangular-hyperbola','cobb-douglas','complements'].includes(c.family);
const isPowerCurve = c => ['rectangular-hyperbola','cobb-douglas'].includes(c.family);
const power = c => c.family==='rectangular-hyperbola'?1:c.shape;
export const linearAxis = c => c.linearAxis === 'x' ? 'x' : 'y';
export function indifferenceMovement(c) {
  return c.family === 'quasilinear' ? `${linearAxis(c)}축으로 평행이동` : INDIFFERENCE_FAMILIES[c.family].movement;
}
export function indifferenceMoveDistance(c,anchor) {
  return c.family==='substitutes'
    ? Math.abs(c.shape*(anchor.x-c.anchor.x)+anchor.y-c.anchor.y)/Math.hypot(c.shape,1)
    : Math.hypot(anchor.x-c.anchor.x,anchor.y-c.anchor.y);
}

/** Drag from the grabbed point, without changing preferences or shifting the origin. */
export function moveIndifference(c, start, point, axis = null) {
  if (!finitePoint(start) || !finitePoint(point)) return {...c.anchor};
  if (radialIndifference(c)) {
    const length = start.x**2 + start.y**2;
    if (length < 1e-12) return {...c.anchor};
    const scale = Math.max(0.02/Math.min(c.anchor.x,c.anchor.y), (point.x*start.x+point.y*start.y)/length);
    return {x:c.anchor.x*scale,y:c.anchor.y*scale};
  }
  if (c.family === 'quasilinear') {
    const key=linearAxis(c);
    return {...c.anchor,[key]:c.anchor[key]+point[key]-start[key]};
  }
  const dx=axis==='y'?0:point.x-start.x,dy=axis==='x'?0:point.y-start.y;
  // The normal projection removes motion along an unchanged straight curve.
  const offset=(c.shape*dx+dy)/(c.shape**2+1);
  const anchor={x:c.anchor.x+c.shape*offset,y:c.anchor.y+offset};
  const intercept=c.shape*anchor.x+anchor.y;
  if (intercept<0.02) {
    const correction=(0.02-intercept)/(c.shape**2+1);
    anchor.x+=c.shape*correction;anchor.y+=correction;
  }
  const level=c.shape*anchor.x+anchor.y;
  return {x:c.shape*level/(1+c.shape**2),y:level/(1+c.shape**2)};
}

export function indifferenceValue(c, input, direction='vertical') {
  const {anchor:a,family}=c,r=power(c);
  if (direction==='horizontal') {
    if (isPowerCurve(c)) return input>0 ? a.x*Math.exp(Math.log(a.y/input)/r) : NaN;
    if (family==='substitutes') return a.x+(a.y-input)/r;
    if (family==='quasilinear') return linearAxis(c)==='x'
      ? input>0 ? a.x-r*Math.log(input/a.y) : NaN
      : a.x*Math.exp((a.y-input)/r);
    return NaN; // An L shape is not a single-valued function.
  }
  if (isPowerCurve(c)) return input>0 ? a.y*Math.exp(r*Math.log(a.x/input)) : NaN;
  if (family==='substitutes') return a.y-r*(input-a.x);
  if (family==='quasilinear') return linearAxis(c)==='x'
    ? a.y*Math.exp((a.x-input)/r)
    : input>0 ? a.y-r*Math.log(input/a.x) : NaN;
  return NaN;
}

/** Native parameter is x, or y for the horizontally translated quasi-linear curve. */
const swapped = c => c.family==='quasilinear' && linearAxis(c)==='x';
function pointAt(c,t) { return swapped(c)?{x:indifferenceValue(c,t,'horizontal'),y:t}:{x:t,y:indifferenceValue(c,t)}; }
function parameterRange(c,bounds) {
  const swap=swapped(c),key=swap?'y':'x',other=swap?'x':'y';
  let low=Math.max(0,bounds[`${key}Min`]),high=bounds[`${key}Max`];
  if (c.family!=='substitutes') low=Math.max(Number.MIN_VALUE,low);
  const inverse=v=>indifferenceValue(c,v,swap?'vertical':'horizontal');
  const from=inverse(bounds[`${other}Max`]),to=inverse(Math.max(0,bounds[`${other}Min`]));
  if (Number.isFinite(from)) low=Math.max(low,from);
  if (Number.isFinite(to)) high=Math.min(high,to);
  return low<high && Number.isFinite(low) && Number.isFinite(high)?[low,high]:null;
}

/** Display chords only. All contacts and moves are calculated on the original geometry. */
export function clipIndifference(c, bounds) {
  const positiveBounds={xMin:Math.max(0,bounds.xMin),yMin:Math.max(0,bounds.yMin),xMax:bounds.xMax,yMax:bounds.yMax};
  if (positiveBounds.xMin>=positiveBounds.xMax || positiveBounds.yMin>=positiveBounds.yMax) return [];
  const asQuadratic=([a,b])=>[a,midpoint(a,b),b];
  if (c.family==='complements') {
    const a=c.anchor;
    return [clipSegment(a,{x:a.x,y:Math.max(a.y,positiveBounds.yMax)},positiveBounds),
      clipSegment(a,{x:Math.max(a.x,positiveBounds.xMax),y:a.y},positiveBounds)]
      .filter(s=>s && Math.hypot(s[1].x-s[0].x,s[1].y-s[0].y)>1e-10).map(asQuadratic);
  }
  if (c.family==='substitutes') {
    const segment=clipLine({anchor:c.anchor,slope:-c.shape},positiveBounds);
    return segment?[asQuadratic(segment)]:[];
  }
  const range=parameterRange(c,positiveBounds),segments=[];
  if (!range) return [];
  function split(low,high,depth=0) {
    const a=pointAt(c,low),b=pointAt(c,high),mid=pointAt(c,(low+high)/2);
    if (![a,b,mid].every(finitePoint)) return;
    const chord=midpoint(a,b);
    if (Math.hypot(mid.x-chord.x,mid.y-chord.y)>0.0005 && depth<18) {
      split(low,(low+high)/2,depth+1);split((low+high)/2,high,depth+1);
    } else segments.push(asQuadratic([a,b]));
  }
  split(...range);
  return segments;
}

/** A representative exact contact for a fixed line slope; a kink is a support contact. */
export function indifferenceContact(c,slope,reference=c.anchor) {
  if (c.family==='complements') return slope!==null && slope<0?{...c.anchor}:null;
  if (slope===null || slope>=0) return null;
  if (c.family==='substitutes') {
    if (Math.abs(slope+c.shape)>1e-9*Math.max(1,c.shape)) {
      const b=c.anchor.y+c.shape*c.anchor.x;
      return c.shape>-slope?{x:b/c.shape,y:0}:{x:0,y:b};
    }
    const x=(reference.x+c.shape*(c.anchor.y+c.shape*c.anchor.x-reference.y))/(1+c.shape**2);
    const intercept=c.anchor.y+c.shape*c.anchor.x;
    const bounded=Math.max(0,Math.min(intercept/c.shape,x));
    return {x:bounded,y:indifferenceValue(c,bounded)};
  }
  if (isPowerCurve(c)) {
    const r=power(c),x=Math.exp((Math.log(r*c.anchor.y)+r*Math.log(c.anchor.x)-Math.log(-slope))/(r+1));
    return {x,y:indifferenceValue(c,x)};
  }
  if (swapped(c)) {
    const y=-c.shape*slope;return {x:indifferenceValue(c,y,'horizontal'),y};
  }
  const x=-c.shape/slope;return {x,y:indifferenceValue(c,x)};
}

/** Change only the level, along this family's permitted movement, to pass through a point. */
export function indifferenceThroughPoint(c,p) {
  if (!finitePoint(p) || p.x<0 || p.y<0) return null;
  const a=c.anchor;
  if (isPowerCurve(c)) {
    if (p.x<=0 || p.y<=0) return null;
    const r=power(c),scale=Math.exp((Math.log(p.y/a.y)+r*Math.log(p.x/a.x))/(1+r));
    return Math.min(a.x*scale,a.y*scale)>=0.02?{x:a.x*scale,y:a.y*scale}:null;
  }
  if (c.family==='complements') {
    const scale=Math.min(p.x/a.x,p.y/a.y);
    return scale>0 && Math.min(a.x*scale,a.y*scale)>=0.02?{x:a.x*scale,y:a.y*scale}:null;
  }
  if (c.family==='substitutes') return moveIndifference(c,a,p);
  const axis=linearAxis(c),other=axis==='x'?'y':'x';
  if (p[other]<=0) return null;
  return {...a,[axis]:p[axis]+c.shape*Math.log(p[other]/a[other])};
}

export function indifferenceOnLine(c,line,reference=c.anchor) {
  const contact=indifferenceContact(c,line.slope,reference);
  if (!contact) return null;
  const intercept=line.anchor.y-line.slope*line.anchor.x;
  let anchor;
  if (radialIndifference(c)) {
    const denominator=contact.y-line.slope*contact.x,scale=intercept/denominator;
    if (!(scale>0) || !Number.isFinite(scale) || Math.min(c.anchor.x*scale,c.anchor.y*scale)<0.02) return null;
    anchor={x:c.anchor.x*scale,y:c.anchor.y*scale};
  } else if (c.family==='quasilinear' && linearAxis(c)==='x') {
    anchor={...c.anchor,x:c.anchor.x+(contact.y-line.slope*contact.x-intercept)/line.slope};
  } else if (c.family==='quasilinear') anchor={...c.anchor,y:c.anchor.y+intercept-(contact.y-line.slope*contact.x)};
  else {
    // Unequal price and substitution slopes choose the appropriate nonnegative-axis corner.
    const targetIntercept=Math.abs(line.slope+c.shape)>1e-9*Math.max(1,c.shape)
      ? c.shape>-line.slope?c.shape*intercept/(-line.slope):intercept : intercept;
    if (!(targetIntercept>0)) return null;
    const delta=(targetIntercept-(c.anchor.y+c.shape*c.anchor.x))/(1+c.shape**2);
    anchor={x:c.anchor.x+c.shape*delta,y:c.anchor.y+delta};
  }
  const point=indifferenceContact({...c,anchor},line.slope,reference);
  return finitePoint(anchor) && finitePoint(point) && point.x>=0 && point.y>=0 ? {anchor,point}:null;
}

/** Exact smooth-curve/line contacts; bracket roots on either side of the unique minimum. */
export function indifferenceLineIntersections(c,line,bounds) {
  if (c.family==='complements') {
    const a=c.anchor,points=[];
    if (line.slope===null) {if (line.anchor.x>=a.x) points.push({x:line.anchor.x,y:a.y});}
    else {
      const y=line.anchor.y+line.slope*(a.x-line.anchor.x);
      if (y>=a.y) points.push({x:a.x,y});
      if (line.slope!==0) {const x=line.anchor.x+(a.y-line.anchor.y)/line.slope;if (x>=a.x) points.push({x,y:a.y});}
    }
    return points.filter(p=>p.x>=bounds.xMin && p.x<=bounds.xMax && p.y>=bounds.yMin && p.y<=bounds.yMax).map(point=>({point,kind:'intersection'}));
  }
  if (line.slope===null) {
    const point={x:line.anchor.x,y:indifferenceValue(c,line.anchor.x)};
    return finitePoint(point)&&point.x>=0&&point.y>=0&&point.x>=bounds.xMin&&point.x<=bounds.xMax&&point.y>=bounds.yMin&&point.y<=bounds.yMax?[{point,kind:'intersection'}]:[];
  }
  const range=parameterRange(c,{...bounds,xMin:Math.max(0,bounds.xMin),yMin:Math.max(0,bounds.yMin)});
  if (!range) return [];
  const residual=t=>{const p=pointAt(c,t);return p.y-line.anchor.y-line.slope*(p.x-line.anchor.x);};
  const contact=indifferenceContact(c,line.slope),critical=c.family==='substitutes'?undefined:contact?.[swapped(c)?'y':'x'];
  const cuts=[range[0],...(critical>range[0]&&critical<range[1]?[critical]:[]),range[1]],found=[];
  const add=(t,kind)=>{const point=pointAt(c,t);if (!found.some(v=>Math.hypot(v.point.x-point.x,v.point.y-point.y)<1e-7)) found.push({point,kind});};
  const tolerance=1e-10*Math.max(1,Math.abs(line.anchor.y),Math.abs(line.slope)*bounds.xMax);
  if (c.family==='substitutes' && Math.abs(line.slope+c.shape)<1e-10) return []; // Coincident lines have no unique crossing.
  for (const t of cuts) if (Math.abs(residual(t))<tolerance) add(t,Math.abs(t-critical)<1e-9?'tangent':'intersection');
  for (let i=1;i<cuts.length;i++) {
    let low=cuts[i-1],high=cuts[i],f=residual(low),g=residual(high);
    if (Math.abs(f)<tolerance || Math.abs(g)<tolerance || f*g>=0) continue;
    for (let n=0;n<64;n++) {const mid=(low+high)/2;if (f*residual(mid)<=0) high=mid;else {low=mid;f=residual(mid);}}
    add((low+high)/2,'intersection');
  }
  return found;
}

export function indifferenceShapeHandle(c,bounds=null) {
  if (c.family==='complements') {
    const scale=bounds?Math.min(1.35,bounds.xMax/c.anchor.x,bounds.yMax/c.anchor.y):1.35;
    return {x:c.anchor.x*scale,y:c.anchor.y*scale};
  }
  const key=swapped(c)?'y':'x',range=bounds && parameterRange(c,bounds);
  let t=c.anchor[key]*1.6;
  if (range) {
    const origin=Math.max(range[0],Math.min(range[1],c.anchor[key]));
    t=range[1]-origin>origin-range[0]?origin+(range[1]-origin)*0.4:origin-(origin-range[0])*0.4;
  }
  return pointAt(c,t);
}
export function shapeIndifference(c,p) {
  if (c.family==='rectangular-hyperbola') {
    const anchor=indifferenceThroughPoint(c,p);
    return anchor?{anchor}:{};
  }
  if (c.family==='complements') {
    if (p.x<=0 || p.y<=0) return {};
    const radius=Math.hypot(c.anchor.x,c.anchor.y),ratio=Math.max(0.15,Math.min(20,p.y/p.x));
    const x=radius/Math.hypot(1,ratio);return {anchor:{x,y:x*ratio},reshape:true};
  }
  let shape;
  if (c.family==='substitutes') shape=(c.anchor.y-p.y)/(p.x-c.anchor.x);
  else if (c.family==='cobb-douglas') shape=Math.log(p.y/c.anchor.y)/Math.log(c.anchor.x/p.x);
  else {const axis=linearAxis(c),other=axis==='x'?'y':'x';shape=(c.anchor[axis]-p[axis])/Math.log(p[other]/c.anchor[other]);}
  return Number.isFinite(shape) && shape>0 ? {shape:Math.max(0.15,Math.min(20,shape))}:{};
}
