import { dragTranslation } from './movement.js';
import { angleFromSlope, slopeFromAngle, directionOf } from './math.js';
import { displayedLineSegments, lineEditingGeometry } from './display.js';
import { bendFromPoint } from './curve.js';
import { translateRuler } from './ruler.js';
import { distance, unitVector, sketchHandlePoints, translatedSketch } from './sketch.js';
import { curveFamilyOf } from '../models/curve-families.js';
import { snapMovingCurve } from './point-magnets.js';
import { snapMovingLine } from './intercepts.js';
import { snapSegmentPoint } from './segment-magnets.js';
import { OBJECT_TYPES } from '../models/object-types.js';
import { coordinateOrigins } from './axes.js';
import { chooseSnapCandidate, SNAP_RELEASE_PX } from './snap-policy.js';
import { contactTangentsAt, slopeOfDirection } from './curve-contacts.js';
import { LINE_END_ACTIONS, isTrimmed, lineParameter, rebasedExtent, rotatedExtent, visibleLineEnds } from './line-extent.js';

const LINE_MIN_PX = 24;

const deltaFor = (event, step, v) => ({
  x: (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) * v.xDirection,
  y: (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) * v.yDirection,
});
const shifted = (p, d) => ({ x: p.x + d.x, y: p.y + d.y });

/** Stateless tool contract. Results describe edits/feedback; canvas owns gesture lifetime. */
export class ShapeInteraction {
  constructor() { if (new.target === ShapeInteraction) throw new TypeError('ShapeInteraction is abstract'); }
  get movable() { return true; }
  start(object) { return object.anchor; }
  /** The edit applied when a drag begins; it also becomes the drag snapshot. */
  startPatch(object, anchor) { return { anchor }; }
  canDrag(object, action) { return this.movable && !(object.binding && action === 'move'); }
  drag() { throw new TypeError('A shape interaction must implement drag()'); }
  keyboard() { throw new TypeError('A shape interaction must implement keyboard()'); }
}

export class MovableInteraction extends ShapeInteraction {
  get marginPixels() { return 0; }
  canDrag() { return true; }
  snap(object, anchor) { return { patch: { anchor } }; }
  drag(object, action, start, point, event, ctx) {
    const margin = ctx.state.quadrantMode === 'edgeworth' ? 0 : this.marginPixels / ctx.viewport.unit;
    const moved = dragTranslation(object.anchor, start, point, event.shiftKey, ctx.viewport.bounds, margin);
    return this.snap(object, moved.anchor, moved.axis, point, event, ctx);
  }
  keyboard(object, action, event, ctx) { return { patch: { anchor: shifted(object.anchor, deltaFor(event, event.shiftKey ? 1 : 0.1, ctx.viewport)) } }; }
}
export class PointInteraction extends MovableInteraction {
  canDrag(object, action) { return !(object.binding && action === 'move'); }
  snap(object, anchor, axis, point, event, ctx) { return { patch: { anchor: ctx.snappedMove(anchor, event, axis) } }; }
}
export class StrokeInteraction extends MovableInteraction {
  get marginPixels() { return 24; }
  magnet() { throw new TypeError('A stroke interaction must implement magnet()'); }
  snap(object, anchor, axis, point, event, ctx) {
    const tangentSnap = this.magnet({ ...object, anchor }, ctx.state, ctx.viewport.bounds, ctx.viewport.unit,
      { previous: ctx.tangentSnap, reference: point, altKey: event.altKey, axis });
    return { patch: { anchor: tangentSnap?.anchor ?? anchor }, tangentSnap };
  }
}
export class LineInteraction extends StrokeInteraction {
  canDrag(object, action) {
    // Only a drawn end has a handle; an open end never starts trimming.
    if (Object.hasOwn(LINE_END_ACTIONS, action)) return object.extent?.[LINE_END_ACTIONS[action]] != null;
    return !(object.binding && action === 'move');
  }
  // A followed point stays the pivot; re-anchoring would fight the relation.
  start(object, ctx) { return object.binding ? object.anchor : lineEditingGeometry(object, displayedLineSegments(object, ctx.viewport.bounds, ctx.state))?.anchor ?? null; }
  startPatch(object, anchor) { return isTrimmed(object) ? { anchor, extent: rebasedExtent(object, anchor) } : { anchor }; }
  magnet(...args) { return snapMovingLine(...args); }
  // A segment or ray also offers its drawn ends to the shared targets.
  snap(object, anchor, axis, point, event, ctx) {
    const tangentSnap = snapMovingLine({ ...object, anchor }, ctx.state, ctx.viewport.bounds, ctx.viewport.unit,
      { previous: ctx.tangentSnap, reference: point, altKey: event.altKey, axis, targets: isTrimmed(object) ? ctx.snapTargets?.() : null });
    return { patch: { anchor: tangentSnap?.anchor ?? anchor }, tangentSnap };
  }
  drag(object, action, start, point, event, ctx) {
    if (action === 'move') return super.drag(object, action, start, point, event, ctx);
    if (Object.hasOwn(LINE_END_ACTIONS, action)) return this.dragEnd(object, LINE_END_ACTIONS[action], point, event, ctx);
    const target = event.altKey ? null : chooseSnapCandidate(this.rotationCandidates(object, point, ctx), ctx.tangentSnap);
    if (target) return { patch: this.keepEnds(object, target.rotation, start, point), tangentSnap: target };
    const dx = point.x - object.anchor.x, dy = point.y - object.anchor.y;
    if (Math.hypot(dx, dy) < 0.25) return { tangentSnap: null };
    return { patch: this.keepEnds(object, { slope: Math.abs(dx * ctx.viewport.unit) < 4 ? null : dy / dx }, start, point), tangentSnap: null };
  }
  /** Rotation keeps each drawn end at its distance from the pivot, on the side the pointer carries it. */
  keepEnds(object, rotation, start, point) {
    if (!isTrimmed(object)) return rotation;
    const pivot = rotation.anchor ?? object.anchor, d = directionOf(object.slope);
    const side = (start.x - object.anchor.x) * d.x + (start.y - object.anchor.y) * d.y < 0 ? -1 : 1;
    const heading = { x: side * (point.x - pivot.x), y: side * (point.y - pivot.y) };
    const extent = rotation.anchor ? rebasedExtent(object, pivot) : object.extent;
    return { ...rotation, extent: rotatedExtent(extent, rotation.slope, heading) };
  }
  /**
   * Drag one drawn end along the line; it meets shared targets. An end never opens or
   * closes by dragging (the kind changes only in the settings), and it stays in view.
   */
  dragEnd(object, index, point, event, ctx) {
    const { bounds, unit } = ctx.viewport, ends = visibleLineEnds({ ...object, extent: null }, bounds, ctx.state);
    const extent = [...(object.extent ?? [null, null])];
    if (!ends || extent[index] === null) return { tangentSnap: null };
    const raw = Math.max(ends.edge[0], Math.min(ends.edge[1], lineParameter(object, point))), [low, high] = ends.edge;
    const target = event.altKey ? null : snapSegmentPoint(point, ctx.snapTargets(), unit, { guide: object, points: ctx.state.points, bounds, previous: ctx.tangentSnap });
    let t = target ? lineParameter(object, target.point) : raw;
    const other = extent[1 - index] ?? (index === 1 ? low : high), minimum = LINE_MIN_PX / unit;
    t = index === 1 ? Math.max(t, other + minimum) : Math.min(t, other - minimum);
    extent[index] = t;
    return { patch: { extent }, tangentSnap: target && Math.abs(t - lineParameter(object, target.point)) < 1e-9 ? target : null };
  }
  /** Rotation magnets: Edgeworth origins, and the common tangent of a contact at the pivot. */
  rotationCandidates(object, point, ctx) {
    const { unit, bounds } = ctx.viewport, candidates = [];
    if (ctx.state.quadrantMode === 'edgeworth') {
      const origins = coordinateOrigins(ctx.state, bounds), direction = directionOf(object.slope);
      for (const origin of origins) {
        if (distance(origin.point, object.anchor) <= 1e-9) continue;
        // Preserve an origin already on the line when rotating toward the other.
        // Its stored/display editing anchor may be elsewhere on that same line.
        const pivot = origins.find(other => distance(other.point, origin.point) > 1e-9
          && Math.abs((other.point.x - object.anchor.x) * direction.y - (other.point.y - object.anchor.y) * direction.x) < 1e-9)?.point ?? object.anchor;
        const dx = origin.point.x - pivot.x, dy = origin.point.y - pivot.y;
        candidates.push({ ...origin, key: `rotate-origin:${origin.label}`, priority: 0, kind: 'intercept', axis: 'origin',
          distance: distance(point, origin.point) * unit, rotation: { anchor: { ...pivot }, slope: dx === 0 ? null : dy / dx } });
      }
    }
    // Only a contact at the pivot: the line keeps passing through it while rotating.
    for (const contact of contactTangentsAt(ctx.snapTargets().crossings, object.anchor)) {
      const t = contact.contactTangent, offset = { x: point.x - contact.point.x, y: point.y - contact.point.y };
      if (Math.hypot(offset.x, offset.y) * unit < SNAP_RELEASE_PX) continue; // No direction near the pivot.
      candidates.push({ point: { ...contact.point }, ids: contact.ids, kind: 'tangent', label: '접선 맞춤', priority: 0,
        key: `rotate-tangent:${contact.ids.join(',')}:${contact.point.x}:${contact.point.y}`,
        distance: Math.abs(offset.x * t.y - offset.y * t.x) * unit, rotation: { slope: slopeOfDirection(t) } });
    }
    return candidates;
  }
  keyboard(object, action, event, ctx) {
    if (Object.hasOwn(LINE_END_ACTIONS, action)) {
      const index = LINE_END_ACTIONS[action], ends = visibleLineEnds({ ...object, extent: null }, ctx.viewport.bounds, ctx.state);
      const extent = [...(object.extent ?? [null, null])];
      if (!ends || extent[index] === null) return null;
      const step = (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 1 : 0.1);
      const other = extent[1 - index] ?? (index === 1 ? ends.edge[0] : ends.edge[1]), minimum = LINE_MIN_PX / ctx.viewport.unit;
      const t = Math.max(ends.edge[0], Math.min(ends.edge[1], extent[index] + step));
      extent[index] = index === 1 ? Math.max(t, other + minimum) : Math.min(t, other - minimum);
      return { patch: { extent } };
    }
    if (action !== 'rotate') return super.keyboard(object, action, event, ctx);
    let angle = angleFromSlope(object.slope) + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 1 : 0.1);
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return { patch: { slope: slopeFromAngle(angle) } };
  }
}
export class CurveInteraction extends StrokeInteraction {
  magnet(...args) { return snapMovingCurve(...args); }
  drag(object, action, start, point, event, ctx) {
    return action === 'bend' ? { patch: { bend: bendFromPoint(object, point) } } : super.drag(object, action, start, point, event, ctx);
  }
  keyboard(object, action, event, ctx) {
    return action === 'bend' ? { patch: { bend: object.bend + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 0.05 : 0.01) } }
      : super.keyboard(object, action, event, ctx);
  }
}
export class AnalyticInteraction extends CurveInteraction {
  drag(object, action, start, point, event, ctx) {
    const family = curveFamilyOf(object);
    if (family.isEndpointAction(action)) return { patch: family.endpointPatch(object, action.slice(-1), point[action.slice(-1)]) };
    if (action === 'ic-shape') return { patch: family.shapeFromPoint(object, point) };
    if (action === 'ic-origin') return { patch: { oppositeOrigin: dragTranslation(object.oppositeOrigin, start, point, event.shiftKey).anchor } };
    const moved = dragTranslation(object.anchor, start, point, event.shiftKey);
    // Family movement owns radial/linear-axis constraints; it takes precedence over Shift.
    const anchor = family.move(object, start, point, moved.axis);
    return this.snap(object, anchor, null, point, event, ctx);
  }
  keyboard(object, action, event, ctx) {
    const family = curveFamilyOf(object), step = event.shiftKey ? 1 : 0.1;
    if (family.isEndpointAction(action)) {
      const key = action.slice(-1), delta = deltaFor(event, step, ctx.viewport);
      return { patch: family.endpointPatch(object, key, object.anchor[key] * Math.SQRT2 + delta[key]) };
    }
    if (action === 'ic-shape') return { patch: family.shapeKeyPatch(object, ['ArrowUp', 'ArrowRight'].includes(event.key), step) };
    if (action === 'ic-origin') return { patch: { oppositeOrigin: shifted(object.oppositeOrigin, deltaFor(event, step, ctx.viewport)) } };
    return MovableInteraction.prototype.keyboard.call(this, object, action, event, ctx);
  }
}
export class SketchInteraction extends MovableInteraction {
  lockedAnchor(curve, anchor, axis, state) {
    if (!axis || !curve.binding) return anchor;
    const line = state.lines.find(line => line.id === curve.binding.sourceId), direction = line && directionOf(line.slope), locked = axis === 'x' ? 'y' : 'x';
    return direction && direction[locked] === 0 ? anchor : curve.anchor;
  }
  drag(curve, action, start, point, event, ctx) {
    if (action === 'move') {
      const moved = dragTranslation(curve.anchor, start, point, event.shiftKey);
      if (curve.binding) return { patch: { anchor: this.lockedAnchor(curve, moved.anchor, moved.axis, ctx.state), translate: true }, tangentSnap: null };
      const raw = { ...curve, ...translatedSketch(curve, { x: moved.anchor.x - curve.anchor.x, y: moved.anchor.y - curve.anchor.y }) };
      const tangentSnap = snapMovingCurve(raw, ctx.state, ctx.viewport.bounds, ctx.viewport.unit,
        { previous: ctx.tangentSnap, reference: point, altKey: event.altKey, axis: moved.axis });
      const anchor = tangentSnap?.anchor ?? moved.anchor;
      return { patch: { ...translatedSketch(curve, { x: anchor.x - curve.anchor.x, y: anchor.y - curve.anchor.y }), translate: true }, tangentSnap };
    }
    const key = action.replace('sketch-', '');
    if (['start', 'end', 'middle'].includes(key)) {
      const origin = key === 'middle' ? curve.anchor : curve[key];
      const moved = event.shiftKey ? dragTranslation(origin, start ?? origin, point, true) : { anchor: point, axis: null };
      let anchor = ctx.snappedMove(moved.anchor, event, moved.axis);
      if (key === 'middle') anchor = this.lockedAnchor(curve, anchor, moved.axis, ctx.state);
      return { patch: { [key === 'middle' ? 'anchor' : key]: anchor } };
    }
    if (key === 'tangent') return distance(point, curve.anchor) > 1e-6 ? { patch: { tangent: { x: point.x - curve.anchor.x, y: point.y - curve.anchor.y } } } : null;
    if (key === 'leftReach' || key === 'rightReach') {
      const endpoint = key === 'leftReach' ? curve.start : curve.end, sign = key === 'leftReach' ? -1 : 1, direction = unitVector(curve.tangent);
      const length = sign * ((point.x - curve.anchor.x) * direction.x + (point.y - curve.anchor.y) * direction.y);
      return { patch: { [key]: length / distance(endpoint, curve.anchor) } };
    }
    return null;
  }
  keyboard(curve, action, event, ctx) {
    const key = action.replace('sketch-', ''), origin = sketchHandlePoints(curve)[key] ?? curve.anchor;
    return this.drag(curve, action, origin, shifted(origin, deltaFor(event, event.shiftKey ? 1 : 0.1, ctx.viewport)),
      { key: event.key, shiftKey: event.shiftKey, altKey: true }, ctx);
  }
}
export class SelectionInteraction extends ShapeInteraction {
  get movable() { return false; }
  drag() { return null; }
  keyboard() { return null; }
}

export function assertInteractionHandlers(entries) {
  const expected = [...Object.keys(OBJECT_TYPES), 'analytic'].sort();
  if (JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify(expected)) throw new TypeError('Every object type must register an interaction handler');
  for (const [type, handler] of Object.entries(entries)) {
    if (!(handler instanceof ShapeInteraction)) throw new TypeError(`Invalid interaction handler: ${type}`);
    for (const method of ['drag', 'keyboard']) if (typeof handler[method] !== 'function' || handler[method] === ShapeInteraction.prototype[method]) throw new TypeError(`${type} must implement ${method}()`);
    if (handler instanceof StrokeInteraction && (typeof handler.magnet !== 'function' || handler.magnet === StrokeInteraction.prototype.magnet)) throw new TypeError(`${type} must implement magnet()`);
  }
  return Object.freeze(entries);
}
export const INTERACTION_HANDLERS = assertInteractionHandlers({ line: new LineInteraction(), curve: new CurveInteraction(), analytic: new AnalyticInteraction(), sketch: new SketchInteraction(),
  point: new PointInteraction(), fill: new MovableInteraction(), sum: new SelectionInteraction(), group: new SelectionInteraction(), ruler: new SelectionInteraction() });
export function interactionFor(object) {
  const key = curveFamilyOf(object) ? 'analytic' : object.type;
  if (!Object.hasOwn(INTERACTION_HANDLERS, key)) throw new TypeError(`Missing interaction handler: ${key}`);
  return INTERACTION_HANDLERS[key];
}
