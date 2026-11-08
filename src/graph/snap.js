import { displayedLineSegments, displayedCurveSegments, isLinePointVisible, lineDisplayRegions } from './display.js';
import { clipSegment } from './ruler.js';
import { displayedSumSegments } from './sum.js';
import { displayedSketchSegments, displayedSketchMinimum, sketchControls } from './sketch.js';
import { isIndifference, indifferenceLineIntersections } from './indifference.js';
import { SNAP_CAPTURE_PX, SNAP_RELEASE_PX, chooseSnapCandidate } from './snap-policy.js';
import { axisSegments, coordinateOrigins } from './axes.js';
import { buildCurveContactTargets } from './curve-contacts.js';
import { independentSnapState, geometryKey } from './snap-context.js';
import { curveFamilyOf } from '../models/curve-families.js';
import { directionOf } from './math.js';
import { lineEndPoints } from './line-extent.js';

export const SNAP_RADIUS = SNAP_CAPTURE_PX;
export const INTERSECTION_RADIUS = SNAP_CAPTURE_PX;
const EPS = 1e-9;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (t) => t >= -EPS && t <= 1 + EPS;
const clamp = (t) => Math.max(0, Math.min(1, t));

function evaluate(coefficients, t) {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) result = result * t + coefficients[i];
  return result;
}

/** Isolate roots on monotone intervals, retaining double roots at tangencies. */
function roots(coefficients, min = 0, max = 1) {
  const scale = Math.max(...coefficients.map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0 || min > max) return [];
  const c = coefficients.map((value) => value / scale);
  while (c.length > 1 && Math.abs(c.at(-1)) < 1e-14) c.pop();
  if (c.length === 1) return [];
  if (c.length === 2) {
    const t = -c[0] / c[1];
    return t >= min - EPS && t <= max + EPS ? [Math.max(min, Math.min(max, t))] : [];
  }
  const critical = roots(c.slice(1).map((value, i) => value * (i + 1)), min, max);
  const cuts = [min, ...critical, max].sort((a, b) => a - b);
  const found = [];
  const add = (t) => { if (!found.some((value) => Math.abs(value - t) < 1e-8)) found.push(t); };
  for (const t of cuts) if (Math.abs(evaluate(c, t)) < 1e-12) add(t);
  for (let i = 1; i < cuts.length; i++) {
    let low = cuts[i - 1], high = cuts[i];
    let fLow = evaluate(c, low);
    if (fLow * evaluate(c, high) >= 0) continue;
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2;
      const fMiddle = evaluate(c, middle);
      if (fLow * fMiddle <= 0) high = middle;
      else { low = middle; fLow = fMiddle; }
    }
    add((low + high) / 2);
  }
  return found.sort((a, b) => a - b);
}

function piece(id, points) {
  const [a, b, c] = points;
  const v = { x: 2 * (b.x - a.x), y: 2 * (b.y - a.y) };
  const q = { x: a.x - 2 * b.x + c.x, y: a.y - 2 * b.y + c.y };
  const linear = Math.hypot(q.x, q.y) <= 1e-12 * Math.max(1, distance(a, c));
  return { id, a, v: linear ? sub(c, a) : v, q: linear ? { x: 0, y: 0 } : q, linear };
}

function at(shape, t) {
  return { x: shape.a.x + t * (shape.v.x + t * shape.q.x), y: shape.a.y + t * (shape.v.y + t * shape.q.y) };
}

function straightPiece(id, start, end) {
  return piece(id, [start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end]);
}

/** Clip the parameter domain of an original quadratic, preserving its geometry. */
function clipQuadraticPiece(shape, bounds) {
  const cuts = [0, 1];
  for (const axis of ['x', 'y']) for (const limit of [bounds[`${axis}Min`], bounds[`${axis}Max`]]) {
    cuts.push(...roots([shape.a[axis] - limit, shape.v[axis], shape.q[axis]]));
  }
  const sorted = [...new Set(cuts)].sort((a, b) => a - b), result = [];
  const visible = t => { const p = at(shape, t); return p.x >= bounds.xMin - EPS && p.x <= bounds.xMax + EPS && p.y >= bounds.yMin - EPS && p.y <= bounds.yMax + EPS; };
  const interval = (low, high) => {
    const span = high - low;
    return { id: shape.id, a: at(shape, low), v: { x: span * (shape.v.x + 2 * low * shape.q.x), y: span * (shape.v.y + 2 * low * shape.q.y) },
      q: { x: span * span * shape.q.x, y: span * span * shape.q.y }, linear: shape.linear };
  };
  for (let i = 1; i < sorted.length; i++) if (visible((sorted[i - 1] + sorted[i]) / 2)) result.push(interval(sorted[i - 1], sorted[i]));
  for (const t of sorted) if (visible(t) && !result.some(s => distance(at(shape, t), nearest(s, at(shape, t))) < 1e-9)) result.push(interval(t, t));
  return result;
}

function nearest(shape, point) {
  const w = sub(shape.a, point);
  const parameters = shape.linear
    ? [clamp(-dot(w, shape.v) / (dot(shape.v, shape.v) || 1))]
    : [0, 1, ...roots([dot(w, shape.v), dot(shape.v, shape.v) + 2 * dot(w, shape.q), 3 * dot(shape.v, shape.q), 2 * dot(shape.q, shape.q)])];
  let best = null;
  for (const t of parameters) {
    const candidate = at(shape, t);
    if (!best || distance(point, candidate) < distance(point, best)) best = candidate;
  }
  return best;
}

function quadraticRoots(coefficients) {
  const scale=Math.max(...coefficients.map(Math.abs));
  if (!Number.isFinite(scale) || !scale) return []; // Coincident pieces have no unique contact.
  const [c,b,a]=coefficients.map(value=>value/scale);
  let parameters=[];
  if (!a) { if (b) parameters=[-c/b]; }
  else {
    const discriminant=b*b-4*a*c,tolerance=32*Number.EPSILON*(b*b+Math.abs(4*a*c));
    // A double root is especially sensitive to rounding after translating a line.
    // Keep a single exact critical point rather than two nearby false crossings.
    if (Math.abs(discriminant)<=tolerance) parameters=[-b/(2*a)];
    else if (discriminant>0) {
      const q=-0.5*(b+(b<0?-1:1)*Math.sqrt(discriminant));
      parameters=q?[q/a,c/q]:[0];
    }
  }
  return parameters.filter(inside).map(clamp);
}

/** Exact finite quadratic helpers shared by point placement and moving-shape magnets. */
export function nearestQuadraticPoint(points,point) {
  return nearest(piece('quadratic',points),point);
}
export function quadraticCoordinatePoints(points,coordinate,value) {
  const shape=piece('quadratic',points),coefficients=[shape.a[coordinate]-value,shape.v[coordinate],shape.q[coordinate]];
  if (coefficients.every(coefficient=>coefficient===0)) return null; // Every parameter has this coordinate.
  return quadraticRoots(coefficients).map(t=>at(shape,t));
}

function quadraticLineCrossings(curve, line) {
  const lengthSquared = dot(line.v,line.v);
  if (!lengthSquared) return [];
  const coefficients=[cross(sub(curve.a,line.a),line.v),cross(curve.v,line.v),cross(curve.q,line.v)];
  return quadraticRoots(coefficients)
    .map(t => {
      const point=at(curve,t),derivative={x:curve.v.x+2*t*curve.q.x,y:curve.v.y+2*t*curve.q.y};
      const scale=Math.hypot(derivative.x,derivative.y)*Math.sqrt(lengthSquared);
      return {point,kind:scale>0 && Math.abs(cross(derivative,line.v))<=1e-9*scale?'tangent':'intersection'};
    }).filter(({point}) => inside(dot(sub(point,line.a),line.v)/lengthSquared));
}

function intersections(a, b) {
  if (a.linear && b.linear) {
    const denominator = cross(a.v, b.v);
    if (Math.abs(denominator) <= 1e-13 * Math.hypot(a.v.x, a.v.y) * Math.hypot(b.v.x, b.v.y)) return [];
    const delta = sub(b.a, a.a);
    const u = cross(delta, b.v) / denominator;
    const v = cross(delta, a.v) / denominator;
    return inside(u) && inside(v) ? [at(a, clamp(u))] : [];
  }
  if (a.linear) [a, b] = [b, a];
  if (b.linear) {
    return quadraticLineCrossings(a,b).map(({point})=>point);
  }
  // Rendered curve pieces have linear x and quadratic y, so curve/curve roots are quadratic.
  const dxA = a.v.x, dxB = b.v.x;
  if (!dxA || !dxB) return [];
  const low = Math.max(a.a.x, b.a.x), high = Math.min(at(a, 1).x, at(b, 1).x);
  if (low > high + EPS) return [];
  const v0 = (a.a.x - b.a.x) / dxB, v1 = dxA / dxB;
  const coefficients = [
    a.a.y - b.a.y - b.v.y * v0 - b.q.y * v0 * v0,
    a.v.y - b.v.y * v1 - 2 * b.q.y * v0 * v1,
    a.q.y - b.q.y * v1 * v1,
  ];
  return roots(coefficients, clamp((low - a.a.x) / dxA), clamp((high - a.a.x) / dxA))
    .filter((u) => inside(v0 + v1 * u)).map((u) => at(a, u));
}

/** Exact axis crossings stay available even when an axis-gap band hides the stroke. */
export function buildInterceptTargets(state,bounds,excludeObjectId=null) {
  return interceptTargets(independentSnapState(state, excludeObjectId), bounds);
}
function interceptTargets(state,bounds) {
  const axes=[];
  if (bounds.yMin<=0 && bounds.yMax>=0) axes.push({axis:'x',shape:straightPiece('axis-x',{x:bounds.xMin,y:0},{x:bounds.xMax,y:0})});
  if (bounds.xMin<=0 && bounds.xMax>=0) axes.push({axis:'y',shape:straightPiece('axis-y',{x:0,y:bounds.yMin},{x:0,y:bounds.yMax})});
  const targets=[],rawState={...state,axisGapEnabled:false};
  const add=(point,axis,id=null)=>{
    const normalized={x:axis==='y'||Math.abs(point.x)<1e-10?0:point.x,y:axis==='x'||Math.abs(point.y)<1e-10?0:point.y};
    if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) return;
    if (normalized.x<bounds.xMin-EPS || normalized.x>bounds.xMax+EPS || normalized.y<bounds.yMin-EPS || normalized.y>bounds.yMax+EPS) return;
    const origin=normalized.x===0 && normalized.y===0;
    if (targets.some(target=>target.sourceId===id && distance(normalized,target.point)<1e-7)) return;
    targets.push({point:normalized,axis:origin?'origin':axis,sourceId:id,kind:'intercept',label:origin?'원점':`${axis}절편`,ids:id?[id,`axis-${axis}`]:['axis-x','axis-y']});
  };
  for (const origin of coordinateOrigins(state,bounds)) targets.push({ ...origin, sourceId: null, axis: 'origin', kind: 'intercept' });
  const sourcePieces=[];
  for (const line of state.lines) if (displayedLineSegments(line,bounds,state).length) {
    sourcePieces.push(...displayedLineSegments(line,bounds,rawState).map(points=>straightPiece(line.id,...points)));
  }
  for (const curve of state.curves) if (displayedCurveSegments(curve,bounds,state).length) {
    if (isIndifference(curve)) {
      for (const {axis} of axes) {
        const line=axis==='x'?{anchor:{x:0,y:0},slope:0}:{anchor:{x:0,y:0},slope:null};
        for (const {point} of indifferenceLineIntersections(curve,line,bounds)) add(point,axis,curve.id);
      }
      continue;
    }
    sourcePieces.push(...displayedCurveSegments(curve,bounds,rawState).map(points=>piece(curve.id,points)));
  }
  for (const sketch of state.sketches??[]) if (displayedSketchSegments(sketch,bounds,state).length) {
    sourcePieces.push(...sketchControls(sketch).map(points=>piece(sketch.id,points)));
  }
  for (const sum of state.sums??[]) if (displayedSumSegments(sum,state,bounds).length) {
    sourcePieces.push(...displayedSumSegments(sum,rawState,bounds).map(points=>straightPiece(sum.id,...points)));
  }
  for (const source of sourcePieces) for (const {axis,shape} of axes) for (const point of intersections(source,shape)) add(point,axis,source.id);
  return targets;
}

/** Use exactly the visible straight, quadratic and tangent geometry; no stored pixels. */
export function buildSnapTargets(state, bounds, excludeObjectId = null) {
  state = independentSnapState(state, excludeObjectId);
  const shapes = [];
  const analyticCurves = [];
  for (const line of state.lines) {
    shapes.push(...displayedLineSegments(line, bounds, state).map(points => straightPiece(line.id, ...points)));
  }
  for (const curve of state.curves) {
    shapes.push(...displayedCurveSegments(curve, bounds, state).map((points) => piece(curve.id, points)));
    const family = curveFamilyOf(curve);
    if (family?.contactGeometry === 'smooth') {
      const domains = lineDisplayRegions(bounds, state).map(region => ({ region, pieces: family.clip(curve, region) })).filter(d => d.pieces.length);
      if (domains.length) analyticCurves.push({ curve, domains });
    }
  }
  for (const sum of state.sums ?? []) {
    shapes.push(...displayedSumSegments(sum, state, bounds).map(points => straightPiece(sum.id, ...points)));
  }
  for (const sketch of state.sketches ?? []) {
    shapes.push(...displayedSketchSegments(sketch,bounds,state).map(points=>straightPiece(sketch.id,...points)));
  }

  for (const axis of axisSegments(state,bounds)) shapes.push(straightPiece(axis.id,...axis.points));
  const intercepts=interceptTargets(state,bounds);
  const crossings = [...intercepts];
  // A kink is a deliberate point target, not only the nearest point on either arm.
  // Register it before computed intersections so coincident crossings keep its identity.
  for (const curve of state.curves) if (curve.family==='complements'
    && isLinePointVisible(curve.anchor,bounds,state)) {
    crossings.push({ point:{...curve.anchor}, ids:[curve.id], sourceId:curve.id, kind:'kink', label:'꺾임 맞춤' });
  }
  // A displayed minimum is a point target like a kink. It creates no object or relation.
  for (const sketch of state.sketches ?? []) {
    const minimum = displayedSketchMinimum(sketch, bounds, state);
    if (minimum) crossings.push({ point:{...minimum}, ids:[sketch.id], sourceId:sketch.id, kind:'minimum', label:'최저점 맞춤' });
  }
  // Reconstruct contacts from document geometry, not a previous drag's transient UI state.
  // Every point/endpoint consumer receives them through this one registry.
  crossings.push(...buildCurveContactTargets(state, bounds));
  const exactSketches = new Map((state.sketches ?? [])
    .map(sketch=>[sketch.id,sketchControls(sketch).map(points=>piece(sketch.id,points))]));
  const quadratics = [...exactSketches.values()].flatMap(pieces => pieces.flatMap(shape =>
    lineDisplayRegions(bounds, state).flatMap(region => clipQuadraticPiece(shape, region))));
  const addCrossing = (point,ids,kind='intersection') => {
    if (!crossings.some(item=>distance(point,item.point)<1e-7)) crossings.push({point,ids,kind});
  };
  const exactIndifferences=new Set(state.curves.filter(isIndifference).map(c=>c.id));
  // Exact curve/line solvers consume visible finite straight pieces, regardless of
  // which tool produced them. A segment must not fall back to display chords
  // (which miss tangencies) or be extended into an infinite supporting line.
  const exactStraights=shapes.filter(shape=>shape.linear && !exactSketches.has(shape.id) && !exactIndifferences.has(shape.id));
  const exactStraightIds=new Set(exactStraights.map(shape=>shape.id));
  for (const curve of state.curves.filter(isIndifference)) {
    for (const segment of exactStraights) {
      const lengthSquared=dot(segment.v,segment.v);
      if (!lengthSquared) continue;
      const line={anchor:segment.a,slope:segment.v.x===0?null:segment.v.y/segment.v.x};
      for (const {point,kind} of indifferenceLineIntersections(curve,line,bounds)) {
        if (inside(dot(sub(point,segment.a),segment.v)/lengthSquared) && isLinePointVisible(point,bounds,state)) {
          addCrossing(point,[curve.id,segment.id],kind);
        }
      }
    }
  }
  // A tangent between mesh vertices never crosses the display chords. Solve against
  // the original quadratic instead, then apply the same visible-domain clipping.
  for (const [id,pieces] of exactSketches) {
    for (const line of shapes.filter(shape=>shape.linear && !exactSketches.has(shape.id))) {
      for (const curve of pieces) for (const {point,kind} of quadraticLineCrossings(curve,line)) {
        if (isLinePointVisible(point,bounds,state)) addCrossing(point,[id,line.id],kind);
      }
    }
  }
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (shapes[i].id === shapes[j].id) continue;
      if ((exactIndifferences.has(shapes[i].id) && exactStraightIds.has(shapes[j].id)) || (exactIndifferences.has(shapes[j].id) && exactStraightIds.has(shapes[i].id))) continue;
      const aSketch=exactSketches.has(shapes[i].id),bSketch=exactSketches.has(shapes[j].id);
      if ((aSketch && !bSketch && shapes[j].linear) || (bSketch && !aSketch && shapes[i].linear)) continue;
      for (const point of intersections(shapes[i], shapes[j])) {
        addCrossing(point,[shapes[i].id,shapes[j].id]);
      }
    }
  }
  // Drawn ends (segment/ray ends, free-curve start and end) are point targets too. They come
  // last: a contact or crossing that already involves the same stroke at that point says more.
  const addEnd = (point, id) => {
    if (!isLinePointVisible(point, bounds, state)) return;
    if (crossings.some(item => distance(point, item.point) < 1e-7 && item.ids.includes(id))) return;
    crossings.push({ point: { ...point }, ids: [id], sourceId: id, kind: 'endpoint', label: '끝점 맞춤' });
  };
  for (const line of state.lines) for (const end of lineEndPoints(line)) if (end) addEnd(end, line.id);
  for (const sketch of state.sketches ?? []) for (const end of [sketch.start, sketch.end]) addEnd(end, sketch.id);
  return { shapes, crossings, intercepts, analyticCurves, quadratics };
}

/** Point/sketch handles and all line-tool operations share one cache and source policy. */
export class SnapTargetCache {
  constructor() { this.clear(); }
  clear() { this.key = null; this.targets = null; }
  get(state, bounds, excludeObjectId = null) {
    const sources = independentSnapState(state, excludeObjectId);
    const key = JSON.stringify([excludeObjectId, geometryKey(sources, bounds)]);
    if (key !== this.key) { this.targets = buildSnapTargets(sources, bounds); this.key = key; }
    return this.targets;
  }
}

/** Candidates on the allowed movement axis, before magnet priority/hysteresis. */
export function guidedSnapCandidates(point, targets, unit, axis = null, radius = SNAP_RELEASE_PX, guide = null) {
  if (guide) return guideSnapCandidates(point, targets, unit, guide, radius);
  const locked = axis === 'x' ? 'y' : 'x', candidates = [];
  const add = (candidate, key, priority) => {
    if (axis && Math.abs(candidate.point[locked] - point[locked]) > EPS) return;
    const aligned = axis ? { ...candidate.point, [locked]: point[locked] } : candidate.point;
    const pixels = distance(point, aligned) * unit;
    if (pixels <= radius) candidates.push({ ...candidate, point: aligned, key, priority, distance: pixels });
  };
  for (const crossing of targets.crossings) add(crossing,
    `crossing:${crossing.ids.join(',')}:${crossing.point.x}:${crossing.point.y}`, 1);
  const analyticIds = new Set((targets.analyticCurves ?? []).map(({ curve }) => curve.id));
  for (const { curve, domains } of targets.analyticCurves ?? []) {
    const family = curveFamilyOf(curve);
    for (const { region, pieces } of domains) {
      const line = { anchor: point, slope: axis === 'x' ? 0 : null };
      const points = axis ? family.lineIntersections(curve, line, region).map(c => c.point)
        : [family.nearestPoint(curve, point, region, pieces)].filter(Boolean);
      for (const target of points) add({ point: target, kind: 'shape', ids: [curve.id] }, `shape:${curve.id}`, 2);
    }
  }
  const quadraticIds = new Set((targets.quadratics ?? []).map(shape => shape.id));
  for (const shape of [...targets.shapes.filter(s => !analyticIds.has(s.id) && !quadraticIds.has(s.id)), ...(targets.quadratics ?? [])]) {
    let points;
    if (!axis) points = [nearest(shape, point)];
    else {
      const coefficients = [shape.a[locked] - point[locked], shape.v[locked], shape.q[locked]];
      points = coefficients.every(value => Math.abs(value) <= 1e-12)
        ? [nearest(shape, point)] : quadraticRoots(coefficients).map(t => at(shape, t));
    }
    for (const target of points) add({ point: target, kind: 'shape', ids: [shape.id] }, `shape:${shape.id}`, 2);
  }
  return candidates;
}

/**
 * Discrete targets on an arbitrary guide line, such as the line whose end is being dragged.
 * Its crossings with other strokes and axes are points, so they share crossing priority.
 */
function guideSnapCandidates(point, targets, unit, guide, radius) {
  const d = directionOf(guide.slope), n = { x: -d.y, y: d.x }, line = { anchor: guide.anchor, slope: guide.slope };
  const offset = p => (p.x - guide.anchor.x) * n.x + (p.y - guide.anchor.y) * n.y, candidates = [];
  const add = (candidate, key) => {
    const pixels = distance(point, candidate.point) * unit;
    if (pixels <= radius) candidates.push({ ...candidate, key, priority: 1, distance: pixels });
  };
  const crossingOf = (id, target) => ['axis-x', 'axis-y'].includes(id)
    ? { point: target, kind: 'intercept', axis: id.slice(-1), ids: [id] } : { point: target, kind: 'intersection', ids: [id] };
  const registered = targets.crossings.filter(crossing => Math.abs(offset(crossing.point)) <= EPS);
  for (const crossing of registered) add(crossing, `crossing:${crossing.ids.join(',')}:${crossing.point.x}:${crossing.point.y}`);
  // A computed guide crossing at a registered target (contact, kink, end…) is the same point: keep the registered meaning.
  const addComputed = (candidate, key) => { if (!registered.some(c => distance(c.point, candidate.point) < 1e-7)) add(candidate, key); };
  const analyticIds = new Set((targets.analyticCurves ?? []).map(({ curve }) => curve.id));
  for (const { curve, domains } of targets.analyticCurves ?? []) for (const { region } of domains) {
    for (const { point: target } of curveFamilyOf(curve).lineIntersections(curve, line, region)) addComputed(crossingOf(curve.id, target), `guide:${curve.id}:${target.x}:${target.y}`);
  }
  const quadraticIds = new Set((targets.quadratics ?? []).map(shape => shape.id));
  for (const shape of [...targets.shapes.filter(s => !analyticIds.has(s.id) && !quadraticIds.has(s.id)), ...(targets.quadratics ?? [])]) {
    const coefficients = [offset(shape.a), dot(n, shape.v), dot(n, shape.q)];
    if (coefficients.every(value => Math.abs(value) <= 1e-12)) continue; // A collinear stroke has no single crossing.
    for (const target of quadraticRoots(coefficients).map(t => at(shape, t))) addComputed(crossingOf(shape.id, target), `guide:${shape.id}:${target.x}:${target.y}`);
  }
  return candidates;
}

/** Crossings retain priority; all pointer magnets share capture/release and axis constraints. */
const inBounds = (point, bounds) => !bounds || (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax);

/**
 * Placed points as candidates (**점 맞춤**, priority 0: first among captured targets).
 * Shift's locked axis or a guide line keeps only points on it. Every point consumer shares this.
 */
export function pointSnapCandidates(point, points, unit, { axis = null, guide = null, bounds = null, radius = SNAP_RELEASE_PX } = {}) {
  const locked = axis === 'x' ? 'y' : 'x', normal = guide && (d => ({ x: -d.y, y: d.x }))(directionOf(guide.slope)), result = [];
  for (const target of points ?? []) {
    if (!inBounds(target.anchor, bounds) || (axis && Math.abs(target.anchor[locked] - point[locked]) > EPS)) continue;
    if (guide && Math.abs((target.anchor.x - guide.anchor.x) * normal.x + (target.anchor.y - guide.anchor.y) * normal.y) > EPS) continue;
    const aligned = axis ? { ...target.anchor, [locked]: point[locked] } : { ...target.anchor };
    const pixels = distance(point, aligned) * unit;
    if (pixels <= radius) result.push({ point: aligned, kind: 'point', ids: [target.id], key: `point:${target.id}`, priority: 0, distance: pixels });
  }
  return result;
}

export function snapPoint(point, targets, unit, { previous=null, axis=null, points=[], bounds=null }={}) {
  return chooseSnapCandidate([...guidedSnapCandidates(point,targets,unit,axis), ...pointSnapCandidates(point,points,unit,{axis,bounds})],previous);
}
