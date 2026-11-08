import { displayedLineSegments, displayedCurveSegments } from './display.js';
import { displayedSketchSegments } from './sketch.js';
import { displayedSumSegments } from './sum.js';
import { clipSegment, validPoint } from './ruler.js';
import { buildSnapTargets } from './snap.js';
import { axisSegments } from './axes.js';

// All tolerances are mathematical distances, independent of screen size or zoom.
const EPS = 1e-8, FLATNESS = 0.0005;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a, b) => a.x * b.y - a.y * b.x;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const signedArea = ring => ring.reduce((area, a, i) => area + cross(a, ring[(i + 1) % ring.length]), 0) / 2;

function projection(p, a, b) {
  const v = sub(b, a), length = v.x ** 2 + v.y ** 2;
  const t = length ? ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / length : 0;
  return { t, point: { x: a.x + t * v.x, y: a.y + t * v.y } };
}
export function pointInRing(point, ring, boundary = true) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], projected = projection(point, a, b);
    if (projected.t >= 0 && projected.t <= 1 && distance(point, projected.point) < EPS) return boundary;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
export function containsFill(fill, point) {
  return fill.rings.reduce((inside, ring) => pointInRing(point, ring, false) ? !inside : inside, false);
}
export function validFill(fill) {
  return Array.isArray(fill?.rings) && fill.rings.length > 0 && fill.rings.every(ring =>
    Array.isArray(ring) && ring.length >= 3 && ring.every(validPoint) && Number.isFinite(signedArea(ring)) && Math.abs(signedArea(ring)) > EPS);
}
function simplifyRing(ring) {
  let points = [...ring], changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const previous = points[(i + points.length - 1) % points.length], point = points[i], next = points[(i + 1) % points.length];
      const projected = projection(point, previous, next);
      if (distance(previous, next) < EPS || (projected.t >= -EPS && projected.t <= 1 + EPS && distance(projected.point, point) < EPS)) {
        points.splice(i, 1); changed = true; break;
      }
    }
  }
  return points;
}
export function fillKey(fill) {
  return fill.rings.map(ring => {
    const points = simplifyRing(ring).map(p => `${p.x.toFixed(7)},${p.y.toFixed(7)}`);
    const rotations = [points, [...points].reverse()].map(values => {
      const first = values.reduce((best, value, i) => value < values[best] ? i : best, 0);
      return [...values.slice(first), ...values.slice(0, first)].join(';');
    });
    return rotations.sort()[0];
  }).sort().join('|');
}

function flatten([a, b, c], add, depth = 0) {
  if (depth >= 14 || distance(b, midpoint(a, c)) <= FLATNESS) { add(a, c); return; }
  const ab = midpoint(a, b), bc = midpoint(b, c), middle = midpoint(ab, bc);
  flatten([a, ab, middle], add, depth + 1); flatten([middle, bc, c], add, depth + 1);
}

/** Finite geometry and axes are walls. Grid lines and the screen frame are never walls. */
function boundarySegments(state, bounds) {
  const raw = { ...state, axisGapEnabled: false }, segments = [];
  const add = id => (a, b) => {
    if (validPoint(a) && validPoint(b) && distance(a, b) > EPS) segments.push({ id, a, b, cuts: [{ t: 0, point: a }, { t: 1, point: b }] });
  };
  for (const line of state.lines) for (const [a, b] of displayedLineSegments(line, bounds, raw)) add(line.id)(a, b);
  for (const curve of state.curves) for (const piece of displayedCurveSegments(curve, bounds, raw)) flatten(piece, add(curve.id));
  for (const sketch of state.sketches ?? []) for (const [a, b] of displayedSketchSegments(sketch, bounds, raw)) add(sketch.id)(a, b);
  for (const sum of state.sums ?? []) for (const [a, b] of displayedSumSegments(sum, raw, bounds)) add(sum.id)(a, b);
  for (const axis of axisSegments(state,bounds)) add(axis.id)(...axis.points);
  // Keep exact line/curve tangencies connected even between display mesh vertices.
  const tangencies = buildSnapTargets(raw, bounds).crossings.filter(crossing => crossing.kind === 'tangent');
  for (const contact of tangencies) for (const id of contact.ids) {
    let best;
    for (const segment of segments.filter(segment => segment.id === id)) {
      const projected = projection(contact.point, segment.a, segment.b);
      if (projected.t < -EPS || projected.t > 1 + EPS) continue;
      const error = distance(projected.point, contact.point);
      if (error <= 0.002 && (!best || error < best.error)) best = { segment, ...projected, error };
    }
    if (best) best.segment.cuts.push({ t: Math.max(0, Math.min(1, best.t)), point: contact.point });
  }
  return segments;
}

function splitAtIntersections(segments) {
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if (Math.max(a.a.x, a.b.x) < Math.min(b.a.x, b.b.x) - EPS || Math.max(b.a.x, b.b.x) < Math.min(a.a.x, a.b.x) - EPS
      || Math.max(a.a.y, a.b.y) < Math.min(b.a.y, b.b.y) - EPS || Math.max(b.a.y, b.b.y) < Math.min(a.a.y, a.b.y) - EPS) continue;
    const av = sub(a.b, a.a), bv = sub(b.b, b.a), delta = sub(b.a, a.a), denominator = cross(av, bv);
    if (Math.abs(denominator) > 1e-12 * distance(a.a, a.b) * distance(b.a, b.b)) {
      const t = cross(delta, bv) / denominator, u = cross(delta, av) / denominator;
      if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
      const point = { x: a.a.x + t * av.x, y: a.a.y + t * av.y };
      a.cuts.push({ t: Math.max(0, Math.min(1, t)), point }); b.cuts.push({ t: Math.max(0, Math.min(1, u)), point });
    } else {
      // Split coincident/overlapping strokes too; duplicate edges are merged below.
      for (const [source, target] of [[a, b], [b, a]]) for (const point of [source.a, source.b]) {
        const projected = projection(point, target.a, target.b);
        if (projected.t >= -EPS && projected.t <= 1 + EPS && distance(point, projected.point) < EPS)
          target.cuts.push({ t: Math.max(0, Math.min(1, projected.t)), point });
      }
    }
  }
}

function interiorPoint(ring) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], length = distance(a, b);
    if (length < EPS) continue;
    const middle = midpoint(a, b), offset = Math.min(length * 1e-4, 1e-5);
    const point = { x: middle.x - (b.y - a.y) / length * offset, y: middle.y + (b.x - a.x) / length * offset };
    if (pointInRing(point, ring, false)) return point;
  }
  return ring[0];
}

/** Walk bounded faces of a planar segment graph; disconnected inner loops become holes. */
export function buildFillRegions(state, bounds) {
  const segments = boundarySegments(state, bounds);
  splitAtIntersections(segments);
  const nodes = [], buckets = new Map(), edges = new Map();
  const nodeFor = point => {
    const x = Math.round(point.x / EPS), y = Math.round(point.y / EPS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const index of buckets.get(`${x + dx},${y + dy}`) ?? [])
      if (distance(nodes[index].point, point) < EPS) return index;
    const index = nodes.length, key = `${x},${y}`;
    nodes.push({ point: { ...point }, outgoing: [] });
    buckets.set(key, [...(buckets.get(key) ?? []), index]); return index;
  };
  for (const segment of segments) {
    const cuts = segment.cuts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < cuts.length; i++) {
      const a = nodeFor(cuts[i - 1].point), b = nodeFor(cuts[i].point);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) { edges.get(key).ids.add(segment.id); continue; }
      const ids = new Set([segment.id]), forward = { a, b, ids, visited: false }, reverse = { a: b, b: a, ids, visited: false };
      forward.twin = reverse; reverse.twin = forward;
      nodes[a].outgoing.push(forward); nodes[b].outgoing.push(reverse); edges.set(key, forward);
    }
  }
  for (const node of nodes) node.outgoing.sort((a, b) => {
    const p = sub(nodes[a.b].point, node.point), q = sub(nodes[b.b].point, node.point);
    return Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x);
  });
  const loops = [];
  for (const node of nodes) for (const start of node.outgoing) {
    if (start.visited) continue;
    const ring = [], ids = new Set(); let edge = start;
    do {
      edge.visited = true; ring.push(nodes[edge.a].point); for (const id of edge.ids) ids.add(id);
      const outgoing = nodes[edge.b].outgoing, index = outgoing.indexOf(edge.twin);
      edge = outgoing[(index + outgoing.length - 1) % outgoing.length];
    } while (edge !== start && !edge.visited);
    const simplified = simplifyRing(ring), area = signedArea(simplified);
    if (edge === start && area > EPS) loops.push({ ring: simplified, area, ids, probe: interiorPoint(simplified) });
  }
  const parents = loops.map((loop, index) => loops.map((parent, i) => ({ ...parent, i }))
    .filter(parent => parent.i !== index && parent.area > loop.area + EPS && pointInRing(loop.probe, parent.ring, false))
    .sort((a, b) => a.area - b.area)[0]?.i);
  return loops.map((loop, i) => {
    const children = loops.filter((_, j) => parents[j] === i), ids = new Set(loop.ids);
    for (const child of children) for (const id of child.ids) ids.add(id);
    const region = { rings: [loop.ring, ...children.map(child => child.ring)], sourceIds: [...ids].sort() };
    return { ...region, key: fillKey(region), area: loop.area - children.reduce((area, child) => area + child.area, 0) };
  }).filter(region => region.area > EPS);
}

export function findFillRegion(regions, point) {
  return regions.find(region => containsFill(region, point)) ?? null;
}

/** An interior label with room around it, respecting holes and the visible viewport. */
export function fillLabelPosition(fill, bounds = null) {
  const points = fill.rings.flat(), extent = points.reduce((box, p) => ({ xMin: Math.min(box.xMin,p.x), xMax: Math.max(box.xMax,p.x),
    yMin: Math.min(box.yMin,p.y), yMax: Math.max(box.yMax,p.y) }), { xMin:Infinity,xMax:-Infinity,yMin:Infinity,yMax:-Infinity });
  const box = {
    xMin: Math.max(bounds?.xMin ?? -Infinity, extent.xMin), xMax: Math.min(bounds?.xMax ?? Infinity, extent.xMax),
    yMin: Math.max(bounds?.yMin ?? -Infinity, extent.yMin), yMax: Math.min(bounds?.yMax ?? Infinity, extent.yMax),
  };
  if (box.xMax <= box.xMin || box.yMax <= box.yMin) return null;
  const segments = fill.rings.flatMap(ring => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]));
  let best = null;
  const consider = point => {
    if (point.x <= box.xMin || point.x >= box.xMax || point.y <= box.yMin || point.y >= box.yMax || !containsFill(fill, point)) return;
    let radius = Math.min(point.x - box.xMin, box.xMax - point.x, point.y - box.yMin, box.yMax - point.y);
    for (const [a, b] of segments) {
      const projected = projection(point, a, b), t = Math.max(0, Math.min(1, projected.t));
      radius = Math.min(radius, distance(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
    }
    if (!best || radius > best.radius) best = { ...point, radius };
  };
  const scan = y => {
    const cuts = [box.xMin, box.xMax];
    for (const [a, b] of segments) if ((a.y > y) !== (b.y > y)) {
      const x = a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (x > box.xMin && x < box.xMax) cuts.push(x);
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) consider({ x: (cuts[i - 1] + cuts[i]) / 2, y });
  };
  for (let i = 0; i < 24; i++) scan(box.yMin + (i + 0.5) / 24 * (box.yMax - box.yMin));
  // Very thin disconnected pieces can fall between the uniform scan lines.
  if (!best) {
    const ys = [...new Set([box.yMin, box.yMax, ...points.map(p => p.y).filter(y => y > box.yMin && y < box.yMax)])].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) scan((ys[i - 1] + ys[i]) / 2);
  }
  for (let step = Math.max(box.xMax - box.xMin, box.yMax - box.yMin) / 8, level = 0; best && level < 18; step /= 2, level++) {
    const origin = best;
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) consider({ x: origin.x + dx * step, y: origin.y + dy * step });
  }
  return best;
}

export function fillTouchesRectangle(fill, rectangle) {
  const corners = [{ x: rectangle.xMin, y: rectangle.yMin }, { x: rectangle.xMax, y: rectangle.yMin },
    { x: rectangle.xMax, y: rectangle.yMax }, { x: rectangle.xMin, y: rectangle.yMax }];
  return corners.some(point => containsFill(fill, point)) || fill.rings.some(ring => ring.some((point, i) =>
    clipSegment(point, ring[(i + 1) % ring.length], rectangle)));
}
