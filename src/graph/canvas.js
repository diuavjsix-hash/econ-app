import { displayedLineSegments, displayedCurveSegments, lineDisplayRegions, isLinePointVisible, lineEditingGeometry } from './display.js';
import { drawDashedLine } from './dashed-view.js';
import { constrainRuler, translateRuler } from './ruler.js';
import { angleFromSlope, slopeFromAngle, directionOf } from './math.js';
import { createViewport, toScreen as projectPoint, toWorld } from './viewport.js';
import { bendFromPoint, curvePoint } from './curve.js';
import { pointCoordinatesLabel } from './point.js';
import { buildSnapTargets, snapPoint } from './snap.js';
import { objectsOf, selectedIdsOf } from '../objects.js';
import { displayedSumSegments } from './sum.js';
import { projectOnLine, unitVector, validSketch, distance, sketchHandlePoints, translatedSketch } from './sketch.js';
import { drawSketch } from './sketch-view.js';
import { snapMovingCurve } from './point-magnets.js';
import { snapMovingLine } from './intercepts.js';
import { dragTranslation, axisAlignedSnap } from './movement.js';
import { isIndifference, moveIndifference, indifferenceShapeHandle, shapeIndifference } from './indifference.js';
import { selectionRectangle, objectsInRectangle } from './selection.js';
import { snapDashedPoint, snapMovingDashed } from './dashed-magnets.js';
import { buildFillRegions, findFillRegion, fillKey, fillLabelPosition } from './fill.js';
import { renderSnapFeedback } from './snap-feedback.js';
import { snapSketchTangent } from './sketch-magnets.js';

let nextCanvasId = 1;
const SVG_NS = 'http://www.w3.org/2000/svg';
function element(tag, attributes, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountGraph(container, store) {
  const canvasId = nextCanvasId++;
  const clipId = `plot-clip-${canvasId}`, lineClipId = `line-display-clip-${canvasId}`;
  const svg = element('svg', { 'aria-label': '그래프 편집 화면', class: 'graph-svg', tabindex:0 });
  container.append(svg);
  let currentState = store.getState();
  let viewport;
  let drag = null;
  let marquee = null;
  let draft = null;
  let sketchDraft = [];
  let sketchHover = null;
  let snapTarget = null;
  let tangentSnap = null;
  let dashedSnap = null;
  let pointer = null;
  let snapCache = { signature: '', targets: null };
  let fillCache = { signature: '', regions: [] }, fillHover = null, fillMessage = '';
  const fillLabelCache = new Map();

  function fillRegions() {
    const signature = JSON.stringify([viewport.bounds, currentState.lines, currentState.curves, currentState.sketches, currentState.sums, currentState.dashedLines]);
    if (signature !== fillCache.signature) fillCache = { signature, regions: buildFillRegions(currentState, viewport.bounds) };
    return fillCache.regions;
  }
  function fillPath(fill) {
    return fill.rings.map(ring => ring.map((point, i) => {
      const p = projectPoint(point, viewport); return `${i ? 'L' : 'M'}${p.x} ${p.y}`;
    }).join(' ') + 'Z').join(' ');
  }
  function appendFillLabel(layer, fill, cacheId) {
    if (!fill.label) return;
    const signature = JSON.stringify([fill.rings, viewport.bounds]);
    let cached = fillLabelCache.get(cacheId);
    if (cached?.signature !== signature) {
      cached = { signature, position: fillLabelPosition(fill, viewport.bounds) }; fillLabelCache.set(cacheId, cached);
    }
    const anchor = cached.position, radius = (anchor?.radius ?? 0) * viewport.unit;
    if (!anchor || radius < 4) return;
    const point = projectPoint(anchor, viewport);
    const size = Math.min(16, Math.max(8, Math.min(radius * 1.4, radius * 2 / (fill.label.length * 0.7))));
    layer.append(element('text', { x: point.x, y: point.y, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      class: 'fill-label', 'data-fill-label': cacheId, 'aria-hidden': 'true' }, fill.label));
  }
  function updateFillPreview() {
    const layer = svg.querySelector('.fill-preview-layer');
    if (!layer) return;
    layer.replaceChildren();
    if (!currentState.fillSelected) return;
    if (fillHover) {
      const existing = currentState.fills?.find(fill => fillKey(fill) === fillHover.key);
      const color = existing && currentState.fillAutoColor ? existing.color : currentState.fillColor;
      const painted = existing?.color === color && existing.opacity === currentState.fillOpacity;
      layer.append(element('path', { d: fillPath(fillHover), 'fill-rule': 'evenodd', fill: color,
        'fill-opacity': painted ? 0 : currentState.fillOpacity, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', class: 'fill-hover' }));
      if (!existing) appendFillLabel(layer, { ...fillHover, label: currentState.fillNextLabel }, 'preview');
    }
    if (fillMessage) layer.append(element('text', { x: viewport.plot.left + 12, y: viewport.plot.top + 24, class: 'fill-message', role: 'status' }, fillMessage));
  }

  function dashedTargets() {
    const state = { ...currentState, dashedLines: currentState.dashedLines.filter(line => line.id !== drag?.object.id) };
    const signature = JSON.stringify([viewport.bounds, state.axisGapEnabled, state.axisGap,
      state.lines, state.curves, state.sketches, state.sums, state.dashedLines, drag?.object.id]);
    if (signature !== snapCache.signature) snapCache = { signature, targets: buildSnapTargets(state, viewport.bounds, drag?.object.id) };
    return snapCache.targets;
  }
  function dashedOptions(event, axis = null) {
    return { axis, previous: dashedSnap, enabled: currentState.dashedSnap, altKey: event.altKey,
      points: currentState.points, bounds: viewport.bounds };
  }
  function dashedPosition(point, event, axis = null) {
    dashedSnap = snapDashedPoint(point, dashedTargets(), viewport.unit, dashedOptions(event, axis));
    snapTarget = dashedSnap;
    return dashedSnap?.point ?? point;
  }

  function snappedPosition(point, event, axis=null) {
    const previous=snapTarget;
    snapTarget = null;
    const { bounds } = viewport;
    const snapping = currentState.dashedSelected || drag?.object.type === 'dashed' ? currentState.dashedSnap : currentState.pointSnap;
    if (currentState.dashedSelected || drag?.object.type === 'dashed') return dashedPosition(point, event);
    if (!snapping || event.altKey || point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax) return point;
    const signature = JSON.stringify([
      bounds, currentState.axisGapEnabled, currentState.axisGap,
      currentState.lines.map(({ id, anchor, slope }) => [id, anchor, slope]),
      currentState.curves,
      currentState.sums,
      currentState.sketches,
      currentState.dashedLines.filter(r => r.id !== drag?.object.id).map(({ id, anchor, end }) => [id, anchor, end]),
      drag?.object.id ?? null,
    ]);
    if (signature !== snapCache.signature) snapCache = { signature, targets: buildSnapTargets(currentState, bounds, drag?.object.id ?? null) };
    snapTarget = snapPoint(point, snapCache.targets, viewport.unit,{previous,axis});
    return snapTarget?.point ?? point;
  }

  // Route every operation to the one feedback renderer; hover never rebuilds geometry.
  function updateSnapFeedback(position) {
    const layer = svg.querySelector('.snap-feedback-layer');
    if (!layer) return;
    const drawingPointer=currentState.mouseSelected || currentState.dashedSelected || currentState.sketchSelected;
    svg.classList.toggle('is-mouse-adjusting',drawingPointer);
    const rect = svg.getBoundingClientRect();
    const inside = pointer && pointer.clientX >= rect.left && pointer.clientX <= rect.right
      && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom;
    const visible = inside && drawingPointer && pointer.pointerType!=='touch';
    svg.classList.toggle('has-mouse-cursor',Boolean(visible));
    let candidate=null,point=position,coordinates=false;
    if (drag) {
      if (drag.object.type==='dashed') candidate=dashedSnap;
      else if (['line','curve','sketch'].includes(drag.object.type)&&drag.action==='move') candidate=tangentSnap;
      else if (drag.object.type==='point'||['sketch-start','sketch-end','sketch-middle'].includes(drag.action)) {candidate=snapTarget;coordinates=true;}
    } else if (inside&&drawingPointer) {
      point??=currentState.sketchSelected&&sketchHover?sketchHover.target?.point??sketchHover.point:draft?.end??snappedPosition(worldPoint(pointer),pointer);
      candidate=currentState.sketchSelected&&sketchHover?.target?sketchHover.target:currentState.dashedSelected?dashedSnap:snapTarget;
      coordinates=true;
    }
    if (candidate&&drag) {
      const object=objectsOf(currentState).find(object=>object.id===drag.object.id);
      const key=drag.object.type==='point'?'anchor':drag.object.type==='dashed'&&drag.action!=='move'?(drag.action==='start'?'anchor':'end')
        :['sketch-start','sketch-end','sketch-middle'].includes(drag.action)?(drag.action==='sketch-middle'?'anchor':drag.action.slice(7)):null;
      // Relations or validation may reject a handle move. Never show a match the shape did not adopt.
      if (key&&object?.[key]&&distance(object[key],candidate.point)>1e-8) candidate=null;
    }
    if (!candidate&&visible&&!drag) candidate={kind:'free',point:point??worldPoint(pointer)};
    for (const line of svg.querySelectorAll('.graph-dashed')) line.classList.toggle('is-snapped',Boolean(candidate&&candidate.kind!=='free'&&(line.classList.contains('dashed-preview')||line.dataset.dashedId===drag?.object.id)));
    svg.querySelector('.sketch-draft')?.classList.toggle('is-snapped',Boolean(candidate&&candidate.kind!=='free'&&currentState.sketchSelected));
    renderSnapFeedback(layer,candidate,{state:currentState,viewport,clipId,coordinates});
  }

  function render() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    viewport = createViewport(width, height, currentState.quadrantMode, currentState);
    const { cx, cy, unit, bounds, plot, xDirection, yDirection } = viewport;
    const toScreen = point => projectPoint(point, viewport);
    const selectedIds=new Set(selectedIdsOf(currentState));
    const fillIds = new Set((currentState.fills ?? []).map(fill => fill.id));
    for (const id of fillLabelCache.keys()) if (id !== 'preview' && !fillIds.has(id)) fillLabelCache.delete(id);
    svg.classList.toggle('is-filling', Boolean(currentState.fillSelected));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    svg.append(element('title', {}, '빈 공간은 드래그 선택, 도형은 드래그 이동, 흰색 점은 모양 조절입니다.'));

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

    const fillLayer = element('g', { class: 'graph-fills', 'clip-path': `url(#${clipId})` });
    for (const fill of currentState.fills ?? []) {
      const selected = selectedIds.has(fill.id);
      const path = element('path', { d: fillPath(fill), 'fill-rule': 'evenodd', fill: fill.color, 'fill-opacity': fill.opacity,
        stroke: selected ? fill.color : 'none', 'stroke-width': 2, class: `plotted-fill${selected ? ' is-selected' : ''}`,
        'data-id': fill.id, 'data-action': 'move', 'pointer-events': currentState.handSelected ? 'visiblePainted' : 'none',
        tabindex: currentState.handSelected ? 0 : -1, role: 'button', 'aria-label': `${fill.name} 이동`, 'aria-pressed': selected });
      path.append(element('title', {}, `${fill.name} · 선택하여 색 변경·이동·삭제`)); fillLayer.append(path);
    }
    svg.append(fillLayer, element('g', { class: 'fill-preview-layer', 'clip-path': `url(#${clipId})`, 'pointer-events': 'none' }));
    if (currentState.fillSelected && pointer) fillHover = findFillRegion(fillRegions(), worldPoint(pointer));
    updateFillPreview();
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
    const lineClip = element('clipPath', { id: lineClipId });
    for (const region of lineDisplayRegions(bounds, currentState)) {
      const a = toScreen({ x: region.xMin, y: region.yMin }), b = toScreen({ x: region.xMax, y: region.yMax });
      lineClip.append(element('rect', { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }));
    }
    defs.append(lineClip);
    svg.append(defs);
    // Clip geometry rather than painted strokes so the full thickness reaches each axis.
    // Only the wider interaction targets remain restricted to the mathematical domain.
    const shapes = element('g', {});
    svg.append(shapes);
    const ordered = [...currentState.lines, ...currentState.curves].sort((a, b) => Number(selectedIds.has(a.id)) - Number(selectedIds.has(b.id)));
    for (const line of ordered) {
      if (line.type === 'curve') {
        const segments = displayedCurveSegments(line, bounds, currentState);
        if (!segments.length) continue;
        let previousEnd = null;
        const d = segments.map((points) => {
          const [start, control, end] = points.map(toScreen);
          const connected = previousEnd && Math.hypot(start.x - previousEnd.x, start.y - previousEnd.y) < 1e-6;
          previousEnd = end;
          return `${connected ? '' : `M${start.x} ${start.y}`}Q${control.x} ${control.y} ${end.x} ${end.y}`;
        }).join(' ');
        const selected = selectedIds.has(line.id);
        const group = element('g', { class: 'graph-curve', style: `--line-color:${line.color}` });
        group.append(element('path', { d, class: `plotted-line${selected ? ' is-selected' : ''}`, fill: 'none', 'aria-hidden': 'true' }));
        const hit = element('path', { d, fill: 'none', class: 'line-hit', 'clip-path': `url(#${lineClipId})`, 'data-id': line.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${line.name} 이동`, 'aria-pressed': selected });
        hit.append(element('title', {}, `${line.name} · 드래그하여 이동`));
        group.append(hit);
        shapes.append(group);
        continue;
      }
      const segments = displayedLineSegments(line, bounds, currentState);
      if (!segments.length) continue;
      const d = segments.map(points => {
        const [a, b] = points.map(toScreen);
        return `M${a.x} ${a.y}L${b.x} ${b.y}`;
      }).join(' ');
      const selected = selectedIds.has(line.id);
      const group = element('g', { class: 'graph-line', style: `--line-color:${line.color}` });
      group.append(element('path', { d, fill: 'none', class: `plotted-line${selected ? ' is-selected' : ''}`, 'aria-hidden': 'true' }));
      const hit = element('path', { d, fill: 'none', class: 'line-hit', 'clip-path': `url(#${lineClipId})`, 'data-id': line.id, 'data-action': 'move', tabindex: 0, role: 'button', 'aria-label': `${line.name} 이동`, 'aria-pressed': selected });
      hit.append(element('title', {}, `${line.name} · 드래그하여 이동`));
      group.append(hit);
      shapes.append(group);
    }

    for (const sketch of currentState.sketches) shapes.append(drawSketch(sketch,viewport,currentState,{selected:selectedIds.has(sketch.id),clipId:lineClipId}));
    svg.append(element('g',{class:'sketch-draft-layer','pointer-events':'none'}));
    updateSketchDraft();
    for (const sum of currentState.sums) {
      const segments = displayedSumSegments(sum, currentState, bounds);
      if (!segments.length) continue;
      let previousEnd = null;
      const d = segments.map(([a, b]) => {
        const start = toScreen(a), end = toScreen(b);
        const connected = previousEnd && Math.hypot(start.x - previousEnd.x, start.y - previousEnd.y) < 1e-6;
        previousEnd = end;
        return `${connected ? '' : `M${start.x} ${start.y}`}L${end.x} ${end.y}`;
      }).join(' ');
      const selected = selectedIds.has(sum.id);
      const group = element('g', { class: 'graph-sum', style: `--line-color:${sum.color}` });
      group.append(element('path', { d, fill: 'none', class: `plotted-line${selected ? ' is-selected' : ''}`, 'aria-hidden': 'true' }));
      const hit = element('path', { d, fill: 'none', class: 'line-hit', 'clip-path': `url(#${lineClipId})`, 'data-id': sum.id, 'data-action': 'select', tabindex: 0, role: 'button', 'aria-label': `${sum.name} 선택`, 'aria-pressed': selected });
      hit.append(element('title', {}, `${sum.name} · 원본을 수정하면 자동 갱신`));
      group.append(hit); shapes.append(group);
    }
    for (const ruler of currentState.dashedLines) svg.append(drawDashedLine(ruler, viewport, { selected: selectedIds.has(ruler.id), editable: currentState.handSelected && selectedIds.size===1, clipId }));
    svg.append(element('g', { class: 'dashed-draft-layer', 'pointer-events': 'none' }));
    updateDraft();
    const pointLayer = element('g', { class: 'graph-points' });
    svg.append(pointLayer);
    for (const point of currentState.points) {
      const { x, y } = toScreen(point.anchor);
      if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) continue;
      const selected = selectedIds.has(point.id);
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
    const fillLabels = element('g', { class: 'fill-label-layer', 'pointer-events': 'none', 'clip-path': `url(#${clipId})` });
    for (const fill of currentState.fills ?? []) appendFillLabel(fillLabels, fill, fill.id);
    svg.append(fillLabels);
    svg.append(element('g', { class: 'snap-feedback-layer', 'pointer-events': 'none' }));
    updateSnapFeedback(drag?.object.type === 'point' ? currentState.points.find((point) => point.id === drag.object.id)?.anchor : undefined);
    if (marquee?.active) {
      const rect=selectionRectangle(marquee.start,marquee.end,bounds);
      const a=toScreen({x:rect.xMin,y:rect.yMin}),b=toScreen({x:rect.xMax,y:rect.yMax});
      svg.append(element('rect',{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),class:'selection-marquee','pointer-events':'none','aria-hidden':'true'}));
    }
    const selected = objectsOf(currentState).find((object) => object.id === currentState.selectedId);
    if (currentState.handSelected && selected?.type==='sketch') {
      svg.append(drawSketch(selected,viewport,currentState,{selected:true,editable:true,clipId:lineClipId,handlesOnly:true}));return;
    }
    if (!currentState.handSelected || !selected || ['ruler', 'point', 'group', 'dashed', 'sum', 'sketch', 'fill'].includes(selected.type)) return;
    if (selected.type === 'curve') {
      const handles = element('g', { class: 'curve-handles', style: `--line-color:${selected.color}` });
      const shapePoint=isIndifference(selected)?indifferenceShapeHandle(selected,bounds):curvePoint(selected,0.6);
      const bendPoint = toScreen(shapePoint);
      const anchor = toScreen(selected.anchor);
      const shapeLabel=selected.family==='rectangular-hyperbola'?'크기 조절':'모양 조절';
      const handle = element('circle', { cx: bendPoint.x, cy: bendPoint.y, r: 7, class: 'rotate-handle bend-handle', 'data-id': selected.id, 'data-action': isIndifference(selected)?'ic-shape':'bend', tabindex: 0, role: 'button', 'aria-label': `${selected.name} ${shapeLabel}` });
      handle.append(element('title', {}, isIndifference(selected)?`드래그하여 ${shapeLabel}`:'위아래로 드래그하여 휘어짐 조절'));
      const center = element('circle', { cx: anchor.x, cy: anchor.y, r: 5, class: 'move-handle', 'data-id': selected.id, 'data-action': 'move' });
      center.append(element('title', {}, '드래그하여 이동'));
      // A handle on an axis stays whole; an offscreen handle stays hidden.
      for (const [node, point] of [[handle, shapePoint], [center, selected.anchor]]) {
        if (isLinePointVisible(point, bounds, currentState)) handles.append(node);
      }
      svg.append(handles);
      return;
    }
    const editing = lineEditingGeometry(selected, displayedLineSegments(selected, bounds, currentState));
    if (!editing) return;
    const { points } = editing;
    const anchor = toScreen(editing.anchor);
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

  function tangentTarget(point, event) {
    return snapSketchTangent(point,currentState,viewport.bounds,viewport.unit,{previous:sketchHover?.target,
      altKey:event.altKey,enabled:currentState.pointSnap,directId:event.target?.closest?.('[data-id]')?.dataset.id});
  }
  function updateSketchDraft() {
    const layer=svg.querySelector('.sketch-draft-layer');
    if (!layer) return;
    layer.replaceChildren();
    if (currentState.sketchSelected) {
      const status=document.querySelector('#sketch-step');
      if (status) status.textContent=['시작점을 찍으세요.','끝점을 찍으세요.','지나는 점을 찍으세요. 직선 위에서는 접합니다.'][sketchDraft.length];
    }
    const points=[...sketchDraft];
    if (sketchHover && sketchDraft.length===2) {
      const {point, target}=sketchHover;
      const tangent=target ? directionOf(target.line.slope) : currentState.sketchMode==='horizontal' ? {x:1,y:0} : currentState.sketchMode==='vertical' ? {x:0,y:1} : unitVector({x:points[1].x-points[0].x,y:points[1].y-points[0].y});
      if (target && tangent.x*(points[1].x-points[0].x)+tangent.y*(points[1].y-points[0].y)<0) {tangent.x*=-1;tangent.y*=-1;}
      const curve={start:points[0],end:points[1],anchor:target?.point??point,tangent,leftReach:0.5,rightReach:0.5};
      if (validSketch(curve)) layer.append(drawSketch(curve,viewport,currentState,{preview:true}));
    } else if (sketchHover && sketchDraft.length===1) {
      const a=projectPoint(sketchDraft[0],viewport),b=projectPoint(sketchHover.point,viewport);
      layer.append(element('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'sketch-guide',stroke:'#4c8e9a'}));
    }
    points.forEach((point,index)=>{
      const p=projectPoint(point,viewport);
      layer.append(element('circle',{cx:p.x,cy:p.y,r:5,fill:'#4c8e9a'}));
      layer.append(element('text',{x:p.x+9,y:p.y-9,class:'sketch-step-label'},index===0?'시작':'끝'));
    });
    if (currentState.sketchSelected) {
      const stage=sketchDraft.length,name=['시작점','끝점','지나는 점'][stage];
      const x=viewport.plot.left+8,y=viewport.plot.top+8,width=Math.min(264,viewport.plot.right-x-8);
      const banner=element('g',{class:'sketch-stage-banner','data-sketch-step':stage+1,role:'status','aria-live':'polite'});
      banner.append(element('rect',{x,y,width,height:54,rx:8}),
        element('text',{x:x+12,y:y+21,class:'sketch-stage-title'},`곡선 · ${stage+1}/3 ${name}`),
        element('text',{x:x+12,y:y+41,class:'sketch-stage-hint'},sketchHover?.target?'접점에 맞춤 · 좌클릭으로 완성':`좌클릭으로 ${name} 지정 · Esc 취소`));
      layer.append(banner);
    }
  }
  function updateDraft() {
    const layer = svg.querySelector('.dashed-draft-layer');
    if (!layer) return;
    layer.replaceChildren();
    if (draft) layer.append(drawDashedLine(draft, viewport, { preview: true }));
    updateSnapFeedback(draft?.end);
  }
  function segmentPosition(event, anchor) {
    const point = worldPoint(event), { bounds } = viewport;
    const clamped = { x: Math.max(bounds.xMin, Math.min(bounds.xMax, point.x)), y: Math.max(bounds.yMin, Math.min(bounds.yMax, point.y)) };
    const constrained = anchor ? constrainRuler(anchor, clamped, currentState.dashedMode, event.shiftKey) : clamped;
    const axis = !anchor ? null : currentState.dashedMode === 'horizontal' ? 'x' : currentState.dashedMode === 'vertical' ? 'y'
      : event.shiftKey ? (Math.abs(clamped.x - anchor.x) >= Math.abs(clamped.y - anchor.y) ? 'x' : 'y') : null;
    return dashedPosition(constrained, event, axis);
  }
  function finishSegment() {
    const completed = draft; draft = null;
    dashedSnap = null;
    if (completed?.pointerId != null && svg.hasPointerCapture(completed.pointerId)) svg.releasePointerCapture(completed.pointerId);
    if (completed) store.addDashedLine(completed.anchor, completed.end);
    updateDraft();
  }

  function snappedMove(anchor,event,axis) {
    const candidate=snappedPosition(anchor,event,axis),aligned=axisAlignedSnap(anchor,candidate,axis);
    if (!aligned) {snapTarget=null;return anchor;}
    return aligned;
  }
  function sketchMoveAnchor(curve,anchor,axis) {
    if (!axis || !curve.binding) return anchor;
    const line=currentState.lines.find(line=>line.id===curve.binding.sourceId);
    const direction=line && directionOf(line.slope),locked=axis==='x'?'y':'x';
    return direction && direction[locked]===0?anchor:curve.anchor;
  }
  function editSketch(curve, action, point, event, start) {
    if (action==='move') {
      const moved=dragTranslation(curve.anchor,start,point,event.shiftKey);
      if (curve.binding) {
        tangentSnap=null;
        store.updateSelected({anchor:sketchMoveAnchor(curve,moved.anchor,moved.axis),translate:true});return;
      }
      const raw={...curve,...translatedSketch(curve,{x:moved.anchor.x-curve.anchor.x,y:moved.anchor.y-curve.anchor.y})};
      tangentSnap=snapMovingCurve(raw,currentState,viewport.bounds,viewport.unit,
        {previous:tangentSnap,reference:point,altKey:event.altKey,axis:moved.axis});
      const anchor=tangentSnap?.anchor??moved.anchor;
      store.updateSelected({...translatedSketch(curve,{x:anchor.x-curve.anchor.x,y:anchor.y-curve.anchor.y}),translate:true});return;
    }
    const key=action.replace('sketch-','');
    if (['start','end','middle'].includes(key)) {
      const origin=key==='middle'?curve.anchor:curve[key];
      const moved=event.shiftKey?dragTranslation(origin,start??origin,point,true):{anchor:point,axis:null};
      let anchor=snappedMove(moved.anchor,event,moved.axis);
      if (key==='middle') anchor=sketchMoveAnchor(curve,anchor,moved.axis);
      store.updateSelected({[key==='middle'?'anchor':key]:anchor});
    }
    else if (key==='tangent') {
      if (distance(point,curve.anchor)>1e-6) store.updateSelected({tangent:{x:point.x-curve.anchor.x,y:point.y-curve.anchor.y}});
    } else if (key==='leftReach' || key==='rightReach') {
      const endpoint=key==='leftReach'?curve.start:curve.end, sign=key==='leftReach'?-1:1;
      const direction=unitVector(curve.tangent);
      const length=sign*((point.x-curve.anchor.x)*direction.x+(point.y-curve.anchor.y)*direction.y);
      store.updateSelected({[key]:length/distance(endpoint,curve.anchor)});
    }
  }
  function worldPoint(event) {
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * viewport.width / bounds.width;
    const y = (event.clientY - bounds.top) * viewport.height / bounds.height;
    return toWorld({ x, y }, viewport);
  }

  function updateMarquee(event) {
    if (!marquee || marquee.pointerId!==event.pointerId) return;
    const point=worldPoint(event);
    marquee.end=point;
    if (!marquee.active && distance(marquee.start,point)*viewport.unit<4) return;
    marquee.active=true;
    const ids=objectsInRectangle(currentState,selectionRectangle(marquee.start,point,viewport.bounds));
    store.selectObjects(marquee.additive?[...marquee.base,...ids]:ids);
  }
  function cancelMarquee(restore=true) {
    if (!marquee) return;
    const previous=marquee;marquee=null;
    if (svg.hasPointerCapture(previous.pointerId)) svg.releasePointerCapture(previous.pointerId);
    if (restore) store.selectObjects(previous.base);
  }

  svg.addEventListener('pointerdown', (event) => {
    if (drag || marquee) return;
    pointer = event;
    if (event.button === 0 && currentState.fillSelected) {
      event.preventDefault();
      fillHover = findFillRegion(fillRegions(), worldPoint(event));
      fillMessage = fillHover ? '' : '닫힌 구역이 없습니다.';
      if (fillHover) store.addFill(fillHover);
      else updateFillPreview();
      return;
    }
    if (event.button === 0 && currentState.mouseSelected && currentState.activeTool === 'point') {
      const point = worldPoint(event);
      const { bounds } = viewport;
      if (point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax) store.addPoint(snappedPosition(point, event));
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if (currentState.sketchSelected) {
      event.preventDefault();
      const raw=worldPoint(event),{bounds}=viewport;
      if (raw.x<bounds.xMin || raw.x>bounds.xMax || raw.y<bounds.yMin || raw.y>bounds.yMax) return;
      const point=snappedPosition(raw,event);
      if (sketchDraft.length<2) {
        if (sketchDraft.length && distance(sketchDraft[0],point)<1e-6) return;
        sketchDraft.push(point); sketchHover=null; updateSketchDraft(); return;
      }
      const target=tangentTarget(raw,event);
      const id=store.addSketch(sketchDraft[0],sketchDraft[1],target?.point??point,{lineId:target?.line.id});
      if (id) {sketchDraft=[];sketchHover=null;updateSketchDraft();}
      return;
    }
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
      const point=worldPoint(event),bounds=viewport.bounds;
      if (currentState.handSelected && point.x>=bounds.xMin && point.x<=bounds.xMax && point.y>=bounds.yMin && point.y<=bounds.yMax) {
        marquee={pointerId:event.pointerId,start:point,end:point,base:[...selectedIdsOf(currentState)],additive:event.shiftKey||event.ctrlKey||event.metaKey,active:false};
        event.preventDefault();svg.focus({preventScroll:true});svg.setPointerCapture(event.pointerId);
      } else store.selectObject(null);
      return;
    }
    const object = objectsOf(currentState).find((item) => item.id === target.dataset.id);
    if (!object) return;
    if (currentState.handSelected && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();svg.focus({preventScroll:true});store.selectObject(object.id,{toggle:true});return;
    }
    if (object.type === 'sum') { event.preventDefault(); store.selectObject(object.id); return; }
    if (object.binding && ['point','line'].includes(object.type) && target.dataset.action==='move') {event.preventDefault();store.selectObject(object.id);return;}
    let anchor = object.anchor;
    if (object.type === 'line') {
      const editing = lineEditingGeometry(object, displayedLineSegments(object, viewport.bounds, currentState));
      if (!editing) return;
      anchor = editing.anchor;
    }
    drag = { pointerId: event.pointerId, action: target.dataset.action, start: worldPoint(event), object: { ...structuredClone(object), anchor } };
    dashedSnap = null;
    snapTarget = null; tangentSnap = null;
    store.beginHistory();
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
    store.selectObject(object.id);
    store.updateSelected({ anchor });
  });
  const movePointer = (event) => {
    pointer = event;
    if (marquee) {updateMarquee(event);return;}
    if (currentState.fillSelected && !drag) {
      fillMessage = ''; fillHover = findFillRegion(fillRegions(), worldPoint(event)); updateFillPreview(); return;
    }
    if (currentState.sketchSelected) {
      const raw=worldPoint(event);
      sketchHover={point:snappedPosition(raw,event),target:sketchDraft.length===2?tangentTarget(raw,event):null};
      updateSketchDraft();updateSnapFeedback(sketchHover.target?.point??sketchHover.point);return;
    }
    if (draft && currentState.dashedSelected) {
      draft.end = segmentPosition(event, draft.anchor); updateDraft(); updateSnapFeedback(draft.end); return;
    }
    if (!drag) {
      updateSnapFeedback();
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    const point = worldPoint(event);
    if (isIndifference(drag.object)) {
      if (drag.action==='ic-shape') store.updateSelected(shapeIndifference(drag.object,point));
      else {
        const moved=dragTranslation(drag.object.anchor,drag.start,point,event.shiftKey);
        const anchor=moveIndifference(drag.object,drag.start,point,moved.axis);
        tangentSnap=snapMovingCurve({...drag.object,anchor},currentState,viewport.bounds,viewport.unit,
          {previous:tangentSnap,reference:point,altKey:event.altKey});
        store.updateSelected({anchor:tangentSnap?.anchor??anchor});
      }
      return;
    }
    if (drag.object.type==='sketch') {
      editSketch(drag.object,drag.action,point,event,drag.start);
      return;
    }
    if (drag.object.type === 'dashed') {
      if (drag.action === 'move') {
        const moved=dragTranslation(drag.object.anchor,drag.start,point,event.shiftKey);
        const geometry=translateRuler(drag.object,{x:moved.anchor.x-drag.object.anchor.x,y:moved.anchor.y-drag.object.anchor.y},viewport.bounds);
        dashedSnap=snapMovingDashed({...drag.object,...geometry},dashedTargets(),viewport.unit,dashedOptions(event,moved.axis));
        store.updateSelected(dashedSnap?.geometry??geometry);
      }
      else {
        const origin=drag.action==='start'?drag.object.anchor:drag.object.end;
        const moved=dragTranslation(origin,drag.start,point,event.shiftKey,viewport.bounds);
        const anchor=dashedPosition(moved.anchor,event,moved.axis);
        store.updateSelected(drag.action === 'start' ? { anchor } : { end: anchor });
      }
      return;
    }
    if (drag.action === 'move') {
      const margin = ['point', 'fill'].includes(drag.object.type) ? 0 : 24 / viewport.unit;
      const bounds = viewport.bounds;
      const moved=dragTranslation(drag.object.anchor,drag.start,point,event.shiftKey,bounds,margin);
      let anchor=moved.anchor;
      if (drag.object.type === 'point') anchor = snappedMove(anchor,event,moved.axis);
      if (drag.object.type === 'line') {
        tangentSnap = snapMovingLine({...drag.object,anchor},currentState,bounds,viewport.unit,
          {previous:tangentSnap,reference:point,altKey:event.altKey,axis:moved.axis});
        anchor = tangentSnap?.anchor ?? anchor;
      }
      if (drag.object.type === 'curve') {
        tangentSnap=snapMovingCurve({...drag.object,anchor},currentState,bounds,viewport.unit,
          {previous:tangentSnap,reference:point,altKey:event.altKey,axis:moved.axis});
        anchor=tangentSnap?.anchor??anchor;
      }
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
  };
  svg.addEventListener('pointermove',movePointer);
  const refreshModifiers = event => {
    if (!['Alt','Shift'].includes(event.key)||!pointer||document.querySelector('dialog[open]')
      ||event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (!drag&&!currentState.mouseSelected&&!currentState.dashedSelected&&!currentState.sketchSelected) return;
    movePointer({pointerId:pointer.pointerId,pointerType:pointer.pointerType,clientX:pointer.clientX,clientY:pointer.clientY,
      button:pointer.button,buttons:pointer.buttons,target:pointer.target,altKey:event.altKey,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey});
  };
  document.addEventListener('keydown',refreshModifiers);
  document.addEventListener('keyup',refreshModifiers);
  const stopDrag = (event) => {
    if (event.type==='pointercancel'&&!drag) {
      pointer=null;snapTarget=null;dashedSnap=null;sketchHover=null;
      updateSketchDraft();updateSnapFeedback();
    }
    if (marquee?.pointerId===event.pointerId) {
      if (event.type==='pointerup') {
        updateMarquee(event);
        const previous=marquee;marquee=null;
        if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        if (!previous.active && !previous.additive) store.selectObject(null);
        else render();
      } else cancelMarquee();
      return;
    }
    if (draft?.pointerId === event.pointerId) {
      if (event.type === 'pointercancel') { draft = null; dashedSnap = null; updateDraft(); }
      else if (event.type === 'pointerup') {
        const moved = Math.hypot(event.clientX - draft.clientX, event.clientY - draft.clientY) >= 4;
        if (moved) { draft.end = segmentPosition(event, draft.anchor); finishSegment(); }
        else { draft.pointerId = null; if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId); }
      }
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    snapTarget = null;
    tangentSnap = null;
    dashedSnap = null;
    svg.classList.remove('is-dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    store.endHistory();
    render();
  };
  svg.addEventListener('pointerenter', (event) => { pointer = event; updateSnapFeedback(); });
  svg.addEventListener('pointerleave', () => {
    if (!drag && !marquee) { pointer = null; dashedSnap=null; snapTarget=null; fillHover=null; fillMessage=''; updateFillPreview(); sketchHover=null; updateSketchDraft(); updateSnapFeedback(); }
  });
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);
  svg.addEventListener('lostpointercapture', stopDrag);
  svg.addEventListener('keydown', (event) => {
    if (event.key==='Escape' && marquee) {event.preventDefault();event.stopPropagation();cancelMarquee();return;}
    const target = event.target.closest('[data-id]');
    if (!target) return;
    const keys = ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const id = target.dataset.id;
    if (currentState.duplicatePanel) { store.selectObject(id); return; }
    const action = target.dataset.action;
    const label = target.getAttribute('aria-label');
    if ((event.ctrlKey || event.metaKey) && ['Enter',' '].includes(event.key)) {store.selectObject(id,{toggle:true});return;}
    store.selectObject(id);
    const line = objectsOf(currentState).find((item) => item.id === id);
    if (!line || line.type === 'sum') {
      svg.querySelector(`[data-id="${id}"]`)?.focus();
      return;
    }
    const step = event.shiftKey ? 1 : 0.1;
    if (line.type==='sketch') {
      if (event.key.startsWith('Arrow')) {
        const points=sketchHandlePoints(line),key=action.replace('sketch-','');
        const origin=points[key]??line.anchor;
        editSketch(line,action,{x:origin.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)*viewport.xDirection,y:origin.y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)*viewport.yDirection},{...event,altKey:true},origin);
      }
      [...svg.querySelectorAll('[data-id]')].find(node=>node.dataset.id===id && node.dataset.action===action)?.focus();return;
    }
    if (event.key.startsWith('Arrow')) {
      if (line.type === 'dashed') {
        const delta = { x: (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) * viewport.xDirection, y: (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) * viewport.yDirection };
        if (action === 'move') store.updateSelected(translateRuler(line, delta, viewport.bounds));
        else {
          const key = action === 'start' ? 'anchor' : 'end', point = line[key], { bounds } = viewport;
          store.updateSelected({ [key]: { x: Math.max(bounds.xMin, Math.min(bounds.xMax, point.x + delta.x)), y: Math.max(bounds.yMin, Math.min(bounds.yMax, point.y + delta.y)) } });
        }
      } else if (isIndifference(line)) {
        if (action==='ic-shape') {
          if (line.family==='rectangular-hyperbola') {
            const scale=['ArrowUp','ArrowRight'].includes(event.key)?1.05:1/1.05;
            store.updateSelected(shapeIndifference(line,{x:line.anchor.x*scale,y:line.anchor.y*scale}));
          } else if (line.family==='complements') {
            const p=indifferenceShapeHandle(line);p.y+=['ArrowUp','ArrowRight'].includes(event.key)?step:-step;
            store.updateSelected(shapeIndifference(line,p));
          } else store.updateSelected({shape:line.shape*(['ArrowUp','ArrowRight'].includes(event.key)?1.05:1/1.05)});
        } else {
          const anchor={x:line.anchor.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)*viewport.xDirection,
            y:line.anchor.y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)*viewport.yDirection};
          store.updateSelected({anchor});
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
    if (state.historyRevision!==currentState.historyRevision || state.activeDiagramId!==currentState.activeDiagramId
      ||['mouseSelected','dashedSelected','sketchSelected','handSelected','fillSelected','duplicatePanel','sumPanel','pointSnap'].some(key=>state[key]!==currentState[key])) {
      snapTarget=null;tangentSnap=null;dashedSnap=null;sketchHover=null;
    }
    if (state.fillSelected !== currentState.fillSelected || state.historyRevision !== currentState.historyRevision) { fillHover=null; fillMessage=''; }
    if (state.historyRevision !== currentState.historyRevision || state.activeDiagramId !== currentState.activeDiagramId
      || state.dashedMode !== currentState.dashedMode || state.dashedSelected !== currentState.dashedSelected || !state.dashedSnap) dashedSnap = null;
    if (marquee && (!state.handSelected || state.historyRevision!==currentState.historyRevision)) cancelMarquee(false);
    if ((!state.sketchSelected || state.historyRevision!==currentState.historyRevision) && sketchDraft.length) {sketchDraft=[];sketchHover=null;}
    if (draft && (!state.dashedSelected || state.historyRevision !== currentState.historyRevision)) {
      const id = draft.pointerId; draft = null;
      if (id != null && svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
    }
    if (draft && state.dashedMode !== currentState.dashedMode) draft.end = constrainRuler(draft.anchor, draft.end, state.dashedMode);

    if (state.historyRevision !== currentState.historyRevision && drag) {
      const pointerId = drag.pointerId;
      drag = null;
      tangentSnap = null;
      svg.classList.remove('is-dragging');
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    }
    currentState = state;
    render();
  });
  return () => { observer.disconnect(); unsubscribe(); document.removeEventListener('keydown',refreshModifiers); document.removeEventListener('keyup',refreshModifiers); cancelMarquee(false); svg.remove(); };
}
