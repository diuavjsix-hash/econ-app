import { ROLE_COLORS } from '../models/palette.js';
import { SVG_RENDERER } from './svg-renderer.js';
import { toScreen } from './viewport.js';
import { directionOf } from './math.js';
import { displayedLineSegments } from './display.js';
import { lineFromPoints } from './line-extent.js';
import { constrainRuler, directionLock, alongDirection } from './ruler.js';
import { curveTangentsAt } from './curve-contacts.js';
import { drawSketch } from './sketch-view.js';
import { unitVector, validSketch, distance } from './sketch.js';
import { snapSketchTangent } from './sketch-magnets.js';
import { findFillRegion, fillKey } from './fill.js';
import { TOOL_MODES, toolModeOf } from '../tool-modes.js';

const element = (...args) => SVG_RENDERER.element(...args);

/**
 * Pointer behavior of a creation tool (line, point, curve, fill). Each canvas keeps
 * one plain session per tool; the canvas owns the shared snap state, history and
 * re-rendering, exactly as for the drag controllers in interactions.js.
 * Handlers return true when they consumed the event.
 */
export class CreationTool {
  constructor() { if (new.target === CreationTool) throw new TypeError('CreationTool is abstract'); }
  /** Where the draft layer sits: after 'fills', 'sketches' or 'lines' (above all strokes) in the SVG order. */
  get slot() { return null; }
  layerAttributes() { return null; }
  /** Class toggled on the SVG while the tool is active. */
  get svgClass() { return null; }
  createSession() { return {}; }
  pointerDown() { return false; }
  pointerMove() { return false; }
  /** pointerup / pointercancel / lostpointercapture while no shape is dragged. */
  pointerEnd() {}
  /** The pointer left the canvas or the browser cancelled it: drop hover-only state. */
  clearHover() {}
  /** Store changed; runs for every tool so an inactive one drops stale drafts. */
  sync() {}
  draw() {}
  /** {point, candidate} for the shared snap feedback, or null for the plain point magnet. */
  feedback() { return null; }
}

export class PointCreation extends CreationTool {
  pointerDown(session, event, ctx) {
    if (ctx.state.activeTool !== 'point') return false; // point creation switched off: select instead
    const point = ctx.worldPoint(event);
    if (ctx.inside(point)) ctx.store.addPoint(ctx.snappedPosition(point, event));
    event.preventDefault();
    return true;
  }
}

/**
 * Two clicks or one drag between two snapped points, with the Shift axis lock and the
 * shared segment snap. Subclasses give the mode flag, the preview and the result.
 */
export class TwoPointCreation extends CreationTool {
  get slot() { return 'lines'; }
  createSession() { return { draft: null }; }
  /** Store flag of the mode. */
  get flag() { throw new TypeError(`${this.constructor.name} must name its mode flag`); }
  directionMode() { return 'free'; }
  /** Without a draft, whether a press on this target should edit the shape instead. */
  editsTarget() { return false; }
  commit() { throw new TypeError(`${this.constructor.name} must commit its result`); }
  position(session, event, ctx, anchor = null) {
    const point = ctx.worldPoint(event), { bounds } = ctx.viewport, mode = this.directionMode(ctx.state);
    const clamped = { x: Math.max(bounds.xMin, Math.min(bounds.xMax, point.x)), y: Math.max(bounds.yMin, Math.min(bounds.yMax, point.y)) };
    if (session.draft) session.draft.lock = null;
    if (!anchor) return ctx.segmentPosition(clamped, event);
    // Shift locks the nearest of horizontal, vertical and the start's curve tangent; Alt drops the tangent.
    const lock = mode === 'free' && event.shiftKey ? directionLock(anchor, clamped, event.altKey ? [] : session.draft?.tangents ?? []) : null;
    if (lock?.direction) {
      const { direction } = lock, slope = Math.abs(direction.x) < 1e-12 ? null : direction.y / direction.x;
      const end = ctx.segmentPosition(alongDirection(anchor, clamped, direction, bounds), event, null, { anchor, slope });
      session.draft.lock = { point: { ...anchor }, kind: 'tangent', label: '접선 맞춤', ids: lock.ids, key: `shift-tangent:${lock.ids.join(',')}` };
      return end;
    }
    const constrained = constrainRuler(anchor, clamped, mode, event.shiftKey);
    const axis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : lock?.axis ?? null;
    return ctx.segmentPosition(constrained, event, axis);
  }
  /**
   * Tangents at a snapped first point of every curve through it. The snap names only one
   * target (an end, a contact…) where several coincide, so curves are found by position.
   */
  startTangents(snap, anchor, ctx) {
    if (!snap) return [];
    const ids = [...(ctx.state.curves ?? []), ...(ctx.state.sketches ?? [])].map(curve => curve.id);
    return curveTangentsAt(ctx.state, ctx.viewport.bounds, anchor, ids);
  }
  finish(session, ctx) {
    const completed = session.draft; session.draft = null;
    ctx.setSegmentSnap(null);
    ctx.releasePointer(completed?.pointerId);
    if (completed) this.commit(completed, ctx);
    ctx.redraw(this);
  }
  pointerDown(session, event, ctx) {
    if (!session.draft && this.editsTarget(event.target.closest('[data-id]'), ctx)) return false;
    event.preventDefault();
    if (session.draft) { session.draft.end = this.position(session, event, ctx, session.draft.anchor); this.finish(session, ctx); return true; }
    if (!ctx.inside(ctx.worldPoint(event))) return true;
    const anchor = this.position(session, event, ctx);
    session.draft = { anchor, end: { ...anchor }, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      tangents: this.startTangents(ctx.segmentSnap, anchor, ctx), lock: null };
    ctx.store.selectObject(null); ctx.capturePointer(event.pointerId); ctx.redraw(this);
    return true;
  }
  pointerMove(session, event, ctx) {
    if (!session.draft) return false;
    session.draft.end = this.position(session, event, ctx, session.draft.anchor);
    ctx.redraw(this); ctx.updateSnapFeedback(session.draft.end);
    return true;
  }
  pointerEnd(session, event, ctx) {
    const draft = session.draft;
    if (draft?.pointerId !== event.pointerId) return;
    if (event.type === 'pointercancel') { session.draft = null; ctx.setSegmentSnap(null); ctx.redraw(this); }
    else if (event.type === 'pointerup') {
      // A drag draws in one gesture; a click keeps the draft for a second click.
      if (Math.hypot(event.clientX - draft.clientX, event.clientY - draft.clientY) >= 4) { draft.end = this.position(session, event, ctx, draft.anchor); this.finish(session, ctx); }
      else { draft.pointerId = null; ctx.releasePointer(event.pointerId); }
    }
  }
  sync(session, next, previous, ctx) {
    if (session.draft && (!next[this.flag] || next.historyRevision !== previous.historyRevision || next.activeDiagramId !== previous.activeDiagramId)) {
      const id = session.draft.pointerId; session.draft = null; ctx.releasePointer(id);
    }
    if (session.draft && this.directionMode(next) !== this.directionMode(previous)) session.draft.end = constrainRuler(session.draft.anchor, session.draft.end, this.directionMode(next));
  }
  feedback(session, ctx, position) {
    const point = position ?? session.draft?.end ?? ctx.snappedPosition(ctx.worldPoint(ctx.pointer), ctx.pointer);
    return { point, candidate: ctx.segmentSnap ?? session.draft?.lock ?? null };
  }
}

/** The line tool: first point → second point, as the chosen kind (line, ray, segment) and style. */
export class LineCreation extends TwoPointCreation {
  get flag() { return 'lineSelected'; }
  layerAttributes(ctx) { return { class: 'line-draft-layer', 'clip-path': `url(#${ctx.clipId})`, 'pointer-events': 'none' }; }
  commit(draft, ctx) { ctx.store.addLine(draft.anchor, draft.end, { kind: ctx.state.lineKind, style: ctx.state.lineStyle }); }
  draw(session, layer, ctx) {
    const { draft } = session, { viewport, state } = ctx;
    if (draft) {
      const line = lineFromPoints(draft.anchor, draft.end, state.lineKind);
      for (const [a, b] of line ? displayedLineSegments(line, viewport.bounds, state) : []) {
        const p = toScreen(a, viewport), q = toScreen(b, viewport);
        layer.append(element('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: `line-draft${state.lineStyle === 'dashed' ? ' is-dashed' : ''}` }));
      }
      const p = toScreen(draft.anchor, viewport);
      layer.append(element('circle', { cx: p.x, cy: p.y, r: 4, class: 'line-draft-start' }));
    }
    ctx.updateSnapFeedback(draft?.end);
  }
}

const SKETCH_STEPS = ['시작점', '끝점', '지나는 점'];
export class SketchCreation extends CreationTool {
  get slot() { return 'sketches'; }
  layerAttributes() { return { class: 'sketch-draft-layer', 'pointer-events': 'none' }; }
  createSession() { return { points: [], hover: null }; }
  tangentTarget(point, event, ctx, session) {
    return snapSketchTangent(point, ctx.state, ctx.viewport.bounds, ctx.viewport.unit, { previous: session.hover?.target,
      altKey: event.altKey, enabled: ctx.state.pointSnap, directId: event.target?.closest?.('[data-id]')?.dataset.id });
  }
  pointerDown(session, event, ctx) {
    event.preventDefault();
    const raw = ctx.worldPoint(event);
    if (!ctx.inside(raw)) return true;
    const point = ctx.snappedPosition(raw, event);
    if (session.points.length < 2) {
      if (session.points.length && distance(session.points[0], point) < 1e-6) return true;
      session.points.push(point); session.hover = null; ctx.redraw(this); return true;
    }
    const target = this.tangentTarget(raw, event, ctx, session);
    const id = ctx.store.addSketch(session.points[0], session.points[1], target?.point ?? point, { lineId: target?.line.id });
    if (id) { session.points = []; session.hover = null; ctx.redraw(this); }
    return true;
  }
  pointerMove(session, event, ctx) {
    const raw = ctx.worldPoint(event);
    session.hover = { point: ctx.snappedPosition(raw, event), target: session.points.length === 2 ? this.tangentTarget(raw, event, ctx, session) : null };
    ctx.redraw(this); ctx.updateSnapFeedback(session.hover.target?.point ?? session.hover.point);
    return true;
  }
  clearHover(session, ctx) { session.hover = null; ctx.redraw(this); }
  sync(session, next, previous) {
    const history = next.historyRevision !== previous.historyRevision;
    if (history || next.activeDiagramId !== previous.activeDiagramId || next.pointSnap !== previous.pointSnap || toolModeOf(next) !== toolModeOf(previous)) session.hover = null;
    if ((!next.sketchSelected || history) && session.points.length) { session.points = []; session.hover = null; }
  }
  draw(session, layer, ctx) {
    const { viewport, state } = ctx, drafted = session.points, hover = session.hover;
    const status = document.querySelector('#sketch-step');
    if (status && state.sketchSelected) status.textContent = ['시작점을 찍으세요.', '끝점을 찍으세요.', '지나는 점을 찍으세요. 직선 위에서는 접합니다.'][drafted.length];
    if (hover && drafted.length === 2) {
      const { point, target } = hover;
      const tangent = target ? directionOf(target.line.slope) : state.sketchMode === 'horizontal' ? { x: 1, y: 0 } : state.sketchMode === 'vertical' ? { x: 0, y: 1 }
        : unitVector({ x: drafted[1].x - drafted[0].x, y: drafted[1].y - drafted[0].y });
      if (target && tangent.x * (drafted[1].x - drafted[0].x) + tangent.y * (drafted[1].y - drafted[0].y) < 0) { tangent.x *= -1; tangent.y *= -1; }
      const curve = { start: drafted[0], end: drafted[1], anchor: target?.point ?? point, tangent, leftReach: 0.5, rightReach: 0.5 };
      if (validSketch(curve)) layer.append(drawSketch(curve, viewport, state, { preview: true }));
    } else if (hover && drafted.length === 1) {
      const a = toScreen(drafted[0], viewport), b = toScreen(hover.point, viewport);
      layer.append(element('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sketch-guide', stroke: ROLE_COLORS.sketch }));
    }
    drafted.forEach((point, index) => {
      const p = toScreen(point, viewport);
      layer.append(element('circle', { cx: p.x, cy: p.y, r: 5, fill: ROLE_COLORS.sketch }));
      layer.append(element('text', { x: p.x + 9, y: p.y - 9, class: 'sketch-step-label' }, index === 0 ? '시작' : '끝'));
    });
    if (!state.sketchSelected) return;
    const stage = drafted.length, name = SKETCH_STEPS[stage];
    const x = viewport.plot.left + 8, y = viewport.plot.top + 8, width = Math.min(264, viewport.plot.right - x - 8);
    const banner = element('g', { class: 'sketch-stage-banner', 'data-sketch-step': stage + 1, role: 'status', 'aria-live': 'polite' });
    banner.append(element('rect', { x, y, width, height: 54, rx: 8 }),
      element('text', { x: x + 12, y: y + 21, class: 'sketch-stage-title' }, `곡선 · ${stage + 1}/3 ${name}`),
      element('text', { x: x + 12, y: y + 41, class: 'sketch-stage-hint' }, hover?.target ? '접점에 맞춤 · 좌클릭으로 완성' : `좌클릭으로 ${name} 지정 · Esc 취소`));
    layer.append(banner);
  }
  feedback(session, ctx, position) {
    if (!session.hover) return null;
    return { point: position ?? session.hover.target?.point ?? session.hover.point, candidate: session.hover.target ?? ctx.snapTarget };
  }
}

export class FillCreation extends CreationTool {
  get slot() { return 'fills'; }
  get svgClass() { return 'is-filling'; }
  layerAttributes(ctx) { return { class: 'fill-preview-layer', 'clip-path': `url(#${ctx.clipId})`, 'pointer-events': 'none' }; }
  createSession() { return { hover: null, message: '' }; }
  pointerDown(session, event, ctx) {
    event.preventDefault();
    session.hover = findFillRegion(ctx.fillRegions(), ctx.worldPoint(event));
    session.message = session.hover ? '' : '닫힌 구역이 없습니다.';
    if (session.hover) ctx.store.addFill(session.hover); else ctx.redraw(this);
    return true;
  }
  pointerMove(session, event, ctx) {
    session.message = ''; session.hover = findFillRegion(ctx.fillRegions(), ctx.worldPoint(event)); ctx.redraw(this);
    return true;
  }
  clearHover(session, ctx) { session.hover = null; session.message = ''; ctx.redraw(this); }
  sync(session, next, previous) {
    if (next.fillSelected !== previous.fillSelected || next.historyRevision !== previous.historyRevision) { session.hover = null; session.message = ''; }
  }
  draw(session, layer, ctx, { rendering = false } = {}) {
    const { state, viewport } = ctx;
    if (rendering && ctx.pointer) session.hover = findFillRegion(ctx.fillRegions(), ctx.worldPoint(ctx.pointer));
    if (session.hover) {
      const existing = state.fills?.find(fill => fillKey(fill) === session.hover.key);
      const color = existing && state.fillAutoColor ? existing.color : state.fillColor;
      const painted = existing?.color === color && existing.opacity === state.fillOpacity;
      layer.append(element('path', { d: ctx.fillPath(session.hover), 'fill-rule': 'evenodd', fill: color,
        'fill-opacity': painted ? 0 : state.fillOpacity, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', class: 'fill-hover' }));
      if (!existing) ctx.appendFillLabel(layer, { ...session.hover, label: state.fillNextLabel }, 'preview');
    }
    if (session.message) layer.append(element('text', { x: viewport.plot.left + 12, y: viewport.plot.top + 24, class: 'fill-message', role: 'status' }, session.message));
  }
}

/** Every creation mode in TOOL_MODES must register exactly one pointer controller. */
export function assertCreationTools(entries, modes = TOOL_MODES) {
  const expected = Object.keys(modes).filter(mode => modes[mode].kind === 'creation').sort();
  if (JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify(expected)) throw new TypeError('Every creation tool mode must register a pointer controller');
  for (const [mode, tool] of Object.entries(entries)) {
    if (!(tool instanceof CreationTool)) throw new TypeError(`Invalid creation tool: ${mode}`);
    if (tool.pointerDown === CreationTool.prototype.pointerDown) throw new TypeError(`${mode} must implement pointerDown()`);
    if (tool.slot !== null && !['fills', 'sketches', 'lines'].includes(tool.slot)) throw new TypeError(`${mode} has an unknown draft slot`);
    if (tool.slot !== null && (tool.draw === CreationTool.prototype.draw || tool.layerAttributes === CreationTool.prototype.layerAttributes)) throw new TypeError(`${mode} must draw its draft layer`);
  }
  return Object.freeze(entries);
}
export const CREATION_TOOLS = assertCreationTools({ line: new LineCreation(), point: new PointCreation(), sketch: new SketchCreation(), fill: new FillCreation() });
