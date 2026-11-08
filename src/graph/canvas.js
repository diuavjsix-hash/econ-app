import { interactionFor } from './interactions.js';
import { renderEditingHandles } from './editing-handles.js';
import { SVG_RENDERER, STROKE_RENDERER } from './svg-renderer.js';
import { objectModel } from '../models/objects.js';
import { displayedLineSegments, displayedCurveSegments, lineDisplayRegions } from './display.js';
import { createViewport, toScreen as projectPoint, toWorld } from './viewport.js';
import { pointCoordinatesLabel } from './point.js';
import { SnapTargetCache, snapPoint } from './snap.js';
import { LINE_END_ACTIONS } from './line-extent.js';
import { geometryKey, independentSnapState } from './snap-context.js';
import { objectsOf, selectedIdsOf } from '../objects.js';
import { distance, displayedSketchMinimum } from './sketch.js';
import { drawSketch } from './sketch-view.js';
import { axisAlignedSnap } from './movement.js';
import { selectionRectangle, objectsInRectangle } from './selection.js';
import { snapSegmentPoint } from './segment-magnets.js';
import { buildFillRegions, fillLabelPosition } from './fill.js';
import { renderSnapFeedback } from './snap-feedback.js';
import { CREATION_TOOLS } from './creation-tools.js';
import { toolModeOf, usesDrawingPointer } from '../tool-modes.js';

let nextCanvasId = 1;
const element = (...args) => SVG_RENDERER.element(...args);

export function mountGraph(container, store) {
  const canvasId = nextCanvasId++;
  const clipId = `plot-clip-${canvasId}`, lineClipId = `line-display-clip-${canvasId}`;
  const svg = element('svg', { 'aria-label': '그래프 편집 화면', class: 'graph-svg', tabindex:0 });
  container.append(svg);
  let currentState = store.getState();
  let viewport;
  let drag = null;
  let marquee = null;
  let snapTarget = null;
  let tangentSnap = null;
  let segmentSnap = null;
  let pointer = null;
  const snapCache = new SnapTargetCache();
  let fillCache = { signature: '', regions: [] };
  // One plain session per creation tool; CREATION_TOOLS owns their pointer behavior.
  const creationSessions = Object.fromEntries(Object.entries(CREATION_TOOLS).map(([mode, tool]) => [mode, tool.createSession()]));
  const activeCreation = () => { const mode = toolModeOf(currentState); return CREATION_TOOLS[mode] ? { tool: CREATION_TOOLS[mode], session: creationSessions[mode] } : null; };
  const fillLabelCache = new Map();

  function fillRegions() {
    const signature = geometryKey({ ...currentState, axisGapEnabled: false }, viewport.bounds);
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
  function segmentTargets() {
    return snapCache.get(currentState, viewport.bounds, drag?.object.id ?? null);
  }
  // Placed points to snap to, without the dragged shape and the points following it.
  function snapPoints() {
    return independentSnapState(currentState, drag?.object.id ?? null).points ?? [];
  }
  function segmentOptions(event, axis = null, guide = null) {
    return { axis, guide, previous: segmentSnap, enabled: currentState.segmentSnap, altKey: event.altKey,
      points: snapPoints(), bounds: viewport.bounds };
  }
  // A guide ({anchor, slope}) keeps the snapped point on that line, as for a line end handle.
  function segmentPosition(point, event, axis = null, guide = null) {
    segmentSnap = snapSegmentPoint(point, segmentTargets(), viewport.unit, segmentOptions(event, axis, guide));
    snapTarget = segmentSnap;
    return segmentSnap?.point ?? point;
  }

  function snappedPosition(point, event, axis=null) {
    const previous=snapTarget;
    snapTarget = null;
    const { bounds } = viewport;
    // The two-point line tool uses the segment snap and its toggle.
    if (currentState.lineSelected) return segmentPosition(point, event);
    const snapping = currentState.pointSnap;
    if (!snapping || event.altKey || point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax) return point;
    snapTarget = snapPoint(point, snapCache.get(currentState, bounds, drag?.object.id ?? null), viewport.unit,{previous,axis,points:snapPoints(),bounds});
    return snapTarget?.point ?? point;
  }

  // Route every operation to the one feedback renderer; hover never rebuilds geometry.
  function updateSnapFeedback(position) {
    const layer = svg.querySelector('.snap-feedback-layer');
    if (!layer) return;
    const drawingPointer=usesDrawingPointer(currentState);
    svg.classList.toggle('is-mouse-adjusting',drawingPointer);
    const rect = svg.getBoundingClientRect();
    const inside = pointer && pointer.clientX >= rect.left && pointer.clientX <= rect.right
      && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom;
    const visible = inside && drawingPointer && pointer.pointerType!=='touch';
    svg.classList.toggle('has-mouse-cursor',Boolean(visible));
    let candidate=null,point=position,coordinates=false;
    if (drag) {
      if (drag.object.type==='line'&&Object.hasOwn(LINE_END_ACTIONS,drag.action)) {candidate=tangentSnap;coordinates=true;}
      else if (['line','curve','sketch'].includes(drag.object.type)&&(drag.action==='move'||drag.object.type==='line'&&drag.action==='rotate')) candidate=tangentSnap;
      else if (drag.object.type==='point'||['sketch-start','sketch-end','sketch-middle'].includes(drag.action)) {candidate=snapTarget;coordinates=true;}
    } else if (inside&&drawingPointer) {
      const creation=activeCreation(),hover=creation?.tool.feedback(creation.session,creationContext,point);
      point=hover?hover.point:point??snappedPosition(worldPoint(pointer),pointer);
      candidate=hover?hover.candidate:snapTarget;
      coordinates=true;
    }
    if (candidate&&drag) {
      const object=objectsOf(currentState).find(object=>object.id===drag.object.id);
      const key=drag.object.type==='point'?'anchor'
        :['sketch-start','sketch-end','sketch-middle'].includes(drag.action)?(drag.action==='sketch-middle'?'anchor':drag.action.slice(7)):null;
      // Relations or validation may reject a handle move. Never show a match the shape did not adopt.
      if (key&&object?.[key]&&distance(object[key],candidate.point)>1e-8) candidate=null;
    }
    if (!candidate&&visible&&!drag) candidate={kind:'free',point:point??worldPoint(pointer)};
    for (const line of svg.querySelectorAll('.line-draft')) line.classList.toggle('is-snapped',Boolean(candidate&&candidate.kind!=='free'));
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
    for (const [mode, tool] of Object.entries(CREATION_TOOLS)) if (tool.svgClass) svg.classList.toggle(tool.svgClass, toolModeOf(currentState) === mode);
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
    svg.append(fillLayer);
    appendCreationLayers('fills');
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
    if (currentState.quadrantMode==='edgeworth') {
      const opposite=toScreen({x:bounds.xMax,y:bounds.yMax}),b=element('g',{class:'graph-axes','aria-label':'B 좌표축'});
      b.append(element('line',{x1:plot.left,y1:opposite.y,x2:plot.right,y2:opposite.y}),
        element('line',{x1:opposite.x,y1:plot.top,x2:opposite.x,y2:plot.bottom}),
        element('path',{d:`M${cx+7*xDirection} ${opposite.y-4}l${-7*xDirection} 4 ${7*xDirection} 4 M${opposite.x-4} ${cy-7*yDirection}l4 ${7*yDirection} 4 ${-7*yDirection}`,fill:'none'}));
      svg.append(b);
      axisName(currentState.boxAxisNames.x,{x:cx+10*xDirection,y:opposite.y+(yDirection===1?-16:24),'text-anchor':xDirection===1?'start':'end','aria-label':`B 수평축 ${currentState.boxAxisNames.x}`},plot.right-plot.left-20);
      axisName(currentState.boxAxisNames.y,{x:opposite.x-13*xDirection,y:cy+(yDirection===1?-7:13),'text-anchor':xDirection===1?'end':'start','aria-label':`B 수직축 ${currentState.boxAxisNames.y}`},plot.right-plot.left-26);
      axisName('Oₐ',{x:cx-10*xDirection,y:cy+20*yDirection,'text-anchor':xDirection===1?'end':'start'},40);
      axisName('Oᵦ',{x:opposite.x+10*xDirection,y:opposite.y-12*yDirection,'text-anchor':xDirection===1?'start':'end'},40);
    }

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
      const model=objectModel(line),pieces=model.visiblePieces(bounds,currentState);
      if (!pieces.length) continue;
      shapes.append(STROKE_RENDERER.render(line,pieces,viewport,{
        quadratic:model.quadratic,connect:model.quadratic,groupClass:line.type==='curve'?'graph-curve':`graph-line${line.style==='dashed'?' is-dashed':''}`,
        selected:selectedIds.has(line.id),clipId:lineClipId,title:`${line.name} · 드래그하여 이동`,
      }));
    }

    for (const sketch of currentState.sketches) shapes.append(drawSketch(sketch,viewport,currentState,{selected:selectedIds.has(sketch.id),clipId:lineClipId}));
    appendCreationLayers('sketches');
    for (const sum of currentState.sums) {
      const pieces=objectModel(sum).visiblePieces(bounds,currentState);
      if (pieces.length) shapes.append(STROKE_RENDERER.render(sum,pieces,viewport,{
        groupClass:'graph-sum',selected:selectedIds.has(sum.id),clipId:lineClipId,action:'select',title:`${sum.name} · 원본을 수정하면 자동 갱신`,
      }));
    }
    appendCreationLayers('lines');
    const pointLayer = element('g', { class: 'graph-points' });
    svg.append(pointLayer);
    for (const sketch of currentState.sketches) {
      const minimum=displayedSketchMinimum(sketch,bounds,currentState);
      if (!minimum) continue;
      const p=toScreen(minimum), marker=element('g',{'data-minimum-for':sketch.id,'pointer-events':'none','aria-label':`${sketch.name} 최저점`});
      marker.append(element('circle',{cx:p.x,cy:p.y,r:4.5,fill:sketch.color}),
        element('text',{x:Math.max(8,Math.min(width-50,p.x+10)),y:Math.max(16,p.y-10),class:'point-name'},'최저점'));
      pointLayer.append(marker);
    }
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
    const handles=renderEditingHandles(selected,viewport,currentState,lineClipId);
    if (handles) svg.append(handles);
  }

  // Draft layers keep their place in the SVG order; only the active tool draws into one.
  function drawCreation(tool, layer, options) {
    layer.replaceChildren();
    const creation = activeCreation();
    if (creation?.tool === tool) tool.draw(creation.session, layer, creationContext, options);
  }
  function appendCreationLayers(slot) {
    for (const [mode, tool] of Object.entries(CREATION_TOOLS)) if (tool.slot === slot) {
      const layer = element('g', { ...tool.layerAttributes(creationContext), 'data-creation-layer': mode });
      svg.append(layer); drawCreation(tool, layer, { rendering: true });
    }
  }
  const creationContext = {
    get state() { return currentState; }, get viewport() { return viewport; }, get pointer() { return pointer; },
    get snapTarget() { return snapTarget; }, get segmentSnap() { return segmentSnap; }, store, clipId,
    setSegmentSnap(value) { segmentSnap = value; },
    worldPoint: event => worldPoint(event), snappedPosition: (...args) => snappedPosition(...args), segmentPosition: (...args) => segmentPosition(...args),
    inside: point => point.x >= viewport.bounds.xMin && point.x <= viewport.bounds.xMax && point.y >= viewport.bounds.yMin && point.y <= viewport.bounds.yMax,
    capturePointer: id => svg.setPointerCapture(id),
    releasePointer: id => { if (id != null && svg.hasPointerCapture(id)) svg.releasePointerCapture(id); },
    redraw(tool) {
      const mode = Object.keys(CREATION_TOOLS).find(key => CREATION_TOOLS[key] === tool), layer = svg.querySelector(`[data-creation-layer="${mode}"]`);
      if (layer) drawCreation(tool, layer);
    },
    updateSnapFeedback: point => updateSnapFeedback(point),
    fillRegions: () => fillRegions(), fillPath: fill => fillPath(fill), appendFillLabel: (...args) => appendFillLabel(...args),
  };

  function snappedMove(anchor,event,axis) {
    const candidate=snappedPosition(anchor,event,axis),aligned=axisAlignedSnap(anchor,candidate,axis);
    if (!aligned) {snapTarget=null;return anchor;}
    return aligned;
  }
  function interactionContext() {
    return {state:currentState,viewport,snappedMove,segmentPosition,segmentTargets,snapTargets:segmentTargets,segmentOptions,tangentSnap};
  }
  function applyInteraction(result) {
    if (!result) return;
    if (Object.hasOwn(result,'tangentSnap')) tangentSnap=result.tangentSnap;
    if (Object.hasOwn(result,'segmentSnap')) segmentSnap=result.segmentSnap;
    if (result.patch) store.updateSelected(result.patch);
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
    // Canvas pointer handlers prevent the browser's normal focus change. Finish a
    // preceding inspector input before starting a separate drawing/drag history step.
    if (event.button===0 && document.activeElement?.matches('input,textarea,[contenteditable="true"]')) document.activeElement.blur();
    pointer = event;
    if (event.button !== 0) return;
    const creation = activeCreation();
    if (creation?.tool.pointerDown(creation.session, event, creationContext)) return;
    if (currentState.duplicatePanel) {
      event.preventDefault();
      store.selectObject(event.target.closest('[data-id]')?.dataset.id ?? null);
      return;
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
    const controller=interactionFor(object);
    if (!controller.canDrag(object,target.dataset.action)) {event.preventDefault();store.selectObject(object.id);return;}
    const anchor=controller.start(object,interactionContext());
    if (!anchor) return;
    const startPatch=controller.startPatch(object,anchor);
    drag = { pointerId: event.pointerId, action: target.dataset.action, start: worldPoint(event), object: { ...structuredClone(object), ...startPatch } };
    segmentSnap = null;
    snapTarget = null; tangentSnap = null;
    store.beginHistory();
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
    store.selectObject(object.id);
    store.updateSelected(startPatch);
  });
  const movePointer = (event) => {
    pointer = event;
    if (marquee) {updateMarquee(event);return;}
    const creation = activeCreation();
    if (!drag && creation?.tool.pointerMove(creation.session, event, creationContext)) return;
    if (!drag) {
      updateSnapFeedback();
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    const point = worldPoint(event);
    applyInteraction(interactionFor(drag.object).drag(drag.object,drag.action,drag.start,point,event,interactionContext()));
  };
  svg.addEventListener('pointermove',movePointer);
  const refreshModifiers = event => {
    if (!['Alt','Shift'].includes(event.key)||!pointer||document.querySelector('dialog[open]')
      ||event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (!drag&&!usesDrawingPointer(currentState)) return;
    movePointer({pointerId:pointer.pointerId,pointerType:pointer.pointerType,clientX:pointer.clientX,clientY:pointer.clientY,
      button:pointer.button,buttons:pointer.buttons,target:pointer.target,altKey:event.altKey,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey});
  };
  document.addEventListener('keydown',refreshModifiers);
  document.addEventListener('keyup',refreshModifiers);
  const stopDrag = (event) => {
    const creation = activeCreation();
    if (event.type==='pointercancel'&&!drag) {
      pointer=null;snapTarget=null;segmentSnap=null;
      creation?.tool.clearHover(creation.session,creationContext);updateSnapFeedback();
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
    if (!drag) creation?.tool.pointerEnd(creation.session, event, creationContext);
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    snapTarget = null;
    tangentSnap = null;
    segmentSnap = null;
    svg.classList.remove('is-dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    store.endHistory();
    render();
  };
  svg.addEventListener('pointerenter', (event) => { pointer = event; updateSnapFeedback(); });
  svg.addEventListener('pointerleave', () => {
    if (drag || marquee) return;
    pointer = null; segmentSnap=null; snapTarget=null;
    const creation = activeCreation();
    creation?.tool.clearHover(creation.session, creationContext);
    updateSnapFeedback();
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
    if (!line) return;
    if (event.key.startsWith('Arrow')) applyInteraction(interactionFor(line).keyboard(line,action,event,interactionContext()));
    // Rendering recreates SVG nodes, so restore keyboard focus to the same control.
    [...svg.querySelectorAll('[data-id]')].find((node) => node.dataset.id === id && node.getAttribute('aria-label') === label)?.focus();
  });

  const observer = new ResizeObserver(render);
  observer.observe(container);
  const unsubscribe = store.subscribe((state) => {
    if (state.historyRevision!==currentState.historyRevision || state.activeDiagramId!==currentState.activeDiagramId
      ||toolModeOf(state)!==toolModeOf(currentState)||state.pointSnap!==currentState.pointSnap) {
      snapTarget=null;tangentSnap=null;segmentSnap=null;
    }
    if (state.historyRevision !== currentState.historyRevision || state.activeDiagramId !== currentState.activeDiagramId
      || !state.segmentSnap) segmentSnap = null;
    if (marquee && (!state.handSelected || state.historyRevision!==currentState.historyRevision)) cancelMarquee(false);
    // Every tool drops its own stale draft, including tools that were just switched off.
    for (const [mode, tool] of Object.entries(CREATION_TOOLS)) tool.sync(creationSessions[mode], state, currentState, creationContext);

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
