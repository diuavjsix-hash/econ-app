import { SVG_RENDERER } from './svg-renderer.js';
import { toScreen } from './viewport.js';
import { displayedLineSegments, lineEditingGeometry, isLinePointVisible } from './display.js';
import { curvePoint } from './curve.js';
import { drawSketch } from './sketch-view.js';
import { curveFamilyOf, isOppositeCurve } from '../models/curve-families.js';
import { oppositeOriginEditable } from './axes.js';
import { LINE_END_ACTIONS, linePointAt, visibleLineEnds } from './line-extent.js';

const node = (...args) => SVG_RENDERER.element(...args);
const circle = (object, point, action, radius, className, label, title, viewport) => {
  const p = toScreen(point, viewport), el = node('circle', { cx: p.x, cy: p.y, r: radius, class: className,
    'data-id': object.id, 'data-action': action, ...(label ? { tabindex: 0, role: 'button', 'aria-label': `${object.name} ${label}` } : {}) });
  el.append(node('title', {}, title)); return el;
};
function curveHandles(object, viewport, state) {
  const family = curveFamilyOf(object), bounds = viewport.bounds, group = node('g', { class: 'curve-handles', style: `--line-color:${object.color}` });
  const shapePoint = family ? family.shapeHandle(object, bounds) : curvePoint(object, 0.6);
  const shapeLabel = family?.metadata.shape === '크기' ? '크기 조절' : '모양 조절';
  if (isLinePointVisible(shapePoint, bounds, state)) group.append(circle(object, shapePoint, family ? 'ic-shape' : 'bend', 7, 'rotate-handle bend-handle', shapeLabel,
    family ? `드래그하여 ${shapeLabel}` : '위아래로 드래그하여 휘어짐 조절', viewport));
  if (isLinePointVisible(object.anchor, bounds, state)) group.append(circle(object, object.anchor, 'move', 5, 'move-handle', null, '드래그하여 이동', viewport));
  if (isOppositeCurve(object) && oppositeOriginEditable(object, state) && isLinePointVisible(object.oppositeOrigin, bounds, state)) {
    group.append(circle(object, object.oppositeOrigin, 'ic-origin', 6, 'rotate-handle opposite-origin-handle', '반대 원점', '드래그하여 반대 원점과 곡선 이동', viewport));
  }
  for (const handle of family?.endpointHandles(object) ?? []) {
    const p = handle.point;
    if (p.x >= bounds.xMin && p.x <= bounds.xMax && p.y >= bounds.yMin && p.y <= bounds.yMax) group.append(circle(object, p, handle.action, 7, 'rotate-handle', handle.label, `드래그하여 ${handle.label} 조절`, viewport));
  }
  return group;
}
function lineHandles(object, viewport, state) {
  const editing = lineEditingGeometry(object, displayedLineSegments(object, viewport.bounds, state));
  if (!editing) return null;
  const anchor = toScreen(editing.anchor, viewport), group = node('g', { class: 'line-handles', style: `--line-color:${object.color}` });
  // A link line keeps its direction, so it has no rotation handles.
  for (const [index, endpoint] of (object.link ? [] : editing.points.entries())) {
    const edge = toScreen(endpoint, viewport), distance = Math.hypot(edge.x - anchor.x, edge.y - anchor.y);
    const fraction = distance === 0 ? 0 : Math.min(90, distance * 0.7) / distance;
    const point = { x: editing.anchor.x + (endpoint.x - editing.anchor.x) * fraction, y: editing.anchor.y + (endpoint.y - editing.anchor.y) * fraction };
    group.append(circle(object, point, 'rotate', 7, 'rotate-handle', `기울기 조절 ${index + 1}`, '드래그하여 기울기 조절', viewport));
  }
  // End handles exist only on drawn ends (segment, ray start). Open ends have none:
  // the kind (line, ray, segment) changes only with the line settings buttons.
  const ends = visibleLineEnds(object, viewport.bounds, state);
  for (const [index, action] of Object.keys(LINE_END_ACTIONS).entries()) {
    const end = ends?.ends[index];
    if (!end || end.open) continue;
    group.append(circle(object, linePointAt(object, end.t), action, 5, 'rotate-handle end-handle', `끝 조절 ${index + 1}`, '드래그하여 끝 위치 조절', viewport));
  }
  group.append(circle(object, editing.anchor, 'move', 5, 'move-handle', null, '드래그하여 이동', viewport));
  return group;
}
const views = Object.freeze({ line: lineHandles, curve: curveHandles,
  sketch: (object, viewport, state, clipId) => drawSketch(object, viewport, state, { selected: true, editable: true, clipId, handlesOnly: true }) });
export function renderEditingHandles(object, viewport, state, clipId) {
  return object && state.handSelected && Object.hasOwn(views, object.type) ? views[object.type](object, viewport, state, clipId) : null;
}
