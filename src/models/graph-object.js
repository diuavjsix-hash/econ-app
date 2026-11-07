import { validPoint } from '../graph/ruler.js';
import { OBJECT_TYPES } from './object-types.js';
import { directionOf } from '../graph/math.js';

/** Abstract adapter over a plain document object; never store adapters in state. */
export class GraphObject {
  static requiredMethods = ['updateGeometry'];
  constructor(data) {
    if (new.target === GraphObject) throw new TypeError('GraphObject is abstract');
    this.data = data;
  }
  get spec() { return OBJECT_TYPES[this.data.type]; }
  get duplicatable() { return this.spec.duplicatable; }
  get serializedFields() { return ['id', 'type', 'name', 'color', 'parentId']; }
  fields(keys = this.serializedFields) { return Object.fromEntries(keys.map(key => [key, structuredClone(this.data[key])])); }
  serialize() { return this.fields(); }
  applyPatch(patch, state) {
    if (typeof patch.name === 'string') this.data.name = patch.name.slice(0, 80);
    this.updateGeometry(patch, state);
  }
  updateGeometry() { throw new TypeError(`${this.constructor.name} must implement updateGeometry()`); }
  visiblePieces() { throw new TypeError(`${this.constructor.name} does not provide a canvas stroke`); }
  touchesRectangle() { return false; }
  highlightGeometry() { return null; }
  nearbyOffset() { return { x: 1, y: 0 }; }
  translate() { throw new TypeError(`${this.constructor.name} does not support translation`); }
  duplicate({ slopeFactor = 1 } = {}) {
    if (!this.duplicatable) return { error: '복제할 도형을 선택해 주세요.' };
    if (![0.5, 1, 2].includes(slopeFactor)) return { error: '복제 기울기를 확인해 주세요.' };
    const object = structuredClone(this.data);
    if ('binding' in object) object.binding = null;
    object.name = `${(object.name || this.spec.label).slice(0, 79)}′`;
    object.collapsed = false;
    return this.transformDuplicate(object, { slopeFactor });
  }
  transformDuplicate(object) { return { object, error: null }; }
  sameGeometry(other) {
    const a = this.data, b = other;
    if (a.type !== b.type || !a.anchor || !b.anchor) return false;
    for (const key of ['anchor', 'start', 'end', 'tangent', 'oppositeOrigin']) {
      if (Boolean(a[key]) !== Boolean(b[key])) return false;
      if (a[key] && Math.hypot(a[key].x - b[key].x, a[key].y - b[key].y) > 1e-8) return false;
    }
    return ['slope', 'span', 'bend', 'leftReach', 'rightReach', 'family', 'shape', 'linearAxis', 'orientation'].every(key => a[key] === b[key]);
  }
}

/** Visible objects share rectangle hit-testing and feedback geometry. */
export class DrawableObject extends GraphObject {
  static requiredMethods = [...GraphObject.requiredMethods, 'visiblePieces'];
  constructor(data) { super(data); if (new.target === DrawableObject) throw new TypeError('DrawableObject is abstract'); }
  get quadratic() { return false; }
  touchesRectangle(rectangle, state) { return this.visiblePieces(rectangle, state).length > 0; }
  highlightGeometry(bounds, state) { return { kind: 'path', pieces: this.visiblePieces(bounds, state), quadratic: this.quadratic }; }
}

/** Shared coordinate validation, normalized anchors and independent translated copies. */
export class MovableObject extends DrawableObject {
  constructor(data) { super(data); if (new.target === MovableObject) throw new TypeError('MovableObject is abstract'); }
  updateGeometry(patch) { this.updateAnchor(patch.anchor); }
  updateAnchor(anchor) {
    if (validPoint(anchor)) this.data.anchor = { x: anchor.x === 0 ? 0 : anchor.x, y: anchor.y === 0 ? 0 : anchor.y };
  }
  translatedAnchor(point) { return point; }
  translate(offset) {
    const copy = structuredClone(this.data);
    for (const key of ['anchor', 'start', 'end']) if (copy[key]) {
      const point = { x: copy[key].x + offset.x, y: copy[key].y + offset.y };
      copy[key] = key === 'anchor' ? this.translatedAnchor(point) : point;
      if (!validPoint(copy[key])) return null;
    }
    return copy;
  }
}

/** Movable strokes share the normal direction used for nearby copies. */
export class StrokeObject extends MovableObject {
  constructor(data) { super(data); if (new.target === StrokeObject) throw new TypeError('StrokeObject is abstract'); }
  nearbyOffset() {
    const slope = this.copySlope;
    if (slope === undefined) return super.nearbyOffset();
    const d = directionOf(slope), sign = d.y > 0 ? -1 : 1;
    return { x: -d.y * sign, y: d.x * sign };
  }
  get copySlope() { return this.data.slope; }
}
