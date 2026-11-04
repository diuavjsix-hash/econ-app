import { clipLine } from '../graph/math.js';
import { clipSegment, validPoint } from '../graph/ruler.js';
import { ppcValue, clipPpc, ppcContact, ppcThroughPoint, ppcOnLine, ppcLineIntersections, ppcRadii } from '../graph/ppc.js';

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const quadratic = ([a, b]) => [a, midpoint(a, b), b];
const clampShape = value => Math.max(0.15, Math.min(20, value));
const shapePatch = value => Number.isFinite(value) && value > 0 ? { shape: clampShape(value) } : {};
export const linearAxisOf = c => c.linearAxis === 'x' ? 'x' : 'y';

/** Abstract behavior, kept outside the plain document/undo/JSON data. */
export class AnalyticCurveFamily {
  constructor(metadata) {
    if (new.target === AnalyticCurveFamily) throw new TypeError('AnalyticCurveFamily is abstract');
    this.metadata = Object.freeze(metadata);
  }
  get radial() { return false; }
  get reshapesAnchor() { return false; }
  get editableShape() { return true; }
  get contactGeometry() { return 'smooth'; }
  movement() { return this.metadata.movement; }
  value() { throw new TypeError('A curve family must implement value()'); }
  contact() { throw new TypeError('A curve family must implement contact()'); }
  tangentVector() { return null; } // A kink has no single smooth tangent.
  get translationAxis() { return null; }
  moveAnchor() { throw new TypeError('A curve family must implement moveAnchor()'); }
  fitPoint() { throw new TypeError('A curve family must implement fitPoint()'); }
  fitLine() { throw new TypeError('A curve family must implement fitLine()'); }
  move(c, start, point, axis = null) {
    return validPoint(start) && validPoint(point) ? this.moveAnchor(c, start, point, axis) : { ...c.anchor };
  }
  moveDistance(c, anchor) { return Math.hypot(anchor.x - c.anchor.x, anchor.y - c.anchor.y); }
  throughPoint(c, point) { return validPoint(point) && point.x >= 0 && point.y >= 0 ? this.fitPoint(c, point) : null; }
  onLine(c, line, reference = c.anchor) {
    const contact = this.contact(c, line.slope, reference);
    if (!contact) return null;
    const anchor = this.fitLine(c, line, contact);
    if (!validPoint(anchor)) return null;
    const point = this.contact({ ...c, anchor }, line.slope, reference);
    return validPoint(point) && point.x >= 0 && point.y >= 0 ? { anchor, point } : null;
  }
  swapped() { return false; }
  includesZero() { return false; }
  pointAt(c, t) { return this.swapped(c) ? { x: this.value(c, t, 'horizontal'), y: t } : { x: t, y: this.value(c, t) }; }
  parameterRange(c, bounds) {
    const swap = this.swapped(c), key = swap ? 'y' : 'x', other = swap ? 'x' : 'y';
    let low = Math.max(0, bounds[`${key}Min`]), high = bounds[`${key}Max`];
    if (!this.includesZero()) low = Math.max(Number.MIN_VALUE, low);
    const inverse = v => this.value(c, v, swap ? 'vertical' : 'horizontal');
    const from = inverse(bounds[`${other}Max`]), to = inverse(Math.max(0, bounds[`${other}Min`]));
    if (Number.isFinite(from)) low = Math.max(low, from);
    if (Number.isFinite(to)) high = Math.min(high, to);
    return low < high && Number.isFinite(low) && Number.isFinite(high) ? [low, high] : null;
  }
  /** Shared adaptive display. Exact contacts never use these display chords. */
  clip(c, bounds) {
    const positive = { xMin: Math.max(0, bounds.xMin), yMin: Math.max(0, bounds.yMin), xMax: bounds.xMax, yMax: bounds.yMax };
    return positive.xMin >= positive.xMax || positive.yMin >= positive.yMax ? [] : this.clipPositive(c, positive);
  }
  clipPositive(c, bounds) {
    const range = this.parameterRange(c, bounds), segments = [];
    if (!range) return segments;
    const split = (low, high, depth = 0) => {
      const a = this.pointAt(c, low), b = this.pointAt(c, high), mid = this.pointAt(c, (low + high) / 2);
      if (![a, b, mid].every(validPoint)) return;
      const chord = midpoint(a, b);
      if (Math.hypot(mid.x - chord.x, mid.y - chord.y) > 0.0005 && depth < 18) {
        split(low, (low + high) / 2, depth + 1); split((low + high) / 2, high, depth + 1);
      } else segments.push(quadratic([a, b]));
    };
    split(...range); return segments;
  }
  criticalParameter(c, line) { return this.contact(c, line.slope)?.[this.swapped(c) ? 'y' : 'x']; }
  coincident() { return false; }
  /** Smooth families share bracketing and exact tangent/double-root handling. */
  lineIntersections(c, line, bounds) {
    if (line.slope === null) {
      const point = { x: line.anchor.x, y: this.value(c, line.anchor.x) };
      return validPoint(point) && point.x >= 0 && point.y >= 0 && point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax ? [{ point, kind: 'intersection' }] : [];
    }
    const range = this.parameterRange(c, { ...bounds, xMin: Math.max(0, bounds.xMin), yMin: Math.max(0, bounds.yMin) });
    if (!range) return [];
    const residual = t => { const p = this.pointAt(c, t); return p.y - line.anchor.y - line.slope * (p.x - line.anchor.x); };
    const critical = this.criticalParameter(c, line);
    const cuts = [range[0], ...(critical > range[0] && critical < range[1] ? [critical] : []), range[1]], found = [];
    const add = (t, kind) => { const point = this.pointAt(c, t); if (!found.some(v => Math.hypot(v.point.x - point.x, v.point.y - point.y) < 1e-7)) found.push({ point, kind }); };
    const tolerance = 1e-10 * Math.max(1, Math.abs(line.anchor.y), Math.abs(line.slope) * bounds.xMax);
    if (this.coincident(c, line)) return [];
    for (const t of cuts) if (Math.abs(residual(t)) < tolerance) add(t, Math.abs(t - critical) < 1e-9 ? 'tangent' : 'intersection');
    for (let i = 1; i < cuts.length; i++) {
      let low = cuts[i - 1], high = cuts[i], f = residual(low), g = residual(high);
      if (Math.abs(f) < tolerance || Math.abs(g) < tolerance || f * g >= 0) continue;
      for (let n = 0; n < 64; n++) { const mid = (low + high) / 2; if (f * residual(mid) <= 0) high = mid; else { low = mid; f = residual(mid); } }
      add((low + high) / 2, 'intersection');
    }
    return found;
  }
  shapeHandle(c, bounds = null) {
    const key = this.swapped(c) ? 'y' : 'x', range = bounds && this.parameterRange(c, bounds);
    let t = c.anchor[key] * 1.6;
    if (range) { const origin = Math.max(range[0], Math.min(range[1], c.anchor[key])); t = range[1] - origin > origin - range[0] ? origin + (range[1] - origin) * 0.4 : origin - (origin - range[0]) * 0.4; }
    return this.pointAt(c, t);
  }
  shapeValue(c) { return c.shape; }
  isEndpointAction() { return false; }
  endpointHandles() { return []; }
  endpointPatch() { throw new TypeError('This curve family has no endpoint editor'); }
  shapeKeyPatch(c, positive) { return { shape: c.shape * (positive ? 1.05 : 1 / 1.05) }; }
  reshapeKeyPatch(c, positive, step) {
    const p = this.shapeHandle(c); p.y += positive ? step : -step;
    return this.shapeFromPoint(c, p);
  }
  shapeFromValue(c, value) { return { shape: value }; }
  shapeFromPoint() { throw new TypeError('A curve family must implement shapeFromPoint()'); }
  nearbyOffset() { return { x: 1, y: 0 }; }
  geometry(c) { return { type: 'indifference', domain: 'nonnegative', movement: this.movement(c) }; }
  applyPatch(c, patch) {
    if (validPoint(patch.anchor)) {
      const next = patch.reshape && this.reshapesAnchor ? patch.anchor : this.move(c, c.anchor, patch.anchor);
      if (validPoint(next) && (!this.radial || (next.x >= 0.02 && next.y >= 0.02))) c.anchor = { ...next };
    }
    if (Number.isFinite(patch.shape) && this.editableShape) c.shape = clampShape(patch.shape);
  }
}

/** The same origin-fixed homothety serves PPC, power curves and complement kinks. */
export class RadialCurveFamily extends AnalyticCurveFamily {
  constructor(metadata) { super(metadata); if (new.target === RadialCurveFamily) throw new TypeError('RadialCurveFamily is abstract'); }
  get radial() { return true; }
  moveAnchor(c, start, point) {
    const length = start.x ** 2 + start.y ** 2;
    if (length < 1e-12) return { ...c.anchor };
    const scale = Math.max(0.02 / Math.min(c.anchor.x, c.anchor.y), (point.x * start.x + point.y * start.y) / length);
    return { x: c.anchor.x * scale, y: c.anchor.y * scale };
  }
  fitLine(c, line, contact) {
    const intercept = line.anchor.y - line.slope * line.anchor.x, scale = intercept / (contact.y - line.slope * contact.x);
    return scale > 0 && Number.isFinite(scale) && Math.min(c.anchor.x * scale, c.anchor.y * scale) >= 0.02 ? { x: c.anchor.x * scale, y: c.anchor.y * scale } : null;
  }
  nearbyOffset(c) { const length = Math.hypot(c.anchor.x, c.anchor.y); return { x: c.anchor.x / length, y: c.anchor.y / length }; }
}

export class PowerCurveFamily extends RadialCurveFamily {
  tangentVector(c, p) { return { x: p.x, y: -this.exponent(c) * p.y }; }
  exponent(c) { return c.shape; }
  value(c, input, direction = 'vertical') {
    const a = c.anchor, r = this.exponent(c);
    return direction === 'horizontal' ? input > 0 ? a.x * Math.exp(Math.log(a.y / input) / r) : NaN
      : input > 0 ? a.y * Math.exp(r * Math.log(a.x / input)) : NaN;
  }
  contact(c, slope) {
    if (slope === null || slope >= 0) return null;
    const r = this.exponent(c), x = Math.exp((Math.log(r * c.anchor.y) + r * Math.log(c.anchor.x) - Math.log(-slope)) / (r + 1));
    return { x, y: this.value(c, x) };
  }
  fitPoint(c, p) {
    if (p.x <= 0 || p.y <= 0) return null;
    const a = c.anchor, r = this.exponent(c), scale = Math.exp((Math.log(p.y / a.y) + r * Math.log(p.x / a.x)) / (1 + r));
    return Math.min(a.x * scale, a.y * scale) >= 0.02 ? { x: a.x * scale, y: a.y * scale } : null;
  }
  shapeFromPoint(c, p) { return shapePatch(Math.log(p.y / c.anchor.y) / Math.log(c.anchor.x / p.x)); }
}
export class CobbDouglasFamily extends PowerCurveFamily {}
export class RectangularHyperbolaFamily extends PowerCurveFamily {
  exponent() { return 1; }
  get editableShape() { return false; }
  shapeValue(c) { return Math.sqrt(c.anchor.x) * Math.sqrt(c.anchor.y); }
  shapeFromValue(c, value) { return this.shapeFromPoint(c, { x: value, y: value }); }
  shapeFromPoint(c, p) { const anchor = this.throughPoint(c, p); return anchor ? { anchor } : {}; }
  shapeKeyPatch(c, positive) {
    const scale = positive ? 1.05 : 1 / 1.05;
    return this.shapeFromPoint(c, { x: c.anchor.x * scale, y: c.anchor.y * scale });
  }
}

export class PpcFamily extends RadialCurveFamily {
  tangentVector(c, p) { const r = ppcRadii(c); return { x: r.x ** 2 * p.y, y: -(r.y ** 2) * p.x }; }
  isEndpointAction(action) { return ['ppc-x', 'ppc-y'].includes(action); }
  endpointHandles(c) {
    const r = ppcRadii(c);
    return [{ point: { x: r.x, y: 0 }, action: 'ppc-x', label: '가로 반지름' }, { point: { x: 0, y: r.y }, action: 'ppc-y', label: '세로 반지름' }];
  }
  endpointPatch(c, key, value) { return { anchor: { ...c.anchor, [key]: Math.max(0.1, Math.min(100, value)) / Math.SQRT2 }, reshape: true }; }
  shapeKeyPatch(c, positive, step) { return this.reshapeKeyPatch(c, positive, step); }
  get editableShape() { return false; }
  get reshapesAnchor() { return true; }
  value(c, input, direction = 'vertical') { return ppcValue(c, input, direction); }
  clip(c, bounds) { return clipPpc(c, bounds); }
  contact(c, slope) { return ppcContact(c, slope); }
  fitPoint(c, point) { return ppcThroughPoint(c, point); }
  onLine(c, line) { return ppcOnLine(c, line); }
  lineIntersections(c, line, bounds) { return ppcLineIntersections(c, line, bounds); }
  shapeHandle(c) { return { x: c.anchor.x * Math.SQRT2 * Math.cos(Math.PI / 6), y: c.anchor.y * Math.SQRT2 * Math.sin(Math.PI / 6) }; }
  shapeValue(c) { return c.anchor.y / c.anchor.x; }
  shapeFromValue(c, value) { const area = c.anchor.x * c.anchor.y; return { anchor: { x: Math.sqrt(area / value), y: Math.sqrt(area * value) }, reshape: true }; }
  shapeFromPoint(c, p) { return p.x > 0 && p.y > 0 ? this.shapeFromValue(c, clampShape(p.y / p.x * Math.sqrt(3))) : {}; }
  geometry(c) { return { type: 'ellipse-arc', center: { x: 0, y: 0 }, radii: ppcRadii(c), angleRange: [0, Math.PI / 2], domain: 'nonnegative', movement: this.movement(c) }; }
}

export class ComplementsFamily extends RadialCurveFamily {
  get contactGeometry() { return 'kink'; }
  shapeKeyPatch(c, positive, step) { return this.reshapeKeyPatch(c, positive, step); }
  get reshapesAnchor() { return true; }
  value() { return NaN; }
  clipPositive(c, bounds) {
    const a = c.anchor;
    return [clipSegment(a, { x: a.x, y: Math.max(a.y, bounds.yMax) }, bounds), clipSegment(a, { x: Math.max(a.x, bounds.xMax), y: a.y }, bounds)]
      .filter(s => s && Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y) > 1e-10).map(quadratic);
  }
  contact(c, slope) { return slope !== null && slope < 0 ? { ...c.anchor } : null; }
  fitPoint(c, p) { const a = c.anchor, scale = Math.min(p.x / a.x, p.y / a.y); return scale > 0 && Math.min(a.x * scale, a.y * scale) >= 0.02 ? { x: a.x * scale, y: a.y * scale } : null; }
  lineIntersections(c, line, bounds) {
    const a = c.anchor, points = [];
    if (line.slope === null) { if (line.anchor.x >= a.x) points.push({ x: line.anchor.x, y: a.y }); }
    else {
      const y = line.anchor.y + line.slope * (a.x - line.anchor.x);
      if (y >= a.y) points.push({ x: a.x, y });
      if (line.slope !== 0) { const x = line.anchor.x + (a.y - line.anchor.y) / line.slope; if (x >= a.x) points.push({ x, y: a.y }); }
    }
    return points.filter(p => p.x >= bounds.xMin && p.x <= bounds.xMax && p.y >= bounds.yMin && p.y <= bounds.yMax).map(point => ({ point, kind: 'intersection' }));
  }
  shapeHandle(c, bounds = null) { const scale = bounds ? Math.min(1.35, bounds.xMax / c.anchor.x, bounds.yMax / c.anchor.y) : 1.35; return { x: c.anchor.x * scale, y: c.anchor.y * scale }; }
  shapeValue(c) { return c.anchor.y / c.anchor.x; }
  shapeFromValue(c, value) { const radius = Math.hypot(c.anchor.x, c.anchor.y), x = radius / Math.hypot(1, value); return { anchor: { x, y: x * value }, reshape: true }; }
  shapeFromPoint(c, p) { return p.x > 0 && p.y > 0 ? this.shapeFromValue(c, clampShape(p.y / p.x)) : {}; }
}

export class SubstitutesFamily extends AnalyticCurveFamily {
  get contactGeometry() { return 'linear'; }
  tangentVector(c) { return { x: 1, y: -c.shape }; }
  includesZero() { return true; }
  value(c, input, direction = 'vertical') { return direction === 'horizontal' ? c.anchor.x + (c.anchor.y - input) / c.shape : c.anchor.y - c.shape * (input - c.anchor.x); }
  moveDistance(c, anchor) { return Math.abs(c.shape * (anchor.x - c.anchor.x) + anchor.y - c.anchor.y) / Math.hypot(c.shape, 1); }
  moveAnchor(c, start, point, axis) {
    const dx = axis === 'y' ? 0 : point.x - start.x, dy = axis === 'x' ? 0 : point.y - start.y;
    const offset = (c.shape * dx + dy) / (c.shape ** 2 + 1), anchor = { x: c.anchor.x + c.shape * offset, y: c.anchor.y + offset };
    const intercept = c.shape * anchor.x + anchor.y;
    if (intercept < 0.02) { const correction = (0.02 - intercept) / (c.shape ** 2 + 1); anchor.x += c.shape * correction; anchor.y += correction; }
    const level = c.shape * anchor.x + anchor.y; return { x: c.shape * level / (1 + c.shape ** 2), y: level / (1 + c.shape ** 2) };
  }
  clipPositive(c, bounds) { const segment = clipLine({ anchor: c.anchor, slope: -c.shape }, bounds); return segment ? [quadratic(segment)] : []; }
  contact(c, slope, reference = c.anchor) {
    if (slope === null || slope >= 0) return null;
    if (Math.abs(slope + c.shape) > 1e-9 * Math.max(1, c.shape)) { const b = c.anchor.y + c.shape * c.anchor.x; return c.shape > -slope ? { x: b / c.shape, y: 0 } : { x: 0, y: b }; }
    const x = (reference.x + c.shape * (c.anchor.y + c.shape * c.anchor.x - reference.y)) / (1 + c.shape ** 2);
    const bounded = Math.max(0, Math.min((c.anchor.y + c.shape * c.anchor.x) / c.shape, x)); return { x: bounded, y: this.value(c, bounded) };
  }
  fitPoint(c, p) { return this.move(c, c.anchor, p); }
  fitLine(c, line) {
    const intercept = line.anchor.y - line.slope * line.anchor.x;
    const targetIntercept = Math.abs(line.slope + c.shape) > 1e-9 * Math.max(1, c.shape) ? c.shape > -line.slope ? c.shape * intercept / (-line.slope) : intercept : intercept;
    if (!(targetIntercept > 0)) return null;
    const delta = (targetIntercept - (c.anchor.y + c.shape * c.anchor.x)) / (1 + c.shape ** 2); return { x: c.anchor.x + c.shape * delta, y: c.anchor.y + delta };
  }
  criticalParameter() { return undefined; }
  coincident(c, line) { return Math.abs(line.slope + c.shape) < 1e-10; }
  shapeFromPoint(c, p) { return shapePatch((c.anchor.y - p.y) / (p.x - c.anchor.x)); }
  nearbyOffset(c) { const length = Math.hypot(c.shape, 1); return { x: c.shape / length, y: 1 / length }; }
}

export class QuasilinearFamily extends AnalyticCurveFamily {
  tangentVector(c, p) { return this.swapped(c) ? { x: c.shape, y: -p.y } : { x: p.x, y: -c.shape }; }
  get translationAxis() { return linearAxisOf; }
  movement(c) { return `${linearAxisOf(c)}축으로 평행이동`; }
  swapped(c) { return linearAxisOf(c) === 'x'; }
  value(c, input, direction = 'vertical') {
    const a = c.anchor, r = c.shape;
    if (direction === 'horizontal') return this.swapped(c) ? input > 0 ? a.x - r * Math.log(input / a.y) : NaN : a.x * Math.exp((a.y - input) / r);
    return this.swapped(c) ? a.y * Math.exp((a.x - input) / r) : input > 0 ? a.y - r * Math.log(input / a.x) : NaN;
  }
  moveAnchor(c, start, point) { const key = linearAxisOf(c); return { ...c.anchor, [key]: c.anchor[key] + point[key] - start[key] }; }
  contact(c, slope) {
    if (slope === null || slope >= 0) return null;
    if (this.swapped(c)) { const y = -c.shape * slope; return { x: this.value(c, y, 'horizontal'), y }; }
    const x = -c.shape / slope; return { x, y: this.value(c, x) };
  }
  fitPoint(c, p) { const axis = linearAxisOf(c), other = axis === 'x' ? 'y' : 'x'; return p[other] > 0 ? { ...c.anchor, [axis]: p[axis] + c.shape * Math.log(p[other] / c.anchor[other]) } : null; }
  fitLine(c, line, contact) {
    const intercept = line.anchor.y - line.slope * line.anchor.x;
    return this.swapped(c) ? { ...c.anchor, x: c.anchor.x + (contact.y - line.slope * contact.x - intercept) / line.slope } : { ...c.anchor, y: c.anchor.y + intercept - (contact.y - line.slope * contact.x) };
  }
  shapeFromPoint(c, p) { const axis = linearAxisOf(c), other = axis === 'x' ? 'y' : 'x'; return shapePatch((c.anchor[axis] - p[axis]) / Math.log(p[other] / c.anchor[other])); }
  nearbyOffset(c) { return this.swapped(c) ? { x: 1, y: 0 } : { x: 0, y: 1 }; }
  applyPatch(c, patch) {
    super.applyPatch(c, patch);
    if (['x', 'y'].includes(patch.linearAxis) && patch.linearAxis !== c.linearAxis) { c.anchor = { x: c.anchor.y, y: c.anchor.x }; c.linearAxis = patch.linearAxis; }
  }
}

/** Prevent a new family from silently disappearing from shared geometry/interaction paths. */
export function assertCurveFamilyContract(family) {
  if (!(family instanceof AnalyticCurveFamily)) throw new TypeError('A curve family must extend AnalyticCurveFamily');
  if (!['smooth', 'linear', 'kink'].includes(family.contactGeometry)) throw new TypeError('Unknown contact geometry capability');
  const required = ['value', 'contact', 'moveAnchor', 'fitPoint', 'fitLine', 'shapeFromPoint'];
  if (family.contactGeometry !== 'kink') required.push('tangentVector');
  for (const method of required) if (typeof family[method] !== 'function' || family[method] === AnalyticCurveFamily.prototype[method]) {
    throw new TypeError(`${family.constructor.name} must implement ${method}()`);
  }
  return family;
}
export function registerCurveFamilies(entries) {
  for (const family of Object.values(entries)) { assertCurveFamilyContract(family); Object.freeze(family); }
  return Object.freeze(entries);
}

export const CURVE_FAMILIES = registerCurveFamilies({
  ppc: new PpcFamily({ label: 'PPC', movement: '원점 기준 크기 조절 · 양 끝점으로 타원 조절', shape: '세로 / 가로 비율', color: '#b67836' }),
  'rectangular-hyperbola': new RectangularHyperbolaFamily({ label: '직각 쌍곡선', movement: '축을 점근선으로 유지 · 크기 조절', shape: '크기', color: '#6068e8' }),
  'cobb-douglas': new CobbDouglasFamily({ label: '콥더글라스', movement: '원점 기준 확대·축소', shape: '휘어짐', color: '#6068e8' }),
  substitutes: new SubstitutesFamily({ label: '완전대체재', movement: '기울기 유지 · 평행이동', shape: '기울기', color: '#43a999' }),
  complements: new ComplementsFamily({ label: '완전보완재', movement: '원점 기준 · 꺾임 이동', shape: '꺾임 비율', color: '#b67836' }),
  quasilinear: new QuasilinearFamily({ label: '준선형효용', movement: '선형 축으로 평행이동', shape: '휘어짐', color: '#ad5265' }),
});
export const curveFamilyOf = c => c && Object.hasOwn(CURVE_FAMILIES, c.family) ? CURVE_FAMILIES[c.family] : null;
