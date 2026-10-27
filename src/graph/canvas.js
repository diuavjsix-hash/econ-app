import { drawDashedLine } from './dashed-view.js';
import { constrainRuler, translateRuler } from './ruler.js';
import { angleFromSlope, clipLine, slopeFromAngle } from './math.js';
import { createViewport, visibleAnchor, toScreen as projectPoint, toWorld } from './viewport.js';
import { bendFromPoint, clipCurveWithExtensions, curvePoint } from './curve.js';
import { pointCoordinatesLabel } from './point.js';
import { buildSnapTargets, snapPoint } from './snap.js';
import { objectsOf } from '../objects.js';

let nextCanvasId = 1;
const SVG_NS = 'http://www.w3.org/2000/svg';
function element(tag, attributes, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountGraph(container, store) {
  const clipId = `plot-clip-${nextCanvasId++}`;
  const svg = element('svg', { 'aria-label': '그래프 편집 화면', class: 'graph-svg' });
  container.append(svg);
  let currentState = store.getState();
  let viewport;
  let drag = null;
  let draft = null;
  let snapTarget = null;
  let pointer = null;
  let snapCache = { signature: '', targets: null };

  function snappedPosition(point, event) {
    snapTarget = null;
    const { bounds } = viewport;
    const snapping = currentState.dashedSelected || drag?.object.type === 'dashed' ? currentState.dashedSnap : currentState.pointSnap;
    if (!snapping || event.altKey || point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax) return point;
    const signature = JSON.stringify([
      bounds,
      currentState.lines.map(({ id, anchor, slope }) => [id, anchor, slope]),
      currentState.curves.map(({ id, anchor, slope, span, bend }) => [id, anchor, slope, span, bend]),
      currentState.dashedLines.filter(r => r.id !== drag?.object.id).map(({ id, anchor, end }) => [id, anchor, end]),
      drag?.object.id ?? null,
    ]);
    if (signature !== snapCache.signature) snapCache = { signature, targets: buildSnapTargets(currentState, bounds, drag?.object.id ?? null) };
    snapTarget = snapPoint(point, snapCache.targets, viewport.unit);
    if (currentState.dashedSelected || drag?.object.type === 'dashed') {
      const nearest = currentState.points.filter(p => p.anchor.x >= bounds.xMin && p.anchor.x <= bounds.xMax && p.anchor.y >= bounds.yMin && p.anchor.y <= bounds.yMax)
        .map(p => ({ point: p.anchor, distance: Math.hypot(point.x - p.anchor.x, point.y - p.anchor.y) * viewport.unit }))
        .filter(p => p.distance <= 10).sort((a,b) => a.distance - b.distance)[0];
      if (nearest) snapTarget = { ...nearest, kind: 'point' };
    }
    return snapTarget?.point ?? point;
  }

  // Update only this non-interactive overlay on hover; keep geometry and focus intact.
  function updateMouseCursor(position) {
    const layer = svg.querySelector('.mouse-cursor-layer');
    if (!layer) return;
    layer.replaceChildren();
    svg.classList.toggle('is-mouse-adjusting', (currentState.mouseSelected || currentState.dashedSelected));
    const rect = svg.getBoundingClientRect();
    const visible = (currentState.mouseSelected || currentState.dashedSelected) && pointer && pointer.pointerType !== 'touch'
      && pointer.clientX >= rect.left && pointer.clientX <= rect.right
      && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom;
    svg.classList.toggle('has-mouse-cursor', Boolean(visible));
    if (!visible) { snapTarget = null; return; }
    const point = position ?? (drag ? worldPoint(pointer) : snappedPosition(worldPoint(pointer), pointer));
    if (drag && drag.object.type !== 'point') snapTarget = null;
    const { cx, cy, unit, width, height } = viewport;
    const { x, y } = projectPoint(point, viewport);
    const kind = snapTarget?.kind ?? 'free';
    const marker = element('g', { class: 'snap-preview mouse-cursor', 'data-snap-kind': kind, 'aria-hidden': 'true' });
    marker.append(element('circle', { cx: x, cy: y, r: kind === 'intersection' ? 12 : 9 }));
    const coordinates = pointCoordinatesLabel(point);
    const label = element('text', { x: x + 16, y: y + 26, 'data-mouse-coordinates': '', class: 'mouse-coordinate-label' }, kind === 'intersection' ? `교점 ${coordinates}` : coordinates);
    marker.append(label);
    layer.append(marker);
    const labelWidth = label.getComputedTextLength();
    label.setAttribute('x', Math.max(8, Math.min(width - labelWidth - 8, x + 16)));
    label.setAttribute('y', Math.max(16, y + 26 > height - 8 ? y - 18 : y + 26));
  }

  function render() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    viewport = createViewport(width, height, currentState.quadrantMode, currentState);
    const { cx, cy, unit, bounds, plot, xDirection, yDirection } = viewport;
    const toScreen = point => projectPoint(point, viewport);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    svg.append(element('title', {}, '선을 드래그하면 이동하고, 선택한 선의 흰색 점을 드래그하면 형태가 바뀝니다.'));

    if (currentState.showGrid) {
      const grid = element('g', { class: 'graph-grid', 'aria-hidden': 'true' });
      // Grid stays inside the chosen mathematical domain, with room around it for axis names.
      for (let i = Math.floor(bounds.xMin); i <= Math.ceil(bounds.xMax); i++) {
        const x = cx + i * unit * xDirection;
        if (x >= plot.left && x <= plot.right) grid.append(element('line', { x1: x, y1: plot.top, x2: x, y2: plot.bottom }));
      }
      for (let i = Math.floor(bounds.yMin); i <= Math.ceil(bounds.yMax); i++) {
        const y = cy - i * unit * yDirection;
        if (y >= plot.top && y <= plot.bottom) grid.append(element('line', { x1: plot.left, y1: y, x2: plot.right, y2: y }));
      }
      svg.append(grid);
    }

    const axes = element('g', { class: 'graph-axes', 'aria-label': '좌표축' });
    const xEnd = xDirection === 1 ? plot.right : plot.left;
    const yEnd = yDirection === 1 ? plot.top : plot.bottom;
    axes.append(
      element('line', { x1: plot.left, y1: cy, x2: plot.right, y2: cy }),
      element('line', { x1: cx, y1: plot.bottom, x2: cx, y2: plot.top }),
      element('path', { d: `M${xEnd - 7 * xDirection} ${cy - 4}l${7 * xDirection} 4 ${-7 * xDirection} 4 M${cx - 4} ${yEnd + 7 * yDirection}l4 ${-7 * yDirection} 4 ${7 * yDirection}`, fill: 'none' }),
    );
    svg.append(axes);
    function axisName(name, attributes, maxWidth) {
      if (!name) return;
      const label = element('text', { ...attributes, class: 'axis-name' }, name);
      label.append(element('title', {}, name));
      svg.append(label);
      // Long names remain inside the canvas; their full value is available on hover.
      let shortened = name;
      while (label.getComputedTextLength() > maxWidth && shortened.length > 1) {
        shortened = shortened.slice(0, -1);
        label.firstChild.textContent = `${shortened}…`;
      }
    }
    axisName(currentState.axisNames.x, { x: xEnd - 10 * xDirection, y: cy + (yDirection === 1 ? 24 : -16), 'text-anchor': xDirection === 1 ? 'end' : 'start', 'aria-label': `수평축 ${currentState.axisNames.x}` }, plot.right - plot.left - 20);
    axisName(currentState.axisNames.y, { x: cx + 13 * xDirection, y: yEnd + (yDirection === 1 ? 5 : -5), 'text-anchor': xDirection === 1 ? 'start' : 'end', 'aria-label': `수직축 ${currentState.axisNames.y}` }, (xDirection === 1 ? plot.right - cx : cx - plot.left) - 13);

    const defs = element('defs', {});
    const clip = element('clipPath', { id: clipId });
    clip.append(element('rect', { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top }));
    defs.append(clip);
    svg.append(defs);
    // Clip geometry rather than painted strokes so the full thickness reaches each axis.
    // Only the wider interaction targets remain restricted to the mathematical domain.
    const shapes = element('g', {});
    svg.append(shapes);
    const ordered = [...currentState.lines, ...currentState.curves].sort((a, b) => Number(a.id === currentState.selectedId) - Number(b.id === currentState.selectedId));
    for (const line of ordered) {
      if (line.type === 'curve') {
        const segments = clipCurveWithExtensions(line, bounds);
        if (!segments.length) continue;
        let previousEnd = null;
        const d = segments.map((points) => {
          const [start, control, end] = points.map(toScreen);
          const connected = previousEnd && Math.hypot(start.x - previousEnd.x, start.y - previousEnd.y) < 1e-6;
          previousEnd = end;
          return `${connected ? '' : `M${start.x} ${start.y}`}Q${control.x} ${control.y} ${end.x} ${end.y}`;
        }).join(' ');
        const selected = line.id === currentState.selectedId;
        const group = element('g', { class: 'graph-curve', style: `--line-color:${line.color}` });
        group.append(element('path', { d, class: `plotted-line${selected ? ' is-selected' : ''}`, fill: 'none', 'aria-hidden': 'true' }));
        const hit = element('path', { d, fill: 'none', class: 'line-hit', 'clip-path': `url(#${clipId})`, 'data-id': line.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${line.name} 이동`, 'aria-pressed': selected });
        hit.append(element('title', {}, `${line.name} · 드래그하여 이동`));
        group.append(hit);
        shapes.append(group);
        continue;
      }
      const points = clipLine(line, bounds);
      if (!points) continue;
      const [a, b] = points.map(toScreen);
      const selected = line.id === currentState.selectedId;
      const group = element('g', { class: 'graph-line', style: `--line-color:${line.color}` });
      const coordinates = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      group.append(element('line', { ...coordinates, class: `plotted-line${selected ? ' is-selected' : ''}`, 'aria-hidden': 'true' }));
      const hit = element('line', { ...coordinates, class: 'line-hit', 'clip-path': `url(#${clipId})`, 'data-id': line.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${line.name} 이동`, 'aria-pressed': selected });
      hit.append(element('title', {}, `${line.name} · 드래그하여 이동`));
      group.append(hit);
      shapes.append(group);
    }

    for (const ruler of currentState.dashedLines) svg.append(drawDashedLine(ruler, viewport, { selected: ruler.id === currentState.selectedId, editable: currentState.handSelected, clipId }));
    svg.append(element('g', { class: 'dashed-draft-layer', 'pointer-events': 'none' }));
    updateDraft();
    const pointLayer = element('g', { class: 'graph-points' });
    svg.append(pointLayer);
    for (const point of currentState.points) {
      const { x, y } = toScreen(point.anchor);
      if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) continue;
      const selected = point.id === currentState.selectedId;
      const group = element('g', { style: `--point-color:${point.color}`, 'data-point-id': point.id });
      if (selected) group.append(element('circle', { cx: x, cy: y, r: 10, class: 'point-selection', 'aria-hidden': 'true' }));
      group.append(element('circle', { cx: x, cy: y, r: selected ? 5.5 : 4.5, class: 'plotted-point', 'aria-hidden': 'true' }));
      const hit = element('circle', { cx: x, cy: y, r: 12, class: 'point-hit', 'data-id': point.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${point.name || '점'} 이동`, 'aria-pressed': selected });
      group.append(hit);
      pointLayer.append(group);
      if (point.name) {
        const label = element('text', { x: x + 12, y: y - 12, class: 'point-name', 'data-point-name': point.id }, point.name);
        label.append(element('title', {}, point.name));
        group.append(label);
        let short = point.name;
        const maxWidth = Math.min(220, width - 16);
        while (label.getComputedTextLength() > maxWidth && short.length > 1) {
          short = short.slice(0, -1);
          label.firstChild.textContent = `${short}…`;
        }
        const labelWidth = label.getComputedTextLength();
        label.setAttribute('x', String(Math.max(8, Math.min(width - labelWidth - 8, x + 12))));
        label.setAttribute('y', String(Math.max(16, y - 12)));
      }
      if (point.showCoordinates) {
        const label = element('text', { x: x + 12, y: Math.max(point.name ? 31 : 16, y + (point.name ? 4 : -12)), class: 'point-name point-coordinates', 'data-point-coordinates': point.id }, pointCoordinatesLabel(point.anchor));
        label.append(element('title', {}, `(${point.anchor.x}, ${point.anchor.y})`));
        group.append(label);
        const length = label.getComputedTextLength();
        if (length > width - 16) { label.setAttribute('textLength', width - 16); label.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
        label.setAttribute('x', Math.max(8, Math.min(width - Math.min(length, width - 16) - 8, x + 12)));
        label.setAttribute('y', Math.min(height - 8, Number(label.getAttribute('y'))));
      }
    }
    svg.append(element('g', { class: 'mouse-cursor-layer', 'pointer-events': 'none' }));
    updateMouseCursor(drag?.object.type === 'point' ? currentState.points.find((point) => point.id === drag.object.id)?.anchor : undefined);
    const selected = objectsOf(currentState).find((object) => object.id === currentState.selectedId);
    if (!currentState.handSelected || !selected || selected.type === 'ruler' || selected.type === 'point' || selected.type === 'group' || selected.type === 'dashed') return;
    if (selected.type === 'curve') {
      const handles = element('g', { class: 'curve-handles', style: `--line-color:${selected.color}` });
      const bendPoint = toScreen(curvePoint(selected, 0.6));
      const anchor = toScreen(selected.anchor);
      const handle = element('circle', { cx: bendPoint.x, cy: bendPoint.y, r: 7, class: 'rotate-handle bend-handle', 'data-id': selected.id, 'data-action': 'bend', tabindex: 0, role: 'button', 'aria-label': `${selected.name} 휘어짐 조절` });
      handle.append(element('title', {}, '위아래로 드래그하여 휘어짐 조절'));
      const center = element('circle', { cx: anchor.x, cy: anchor.y, r: 5, class: 'move-handle', 'data-id': selected.id, 'data-action': 'move' });
      center.append(element('title', {}, '드래그하여 이동'));
      // A handle on an axis stays whole; an offscreen handle stays hidden.
      for (const [node, point] of [[handle, bendPoint], [center, anchor]]) {
        if (point.x >= plot.left && point.x <= plot.right && point.y >= plot.top && point.y <= plot.bottom) handles.append(node);
      }
      svg.append(handles);
      return;
    }
    const points = clipLine(selected, bounds);
    if (!points) return;
    const anchor = toScreen(visibleAnchor(selected, points, bounds));
    const handles = element('g', { class: 'line-handles', style: `--line-color:${selected.color}` });
    for (const [index, endpoint] of points.entries()) {
      const edge = toScreen(endpoint);
      const distance = Math.hypot(edge.x - anchor.x, edge.y - anchor.y);
      const fraction = distance === 0 ? 0 : Math.min(90, distance * 0.7) / distance;
      const handle = element('circle', { cx: anchor.x + (edge.x - anchor.x) * fraction, cy: anchor.y + (edge.y - anchor.y) * fraction, r: 7, class: 'rotate-handle', 'data-id': selected.id, 'data-action': 'rotate', tabindex: 0, role: 'button', 'aria-label': `${selected.name} 기울기 조절 ${index + 1}` });
      handle.append(element('title', {}, '드래그하여 기울기 조절'));
      handles.append(handle);
    }
    const center = element('circle', { cx: anchor.x, cy: anchor.y, r: 5, class: 'move-handle', 'data-id': selected.id, 'data-action': 'move' });
    center.append(element('title', {}, '드래그하여 이동'));
    handles.append(center);
    svg.append(handles);
  }

  function updateDraft() {
    const layer = svg.querySelector('.dashed-draft-layer');
    if (!layer) return;
    layer.replaceChildren();
    if (draft) layer.append(drawDashedLine(draft, viewport, { preview: true }));
  }
  function segmentPosition(event, anchor) {
    const point = worldPoint(event), { bounds } = viewport;
    const clamped = { x: Math.max(bounds.xMin, Math.min(bounds.xMax, point.x)), y: Math.max(bounds.yMin, Math.min(bounds.yMax, point.y)) };
    const snapped = snappedPosition(clamped, event);
    const constrained = anchor ? constrainRuler(anchor, snapped, currentState.dashedMode, event.shiftKey) : snapped;
    if (Math.hypot(constrained.x - snapped.x, constrained.y - snapped.y) > 1e-9) snapTarget = null;
    return constrained;
  }
  function finishSegment() {
    const completed = draft; draft = null;
    if (completed?.pointerId != null && svg.hasPointerCapture(completed.pointerId)) svg.releasePointerCapture(completed.pointerId);
    if (completed) store.addDashedLine(completed.anchor, completed.end);
    updateDraft();
  }

  function worldPoint(event) {
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * viewport.width / bounds.width;
    const y = (event.clientY - bounds.top) * viewport.height / bounds.height;
    return toWorld({ x, y }, viewport);
  }

  svg.addEventListener('pointerdown', (event) => {
    if (drag) return;
    pointer = event;
    if (event.button === 0 && currentState.mouseSelected && currentState.activeTool === 'point') {
      const point = worldPoint(event);
      const { bounds } = viewport;
      if (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax) store.addPoint(snappedPosition(point, event));
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if (currentState.duplicatePanel) {
      event.preventDefault();
      store.selectObject(event.target.closest('[data-id]')?.dataset.id ?? null);
      return;
    }
    const rulerTarget = event.target.closest('[data-id]');
    const editingRuler = currentState.dashedLines.some(r => r.id === rulerTarget?.dataset.id);
    if (currentState.dashedSelected && (draft || !editingRuler)) {
      event.preventDefault();
      if (draft) { draft.end = segmentPosition(event, draft.anchor); finishSegment(); return; }
      const point = worldPoint(event), { bounds } = viewport;
      if (point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax) return;
      const anchor = segmentPosition(event);
      draft = { anchor, end: { ...anchor }, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      store.selectObject(null); svg.setPointerCapture(event.pointerId); updateDraft(); return;
    }
    const target = event.target.closest('[data-id]');
    if (!target) {
      store.selectObject(null);
      return;
    }
    const object = objectsOf(currentState).find((item) => item.id === target.dataset.id);
    if (!object) return;
    let anchor = object.anchor;
    if (object.type === 'line') {
      const points = clipLine(object, viewport.bounds);
      if (!points) return;
      anchor = visibleAnchor(object, points, viewport.bounds);
    }
    drag = { pointerId: event.pointerId, action: target.dataset.action, start: worldPoint(event), object: { ...structuredClone(object), anchor } };
    store.beginHistory();
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
    store.selectObject(object.id);
    store.updateSelected({ anchor });
  });
  svg.addEventListener('pointermove', (event) => {
    pointer = event;
    if (draft && currentState.dashedSelected) {
      draft.end = segmentPosition(event, draft.anchor); updateDraft(); updateMouseCursor(draft.end); return;
    }
    if (!drag) {
      updateMouseCursor();
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    const point = worldPoint(event);
    if (drag.object.type === 'dashed') {
      if (drag.action === 'move') store.updateSelected(translateRuler(drag.object, { x: point.x - drag.start.x, y: point.y - drag.start.y }, viewport.bounds));
      else {
        const anchor = segmentPosition(event);
        store.updateSelected(drag.action === 'start' ? { anchor } : { end: anchor });
      }
      return;
    }
    if (drag.action === 'move') {
      const margin = drag.object.type === 'point' ? 0 : 24 / viewport.unit;
      const bounds = viewport.bounds;
      let anchor = {
        x: Math.max(bounds.xMin + margin, Math.min(bounds.xMax - margin, drag.object.anchor.x + point.x - drag.start.x)),
        y: Math.max(bounds.yMin + margin, Math.min(bounds.yMax - margin, drag.object.anchor.y + point.y - drag.start.y)),
      };
      if (drag.object.type === 'point') anchor = snappedPosition(anchor, event);
      store.updateSelected({ anchor });
    } else if (drag.action === 'bend') {
      store.updateSelected({ bend: bendFromPoint(drag.object, point) });
    } else {
      const dx = point.x - drag.object.anchor.x;
      if (Math.hypot(dx, point.y - drag.object.anchor.y) < 0.25) return;
      const dy = point.y - drag.object.anchor.y;
      // A small screen-space snap makes an exact vertical line easy to reach by mouse.
      const slope = Math.abs(dx * viewport.unit) < 4 ? null : dy / dx;
      store.updateSelected({ slope });
    }
  });
  const stopDrag = (event) => {
    if (draft?.pointerId === event.pointerId) {
      if (event.type === 'pointercancel') { draft = null; updateDraft(); }
      else if (event.type === 'pointerup') {
        const moved = Math.hypot(event.clientX - draft.clientX, event.clientY - draft.clientY) >= 4;
        if (moved) { draft.end = segmentPosition(event, draft.anchor); finishSegment(); }
        else { draft.pointerId = null; if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId); }
      }
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    snapTarget = null;
    svg.classList.remove('is-dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    store.endHistory();
    render();
  };
  svg.addEventListener('pointerenter', (event) => { pointer = event; updateMouseCursor(); });
  svg.addEventListener('pointerleave', () => {
    if (!drag) { pointer = null; updateMouseCursor(); }
  });
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);
  svg.addEventListener('lostpointercapture', stopDrag);
  svg.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-id]');
    if (!target) return;
    const keys = ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const id = target.dataset.id;
    if (currentState.duplicatePanel) { store.selectObject(id); return; }
    const action = target.dataset.action;
    const label = target.getAttribute('aria-label');
    store.selectObject(id);
    const line = objectsOf(currentState).find((item) => item.id === id);
    const step = event.shiftKey ? 1 : 0.1;
    if (event.key.startsWith('Arrow')) {
      if (line.type === 'dashed') {
        const delta = { x: (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) * viewport.xDirection, y: (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) * viewport.yDirection };
        if (action === 'move') store.updateSelected(translateRuler(line, delta, viewport.bounds));
        else {
          const key = action === 'start' ? 'anchor' : 'end', point = line[key], { bounds } = viewport;
          store.updateSelected({ [key]: { x: Math.max(bounds.xMin, Math.min(bounds.xMax, point.x + delta.x)), y: Math.max(bounds.yMin, Math.min(bounds.yMax, point.y + delta.y)) } });
        }
      } else if (action === 'rotate') {
        let angle = angleFromSlope(line.slope) + (['ArrowUp', 'ArrowRight'].includes(event.key) ? step : -step);
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        store.updateSelected({ slope: slopeFromAngle(angle) });
      } else if (action === 'bend') {
        store.updateSelected({ bend: line.bend + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 0.05 : 0.01) });
      } else store.updateSelected({ anchor: { x: line.anchor.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) * viewport.xDirection, y: line.anchor.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) * viewport.yDirection } });
    }
    // Rendering recreates SVG nodes, so restore keyboard focus to the same control.
    [...svg.querySelectorAll('[data-id]')].find((node) => node.dataset.id === id && node.getAttribute('aria-label') === label)?.focus();
  });

  const observer = new ResizeObserver(render);
  observer.observe(container);
  const unsubscribe = store.subscribe((state) => {
    if (draft && (!state.dashedSelected || state.historyRevision !== currentState.historyRevision)) {
      const id = draft.pointerId; draft = null;
      if (id != null && svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
    }
    if (draft && state.dashedMode !== currentState.dashedMode) draft.end = constrainRuler(draft.anchor, draft.end, state.dashedMode);

    if (state.historyRevision !== currentState.historyRevision && drag) {
      const pointerId = drag.pointerId;
      drag = null;
      svg.classList.remove('is-dragging');
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    }
    currentState = state;
    render();
  });
  return () => { observer.disconnect(); unsubscribe(); svg.remove(); };
}
