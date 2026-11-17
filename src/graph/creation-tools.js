import { ROLE_COLORS } from '../models/palette.js';
import { SVG_RENDERER } from './svg-renderer.js';
import { toScreen } from './viewport.js';
import { directionOf } from './math.js';
import { displayedLineSegments } from './display.js';
import { lineFromPoints } from './line-extent.js';
import { constrainRuler, directionLock, alongDirection } from './ruler.js';
import { curveTangentsAt } from './curve-contacts.js';
import { drawSketch } from './sketch-view.js';
import { distance, draftSketch, sketchAnchorIndex } from './sketch.js';
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
  /** A key while the tool is active (no modifier, not in a field); true when the tool took it. */
  keyDown() { return false; }
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
    // The point records what its magnet aligned it to (a link), next to its coordinates.
    if (ctx.inside(point)) { const placed = ctx.snappedPosition(point, event); ctx.store.addPoint(placed, { snap: ctx.snapTarget }); }
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
    // The Shift axis lock shows like the tangent lock: marker at the start, no highlighted shape.
    if (lock?.axis) session.draft.lock = { point: { ...anchor }, kind: 'direction', label: lock.axis === 'x' ? '수평 맞춤' : '수직 맞춤', ids: [], key: `shift-axis:${lock.axis}` };
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
    const completed = session.draft, endSnap = ctx.segmentSnap; session.draft = null;
    ctx.setSegmentSnap(null);
    ctx.releasePointer(completed?.pointerId);
    if (completed) this.commit(completed, ctx, endSnap);
    ctx.redraw(this);
  }
  pointerDown(session, event, ctx) {
    if (!session.draft && this.editsTarget(event.target.closest('[data-id]'), ctx)) return false;
    event.preventDefault();
    if (session.draft) { session.draft.end = this.position(session, event, ctx, session.draft.anchor); this.finish(session, ctx); return true; }
    if (!ctx.inside(ctx.worldPoint(event))) return true;
    const anchor = this.position(session, event, ctx);
    session.draft = { anchor, end: { ...anchor }, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      tangents: this.startTangents(ctx.segmentSnap, anchor, ctx), lock: null, startSnap: ctx.segmentSnap };
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
  /** The line records the targets of both clicks, and a Shift tangent lock as touching that curve. */
  commit(draft, ctx, endSnap = null) {
    const tangent = draft.lock?.kind === 'tangent' ? draft.lock : null;
    ctx.store.addLine(draft.anchor, draft.end, { kind: ctx.state.lineKind, style: ctx.state.lineStyle, snaps: { start: draft.startSnap, end: endSnap, ...(tangent ? { shape: tangent } : {}) } });
  }
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

const SKETCH_DOUBLE_MS = 450, SKETCH_DOUBLE_PX = 6;
const modeTangent = mode => mode === 'horizontal' ? { x: 1, y: 0 } : mode === 'vertical' ? { x: 0, y: 1 } : null;
/**
 * The free curve, drawn like the curve tool of slide software: left clicks place points in the
 * order the curve passes them, and a double click (or Enter) makes the last one the end. Start,
 * one point, end is the original three-point curve. Every click snaps like a point; a point after
 * the start touches a line it lands on (the end only snaps).
 */
export class SketchCreation extends CreationTool {
  get slot() { return 'sketches'; }
  layerAttributes() { return { class: 'sketch-draft-layer', 'pointer-events': 'none' }; }
  /** clicks: { point, tangent, snap } where the curve passes, and `plain`/`plainSnap` if it ends there. */
  createSession() { return { clicks: [], hover: null, notice: '', lastPress: null }; }
  reset(session) { session.clicks = []; session.hover = null; session.notice = ''; session.lastPress = null; }
  tangentTarget(point, event, ctx, session) {
    return snapSketchTangent(point, ctx.state, ctx.viewport.bounds, ctx.viewport.unit, { previous: session.hover?.target,
      altKey: event.altKey, enabled: ctx.state.pointSnap, directId: event.target?.closest?.('[data-id]')?.dataset.id });
  }
  /** A point after the start touches a line, unless a placed point was just snapped: **점 맞춤** comes first. */
  passTarget(raw, event, ctx, session) {
    return ctx.snapTarget?.kind === 'point' ? null : this.tangentTarget(raw, event, ctx, session);
  }
  /**
   * The curve through the clicks, ending at `end` ({ point }) or else at the last click.
   * Needs a start, one inner point and an end; returns the draftSketch result or null.
   */
  draft(clicks, end, mode) {
    const last = end ?? (clicks.length ? { point: clicks.at(-1).plain } : null);
    const inner = end ? clicks.slice(1) : clicks.slice(1, -1);
    if (!clicks.length || !last || !inner.length) return null;
    const start = clicks[0].plain, anchorIndex = sketchAnchorIndex(start, last.point, inner.map(knot => knot.point), mode);
    return { start, end: last.point, inner, anchorIndex, result: draftSketch({ start, end: last.point, inner, anchorIndex, anchorTangent: modeTangent(mode) }) };
  }
  /** Make the curve ending at the last click; a notice when there are too few points. */
  finish(session, ctx) {
    const drawn = this.draft(session.clicks, null, ctx.state.sketchMode);
    if (!drawn) { session.notice = '점을 하나 더 찍은 뒤 끝내세요.'; ctx.redraw(this); return; }
    const { start, end, inner, anchorIndex } = drawn, anchor = inner[anchorIndex], first = session.clicks[0], last = session.clicks.at(-1);
    // Touching a line sets that point's direction once and is recorded as a link (follow: false).
    const id = ctx.store.addSketch(start, end, anchor.point, { tangent: anchor.tangent, before: inner.slice(0, anchorIndex), after: inner.slice(anchorIndex + 1),
      snaps: { start: first.plainSnap, end: last.plainSnap, anchor: anchor.snap } });
    if (id) this.reset(session); else session.notice = '점이 겹치지 않게 찍으세요.';
    ctx.redraw(this);
  }
  pointerDown(session, event, ctx) {
    event.preventDefault();
    const raw = ctx.worldPoint(event);
    if (!ctx.inside(raw)) return true;
    const press = session.lastPress, double = press && event.timeStamp - press.time < SKETCH_DOUBLE_MS && Math.hypot(event.clientX - press.x, event.clientY - press.y) < SKETCH_DOUBLE_PX;
    session.lastPress = double ? null : { time: event.timeStamp, x: event.clientX, y: event.clientY };
    // The second press of a double click ends the curve where the first one placed its point.
    if (double) { if (session.clicks.length > 1) this.finish(session, ctx); return true; }
    const plain = ctx.snappedPosition(raw, event), plainSnap = ctx.snapTarget;
    const target = session.clicks.length ? this.passTarget(raw, event, ctx, session) : null;
    const click = { point: target?.point ?? plain, tangent: target ? directionOf(target.line.slope) : null, snap: target ?? plainSnap, plain, plainSnap };
    const previous = session.clicks.at(-1);
    if (previous && distance(previous.point, click.point) < 1e-6) return true;
    session.clicks.push(click); session.notice = ''; ctx.redraw(this);
    return true;
  }
  /** Enter ends the curve at the last point; Backspace takes the last point back. */
  keyDown(session, event, ctx) {
    if (!session.clicks.length || !['Enter', 'Backspace'].includes(event.key)) return false;
    // A press after a key never pairs with the press before it into a double click.
    session.lastPress = null;
    if (event.key === 'Enter') { this.finish(session, ctx); return true; }
    session.clicks.pop(); session.notice = ''; ctx.redraw(this);
    return true;
  }
  pointerMove(session, event, ctx) {
    const raw = ctx.worldPoint(event);
    session.hover = { point: ctx.snappedPosition(raw, event), target: session.clicks.length ? this.passTarget(raw, event, ctx, session) : null };
    ctx.redraw(this); ctx.updateSnapFeedback(session.hover.target?.point ?? session.hover.point);
    return true;
  }
  clearHover(session, ctx) { session.hover = null; ctx.redraw(this); }
  sync(session, next, previous) {
    const history = next.historyRevision !== previous.historyRevision;
    if (history || next.activeDiagramId !== previous.activeDiagramId || next.pointSnap !== previous.pointSnap || toolModeOf(next) !== toolModeOf(previous)) session.hover = null;
    if ((!next.sketchSelected || history) && session.clicks.length) this.reset(session);
  }
  draw(session, layer, ctx) {
    const { viewport, state } = ctx, { clicks, hover } = session;
    const status = document.querySelector('#sketch-step');
    if (status && state.sketchSelected) status.textContent = clicks.length ? '좌클릭: 지나는 점 · 더블클릭 또는 Enter: 끝점' : '시작점을 찍으세요.';
    // The preview runs through every click to the pointer; on a click (pointer on the last point)
    // or off the canvas it ends at the last click, so the curve never blinks out.
    const at = hover ? hover.target?.point ?? hover.point : null;
    const toPointer = at && clicks.length && distance(clicks.at(-1).point, at) > 1e-6 ? { point: at } : null;
    const preview = (toPointer && this.draft(clicks, toPointer, state.sketchMode)?.result) || this.draft(clicks, null, state.sketchMode)?.result;
    if (preview) layer.append(drawSketch(preview.curve, viewport, state, { preview: true }));
    else if (clicks.length) {
      const ends = toPointer ? [clicks.at(-1).point, toPointer.point] : clicks.length === 2 ? [clicks[0].point, clicks[1].point] : null;
      if (ends) {
        const [a, b] = ends.map(point => toScreen(point, viewport));
        layer.append(element('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sketch-guide', stroke: ROLE_COLORS.sketch }));
      }
    }
    clicks.forEach((click, index) => {
      const p = toScreen(click.point, viewport);
      layer.append(element('circle', { cx: p.x, cy: p.y, r: index ? 4 : 5, fill: ROLE_COLORS.sketch, ...(index ? { class: 'sketch-pass' } : {}) }));
      if (!index) layer.append(element('text', { x: p.x + 9, y: p.y - 9, class: 'sketch-step-label' }, '시작'));
    });
    if (!state.sketchSelected) return;
    const x = viewport.plot.left + 8, y = viewport.plot.top + 8, width = Math.min(264, viewport.plot.right - x - 8);
    const title = clicks.length ? `곡선 · 점 ${clicks.length}개` : '곡선 · 시작점';
    const hint = session.notice || (!clicks.length ? '좌클릭으로 시작점 · Esc 취소' : hover?.target ? '접점에 맞춤 · 좌클릭 추가' : '좌클릭 지나는 점 · 더블클릭 끝점');
    const banner = element('g', { class: 'sketch-stage-banner', 'data-sketch-points': clicks.length, role: 'status', 'aria-live': 'polite' });
    banner.append(element('rect', { x, y, width, height: 54, rx: 8 }),
      element('text', { x: x + 12, y: y + 21, class: 'sketch-stage-title' }, title),
      element('text', { x: x + 12, y: y + 41, class: 'sketch-stage-hint' }, hint));
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
