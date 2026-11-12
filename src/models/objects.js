import { GraphObject, DrawableObject, MovableObject, StrokeObject } from './graph-object.js';
import { curveFamilyOf, orientCurve, isOppositeCurve } from './curve-families.js';
import { directionOf, normalizeSlope, interceptOf } from '../graph/math.js';
import { CURVE_PRESETS, MAX_BEND, curveControlPoints, curveTangentRays } from '../graph/curve.js';
import { displayedLineSegments, displayedCurveSegments } from '../graph/display.js';
import { sketchControls, displayedSketchSegments, validSketch, unitVector, translatedSketch, projectOnLine } from '../graph/sketch.js';
import { displayedSumSegments } from '../graph/sum.js';
import { clipSegment, validPoint, rulerMetrics } from '../graph/ruler.js';
import { validFill, fillTouchesRectangle } from '../graph/fill.js';
import { OBJECT_TYPES } from './object-types.js';
import { lineColor } from './palette.js';
import { isTrimmed, lineEndPoints, normalizeExtent, rotatedExtent } from '../graph/line-extent.js';

export const LINE_STYLES = Object.freeze(['solid', 'dashed']);
import { objectsOf } from '../objects.js';
import { assertModelContract, assertRegistryContract } from './contracts.js';

export class LineObject extends StrokeObject {
  visiblePieces(bounds, state) { return displayedLineSegments(this.data, bounds, state); }
  updateGeometry(patch) {
    const before = { slope: this.data.slope, extent: this.data.extent ?? null };
    super.updateGeometry(patch);
    if ('slope' in patch && !this.data.link) {
      this.data.slope = normalizeSlope(patch.slope);
      // Without an explicit extent, keep the ends on the side nearest their old direction.
      if (!('extent' in patch) && before.extent) this.setExtent(rotatedExtent(before.extent, this.data.slope, directionOf(before.slope)));
    }
    if ('extent' in patch) this.setExtent(patch.extent);
    if (LINE_STYLES.includes(patch.style) && patch.style !== (this.data.style ?? 'solid')) {
      // Switching style also switches to that style's default color: dashed gray, solid by number.
      this.data.style = patch.style;
      this.data.color = lineColor(Number(/^line-(\d+)$/.exec(this.data.id)?.[1] ?? 1) - 1, patch.style);
    }
  }
  setExtent(extent) {
    const value = normalizeExtent(extent);
    if (value === undefined) return;
    if (value) this.data.extent = value; else delete this.data.extent;
  }
  sameGeometry(other) {
    const a = this.data, b = other;
    if (b.type !== a.type || !a.anchor || !b.anchor) return false;
    const ends = lineEndPoints(b);
    if (!lineEndPoints(a).every((p, i) => p === null ? ends[i] === null : ends[i] !== null && Math.hypot(p.x - ends[i].x, p.y - ends[i].y) < 1e-8)) return false;
    const d = directionOf(a.slope), e = directionOf(b.slope);
    return Math.abs(d.x * e.y - d.y * e.x) < 1e-10 && Math.abs((a.anchor.x - b.anchor.x) * d.y - (a.anchor.y - b.anchor.y) * d.x) < 1e-8;
  }
  transformDuplicate(object, { slopeFactor }) {
    delete object.link; // A copy is a plain line of this graph.
    if (object.slope !== null) {
      const slope = object.slope * slopeFactor;
      if (!Number.isFinite(slope) || (object.slope !== 0 && slope === 0)) return { error: '이 기울기는 숫자 범위를 벗어납니다.' };
      object.slope = slope;
    }
    return super.transformDuplicate(object);
  }
  serialize() {
    const line = this.data, direction = directionOf(line.slope);
    const [start, end] = lineEndPoints(line);
    return { ...super.serialize(), slope: line.slope, intercept: interceptOf(line), anchor: { ...line.anchor },
      style: line.style ?? 'solid', ...(isTrimmed(line) ? { extent: [...line.extent], segment: { start, end } } : {}),
      ...(line.binding ? { binding: { ...line.binding } } : {}), ...(line.link ? { link: { ...line.link } } : {}), vertical: line.slope === null, xIntercept: line.slope === null ? line.anchor.x : null,
      implicit: { a: -direction.y, b: direction.x, c: direction.y * line.anchor.x - direction.x * line.anchor.y } };
  }
}

export class CurveObject extends StrokeObject {
  get quadratic() { return true; }
  get serializedFields() { return ['id', 'type', 'name', 'color', 'variant', 'parentId']; }
  visiblePieces(bounds, state) { return displayedCurveSegments(this.data, bounds, state); }
  updateGeometry(patch) {
    super.updateGeometry(patch);
    const c = this.data;
    if (Object.hasOwn(CURVE_PRESETS, patch.variant)) {
      c.variant = patch.variant; c.slope = CURVE_PRESETS[patch.variant].slope; c.color = CURVE_PRESETS[patch.variant].color;
    }
    if (Number.isFinite(patch.bend)) c.bend = Math.max(0, Math.min(MAX_BEND, patch.bend));
  }
  serialize() {
    const c = this.data;
    return { ...super.serialize(), anchor: { ...c.anchor }, span: c.span, slope: c.slope, bend: c.bend,
      geometry: { type: 'quadratic-bezier', controlPoints: curveControlPoints(c), extensions: { type: 'tangent-rays', rays: curveTangentRays(c) } } };
  }
}

export class AnalyticCurveObject extends CurveObject {
  get family() { return curveFamilyOf(this.data); }
  get serializedFields() { return ['id', 'type', 'name', 'color', 'parentId']; }
  updateGeometry(patch) {
    const c = this.data;
    if (typeof patch.opposite === 'boolean') orientCurve(c, patch.opposite, patch.oppositeOrigin);
    // Moving an opposite curve's origin carries the whole drawing with it.
    else if (isOppositeCurve(c) && validPoint(patch.oppositeOrigin)) {
      const dx = patch.oppositeOrigin.x - c.oppositeOrigin.x, dy = patch.oppositeOrigin.y - c.oppositeOrigin.y;
      c.oppositeOrigin = { ...patch.oppositeOrigin }; c.anchor = { x: c.anchor.x + dx, y: c.anchor.y + dy };
      return;
    }
    this.family.applyPatch(c, patch);
  }
  translatedAnchor(point) { return this.family.move(this.data, this.data.anchor, point); }
  nearbyOffset() { return this.family.nearbyOffset(this.data); }
  serialize() {
    const c = this.data;
    return { ...this.fields(), family: c.family, anchor: { ...c.anchor }, shape: c.shape,
      ...(c.family === 'quasilinear' ? { linearAxis: c.linearAxis } : {}),
      ...(isOppositeCurve(c) ? { orientation: 'opposite', oppositeOrigin: { ...c.oppositeOrigin } } : {}), geometry: this.family.geometry(c) };
  }
}

export class SketchObject extends StrokeObject {
  visiblePieces(bounds, state) { return displayedSketchSegments(this.data, bounds, state); }
  updateGeometry(patch, state) {
    const object = this.data, next = structuredClone(object);
    if (validPoint(patch.anchor)) {
      const desired = object.binding && patch.translate ? projectOnLine(patch.anchor, state.lines.find(line => line.id === object.binding.sourceId)).point : patch.anchor;
      if (patch.translate) Object.assign(next, translatedSketch(object, { x: desired.x - object.anchor.x, y: desired.y - object.anchor.y }));
      else next.anchor = { ...patch.anchor };
    }
    for (const key of ['start', 'end']) if (validPoint(patch[key])) next[key] = { ...patch[key] };
    if (validPoint(patch.tangent) && !object.binding) next.tangent = unitVector(patch.tangent);
    for (const key of ['leftReach', 'rightReach']) if (Number.isFinite(patch[key])) next[key] = Math.max(0.05, Math.min(2, patch[key]));
    if (typeof patch.showMinimum === 'boolean') next.showMinimum = patch.showMinimum;
    if (next.binding && validPoint(patch.anchor)) {
      const line = state.lines.find(line => line.id === next.binding.sourceId), projection = projectOnLine(next.anchor, line);
      next.anchor = projection.point; next.binding.parameter = projection.parameter; next.binding.direction = directionOf(line.slope);
    }
    if (validSketch(next)) Object.assign(object, next);
  }
  serialize() {
    const { collapsed, ...curve } = this.data;
    return { ...structuredClone(curve), geometry: { type: 'piecewise-quadratic-bezier', controlPoints: structuredClone(sketchControls(curve)) } };
  }
}

export class PointObject extends MovableObject {
  static requiredMethods = GraphObject.requiredMethods; // Point geometry uses a circle, not stroke pieces.
  updateGeometry(patch) {
    super.updateGeometry(patch);
    if (typeof patch.showCoordinates === 'boolean') this.data.showCoordinates = patch.showCoordinates;
  }
  touchesRectangle(r) { const p = this.data.anchor; return p.x >= r.xMin && p.x <= r.xMax && p.y >= r.yMin && p.y <= r.yMax; }
  highlightGeometry() { return { kind: 'point', point: this.data.anchor }; }
  serialize() {
    const p = this.data;
    return { ...super.serialize(), anchor: { ...p.anchor }, showCoordinates: Boolean(p.showCoordinates), ...(p.binding ? { binding: { ...p.binding } } : {}) };
  }
}

/** Dashed lines and the retired ruler share finite endpoints and validation. */
export class SegmentObject extends StrokeObject {
  constructor(data) { super(data); if (new.target === SegmentObject) throw new TypeError('SegmentObject is abstract'); }
  visiblePieces(bounds) { const segment = clipSegment(this.data.anchor, this.data.end, bounds); return segment ? [segment] : []; }
  updateGeometry(patch) {
    const object = this.data, anchor = validPoint(patch.anchor) ? patch.anchor : object.anchor, end = validPoint(patch.end) ? patch.end : object.end;
    const length = rulerMetrics({ anchor, end }).length;
    if (Number.isFinite(length) && length >= 1e-8) { object.anchor = { ...anchor }; object.end = { ...end }; }
  }
  get copySlope() { const c = this.data; return c.end.x === c.anchor.x ? null : (c.end.y - c.anchor.y) / (c.end.x - c.anchor.x); }
  serialize() { return { ...super.serialize(), anchor: { ...this.data.anchor }, end: { ...this.data.end } }; }
}
export class RulerObject extends SegmentObject {
  touchesRectangle() { return false; }
  highlightGeometry() { return null; }
  updateGeometry(patch) {
    super.updateGeometry(patch);
    if (['solid', 'dashed'].includes(patch.style)) this.data.style = patch.style;
    if (typeof patch.showMeasurement === 'boolean') this.data.showMeasurement = patch.showMeasurement;
  }
  serialize() { return { ...super.serialize(), style: this.data.style, showMeasurement: this.data.showMeasurement }; }
}

export class FillObject extends MovableObject {
  static requiredMethods = GraphObject.requiredMethods; // Filled rings have their own hit test.
  highlightGeometry() { return null; }
  translate(offset) {
    const copy = super.translate(offset);
    if (!copy) return null;
    copy.rings = copy.rings.map(ring => ring.map(p => ({ x: p.x + offset.x, y: p.y + offset.y })));
    return validFill(copy) ? copy : null;
  }
  updateGeometry(patch) {
    const object = this.data;
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) object.color = patch.color;
    if (Number.isFinite(patch.opacity)) object.opacity = Math.max(0.1, Math.min(0.6, patch.opacity));
    if (validPoint(patch.anchor)) {
      const moved = this.translate({ x: patch.anchor.x - object.anchor.x, y: patch.anchor.y - object.anchor.y });
      if (moved) { object.rings = moved.rings; object.anchor = { ...patch.anchor }; }
    }
  }
  touchesRectangle(r) { return fillTouchesRectangle(this.data, r); }
  serialize() {
    const f = this.data;
    return { ...this.fields(['id', 'type', 'name']), ...(f.label ? { label: f.label } : {}), ...this.fields(['color', 'opacity', 'parentId', 'anchor', 'rings']) };
  }
}

export class SumObject extends DrawableObject {
  get serializedFields() { return ['id', 'type', 'name', 'color', 'parentId', 'direction', 'nonnegative', 'sourceIds']; }
  visiblePieces(bounds, state) { return displayedSumSegments(this.data, state, bounds); }
  updateGeometry(patch) { if (typeof patch.nonnegative === 'boolean') this.data.nonnegative = patch.nonnegative; }
}
export class GroupObject extends GraphObject {
  updateGeometry() {} // A folder deliberately exposes name/hierarchy editing only.
  get serializedFields() { return ['id', 'type', 'name', 'parentId']; }
}

export const OBJECT_MODELS = assertRegistryContract({ line: LineObject, curve: CurveObject, sketch: SketchObject, sum: SumObject, point: PointObject, fill: FillObject, ruler: RulerObject, group: GroupObject }, OBJECT_TYPES);
assertModelContract(AnalyticCurveObject);
export function objectModel(data, collectionType = data?.type) {
  if (!data || !Object.hasOwn(OBJECT_MODELS, collectionType)) throw new TypeError(`Unknown graph object type: ${collectionType}`);
  const Model = collectionType === 'curve' && curveFamilyOf(data) ? AnalyticCurveObject : OBJECT_MODELS[collectionType];
  return new Model(data.type ? data : { ...data, type: collectionType });
}
/** Read adapters also accept minimal geometry fixtures whose collection supplies the type. */
export function objectModelsOf(state) {
  const types = new Map(Object.entries(OBJECT_TYPES).flatMap(([type, spec]) => (state[spec.collection] ?? []).map(data => [data, type])));
  return objectsOf(state).map(data => objectModel(data, data.type ?? types.get(data)));
}
