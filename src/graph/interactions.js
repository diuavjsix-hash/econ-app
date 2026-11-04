import { dragTranslation } from './movement.js';
import { angleFromSlope, slopeFromAngle, directionOf } from './math.js';
import { displayedLineSegments, lineEditingGeometry } from './display.js';
import { bendFromPoint } from './curve.js';
import { translateRuler } from './ruler.js';
import { distance, unitVector, sketchHandlePoints, translatedSketch } from './sketch.js';
import { curveFamilyOf } from '../models/curve-families.js';
import { snapMovingCurve } from './point-magnets.js';
import { snapMovingLine } from './intercepts.js';
import { snapMovingDashed } from './dashed-magnets.js';
import { OBJECT_TYPES } from '../models/object-types.js';

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
  canDrag(object, action) { return this.movable && !(object.binding && action === 'move'); }
  drag() { throw new TypeError('A shape interaction must implement drag()'); }
  keyboard() { throw new TypeError('A shape interaction must implement keyboard()'); }
}

export class MovableInteraction extends ShapeInteraction {
  get marginPixels() { return 0; }
  canDrag() { return true; }
  snap(object, anchor) { return { patch: { anchor } }; }
  drag(object, action, start, point, event, ctx) {
    const moved = dragTranslation(object.anchor, start, point, event.shiftKey, ctx.viewport.bounds, this.marginPixels / ctx.viewport.unit);
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
  canDrag(object, action) { return !(object.binding && action === 'move'); }
  start(object, ctx) { return lineEditingGeometry(object, displayedLineSegments(object, ctx.viewport.bounds, ctx.state))?.anchor ?? null; }
  magnet(...args) { return snapMovingLine(...args); }
  drag(object, action, start, point, event, ctx) {
    if (action === 'move') return super.drag(object, action, start, point, event, ctx);
    const dx = point.x - object.anchor.x, dy = point.y - object.anchor.y;
    if (Math.hypot(dx, dy) < 0.25) return null;
    return { patch: { slope: Math.abs(dx * ctx.viewport.unit) < 4 ? null : dy / dx } };
  }
  keyboard(object, action, event, ctx) {
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
    return MovableInteraction.prototype.keyboard.call(this, object, action, event, ctx);
  }
}
export class DashedInteraction extends MovableInteraction {
  drag(object, action, start, point, event, ctx) {
    if (action !== 'move') {
      const key = action === 'start' ? 'anchor' : 'end', moved = dragTranslation(object[key], start, point, event.shiftKey, ctx.viewport.bounds);
      return { patch: { [key]: ctx.dashedPosition(moved.anchor, event, moved.axis) } };
    }
    const moved = dragTranslation(object.anchor, start, point, event.shiftKey);
    const geometry = translateRuler(object, { x: moved.anchor.x - object.anchor.x, y: moved.anchor.y - object.anchor.y }, ctx.viewport.bounds);
    const dashedSnap = snapMovingDashed({ ...object, ...geometry }, ctx.dashedTargets(), ctx.viewport.unit, ctx.dashedOptions(event, moved.axis));
    return { patch: dashedSnap?.geometry ?? geometry, dashedSnap };
  }
  keyboard(object, action, event, ctx) {
    const delta = deltaFor(event, event.shiftKey ? 1 : 0.1, ctx.viewport);
    if (action === 'move') return { patch: translateRuler(object, delta, ctx.viewport.bounds) };
    const key = action === 'start' ? 'anchor' : 'end', point = shifted(object[key], delta), b = ctx.viewport.bounds;
    return { patch: { [key]: { x: Math.max(b.xMin, Math.min(b.xMax, point.x)), y: Math.max(b.yMin, Math.min(b.yMax, point.y)) } } };
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
  dashed: new DashedInteraction(), point: new PointInteraction(), fill: new MovableInteraction(), sum: new SelectionInteraction(), group: new SelectionInteraction(), ruler: new SelectionInteraction() });
export function interactionFor(object) {
  const key = curveFamilyOf(object) ? 'analytic' : object.type;
  if (!Object.hasOwn(INTERACTION_HANDLERS, key)) throw new TypeError(`Missing interaction handler: ${key}`);
  return INTERACTION_HANDLERS[key];
}
