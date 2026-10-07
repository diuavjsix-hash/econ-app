import { angleFromSlope, clipLine, slopeFromAngle } from './math.js';
import { createViewport, visibleAnchor } from './viewport.js';
import { bendFromPoint, clipCurveWithExtensions, curvePoint } from './curve.js';
import { pointGuides, pointCoordinatesLabel } from './point.js';
import { buildSnapTargets, snapPoint } from './snap.js';
import { objectsOf } from '../objects.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function element(tag, attributes, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountGraph(container, store) {
  const svg = element('svg', { 'aria-label': '그래프 편집 화면', class: 'graph-svg' });
  container.append(svg);
  let currentState = store.getState();
  let viewport;
  let drag = null;
  let snapTarget = null;
  let pointer = null;
  let snapCache = { signature: '', targets: null };

  function snappedPosition(point, event) {
    snapTarget = null;
    const { bounds } = viewport;
    if (!currentState.pointSnap || event.altKey || point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax) return point;
    const signature = JSON.stringify([
      bounds,
      currentState.lines.map(({ id, anchor, slope }) => [id, anchor, slope]),
      currentState.curves.map(({ id, anchor, slope, span, bend }) => [id, anchor, slope, span, bend]),
      currentState.points.filter((point) => point.id !== drag?.object.id).map(({ id, anchor, guides }) => [id, anchor, guides]),
      drag?.object.type === 'point' ? drag.object.id : null,
    ]);
    if (signature !== snapCache.signature) snapCache = { signature, targets: buildSnapTargets(currentState, bounds, drag?.object.type === 'point' ? drag.object.id : null) };
    snapTarget = snapPoint(point, snapCache.targets, viewport.unit);
    return snapTarget?.point ?? point;
  }

  // Update only this non-interactive overlay on hover; keep geometry and focus intact.
  function updateMouseCursor(position) {
    const layer = svg.querySelector('.mouse-cursor-layer');
    if (!layer) return;
    layer.replaceChildren();
    svg.classList.toggle('is-mouse-adjusting', currentState.mouseSelected);
    const rect = svg.getBoundingClientRect();
    const visible = currentState.mouseSelected && pointer && pointer.pointerType !== 'touch'
      && pointer.clientX >= rect.left && pointer.clientX <= rect.right
      && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom;
    svg.classList.toggle('has-mouse-cursor', Boolean(visible));
    if (!visible) { snapTarget = null; return; }
    const point = position ?? (drag ? worldPoint(pointer) : snappedPosition(worldPoint(pointer), pointer));
    if (drag && drag.object.type !== 'point') snapTarget = null;
    const { cx, cy, unit, width, height } = viewport;
    const x = cx + point.x * unit, y = cy - point.y * unit;
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
    viewport = createViewport(width, height, currentState.quadrantMode);
    const { cx, cy, unit, bounds, plot } = viewport;
    const toScreen = ({ x, y }) => ({ x: cx + x * unit, y: cy - y * unit });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    svg.append(element('title', {}, '선을 드래그하면 이동하고, 선택한 선의 흰색 점을 드래그하면 형태가 바뀝니다.'));

    if (currentState.showGrid) {
      const grid = element('g', { class: 'graph-grid', 'aria-hidden': 'true' });
      // Grid stays inside the chosen mathematical domain, with room around it for axis names.
      for (let i = Math.floor(bounds.xMin); i <= Math.ceil(bounds.xMax); i++) {
        const x = cx + i * unit;
        if (x >= plot.left && x <= plot.right) grid.append(element('line', { x1: x, y1: plot.top, x2: x, y2: plot.bottom }));
      }
      for (let i = Math.floor(bounds.yMin); i <= Math.ceil(bounds.yMax); i++) {
        const y = cy - i * unit;
        if (y >= plot.top && y <= plot.bottom) grid.append(element('line', { x1: plot.left, y1: y, x2: plot.right, y2: y }));
      }
      svg.append(grid);
    }

    const axes = element('g', { class: 'graph-axes', 'aria-label': '좌표축' });
    axes.append(
      element('line', { x1: plot.left, y1: cy, x2: plot.right, y2: cy }),
      element('line', { x1: cx, y1: plot.bottom, x2: cx, y2: plot.top }),
      element('path', { d: `M${plot.right - 7} ${cy - 4}l7 4-7 4 M${cx - 4} ${plot.top + 7}l4-7 4 7`, fill: 'none' }),
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
    axisName(currentState.axisNames.x, { x: plot.right - 10, y: cy + 24, 'text-anchor': 'end', 'aria-label': `수평축 ${currentState.axisNames.x}` }, plot.right - plot.left - 20);
    axisName(currentState.axisNames.y, { x: cx + 13, y: plot.top + 5, 'aria-label': `수직축 ${currentState.axisNames.y}` }, plot.right - cx - 13);

    const defs = element('defs', {});
    const clip = element('clipPath', { id: 'plot-clip' });
    clip.append(element('rect', { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top }));
    defs.append(clip);
    svg.append(defs);
    const guides = element('g', { class: 'point-guides', 'aria-hidden': 'true' });
    for (const point of currentState.points) {
      for (const guide of pointGuides(point, bounds)) {
        const a = toScreen(guide.start), b = toScreen(guide.end);
        guides.append(element('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: guide.style, 'data-point-guide': point.id, 'data-guide-axis': guide.axis }));
      }
    }
    svg.append(guides);
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
        const hit = element('path', { d, fill: 'none', class: 'line-hit', 'clip-path': 'url(#plot-clip)', 'data-id': line.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${line.name} 이동`, 'aria-pressed': selected });
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
      const hit = element('line', { ...coordinates, class: 'line-hit', 'clip-path': 'url(#plot-clip)', 'data-id': line.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${line.name} 이동`, 'aria-pressed': selected });
      hit.append(element('title', {}, `${line.name} · 드래그하여 이동`));
      group.append(hit);
      shapes.append(group);
    }

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
    if (!selected || selected.type === 'point' || selected.type === 'group') return;
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

  function worldPoint(event) {
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * viewport.width / bounds.width;
    const y = (event.clientY - bounds.top) * viewport.height / bounds.height;
    return { x: (x - viewport.cx) / viewport.unit, y: (viewport.cy - y) / viewport.unit };
  }

  svg.addEventListener('contextmenu', (event) => {
    if (currentState.mouseSelected && currentState.activeTool === 'point') event.preventDefault();
  });
  svg.addEventListener('pointerdown', (event) => {
    if (drag) return;
    pointer = event;
    if (event.button === 2 && currentState.mouseSelected && currentState.activeTool === 'point') {
      const point = worldPoint(event);
      const { bounds } = viewport;
      if (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax) store.addPoint(snappedPosition(point, event));
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
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
    if (!drag) {
      updateMouseCursor();
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    const point = worldPoint(event);
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
    const action = target.dataset.action;
    const label = target.getAttribute('aria-label');
    store.selectObject(id);
    const line = objectsOf(currentState).find((item) => item.id === id);
    const step = event.shiftKey ? 1 : 0.1;
    if (event.key.startsWith('Arrow')) {
      if (action === 'rotate') {
        let angle = angleFromSlope(line.slope) + (['ArrowUp', 'ArrowRight'].includes(event.key) ? step : -step);
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        store.updateSelected({ slope: slopeFromAngle(angle) });
      } else if (action === 'bend') {
        store.updateSelected({ bend: line.bend + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 0.05 : 0.01) });
      } else store.updateSelected({ anchor: { x: line.anchor.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: line.anchor.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) } });
    }
    // Rendering recreates SVG nodes, so restore keyboard focus to the same control.
    [...svg.querySelectorAll('[data-id]')].find((node) => node.dataset.id === id && node.getAttribute('aria-label') === label)?.focus();
  });

  const observer = new ResizeObserver(render);
  observer.observe(container);
  const unsubscribe = store.subscribe((state) => {
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
