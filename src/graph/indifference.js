import { CURVE_FAMILIES, curveFamilyOf, linearAxisOf } from '../models/curve-families.js';

// Compatibility facade: every caller uses the same registered class implementation.
export const INDIFFERENCE_FAMILIES = Object.freeze(Object.fromEntries(Object.entries(CURVE_FAMILIES).map(([id, family]) => [id, family.metadata])));
export const isIndifference = curve => Boolean(curveFamilyOf(curve));
export const radialIndifference = c => curveFamilyOf(c)?.radial ?? false;
export const linearAxis = linearAxisOf;
export const indifferenceMovement = c => curveFamilyOf(c).movement(c);
export const indifferenceMoveDistance = (c, anchor) => curveFamilyOf(c).moveDistance(c, anchor);
export const moveIndifference = (c, start, point, axis = null) => curveFamilyOf(c).move(c, start, point, axis);
export const indifferenceValue = (c, input, direction = 'vertical') => curveFamilyOf(c).value(c, input, direction);
export const clipIndifference = (c, bounds) => curveFamilyOf(c).clip(c, bounds);
export const indifferenceContact = (c, slope, reference = c.anchor) => curveFamilyOf(c).contact(c, slope, reference);
export const indifferenceThroughPoint = (c, point) => curveFamilyOf(c).throughPoint(c, point);
export const indifferenceOnLine = (c, line, reference = c.anchor) => curveFamilyOf(c).onLine(c, line, reference);
export const indifferenceLineIntersections = (c, line, bounds) => curveFamilyOf(c).lineIntersections(c, line, bounds);
export const indifferenceShapeHandle = (c, bounds = null) => curveFamilyOf(c).shapeHandle(c, bounds);
export const shapeIndifference = (c, point) => curveFamilyOf(c).shapeFromPoint(c, point);
