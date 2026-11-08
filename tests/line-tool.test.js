import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { toolModeOf } from '../src/tool-modes.js';
import { lineFromPoints, lineKindOf, extentForKind, lineEndPoints, slopeThrough, visibleLineEnds } from '../src/graph/line-extent.js';
import { buildSnapTargets } from '../src/graph/snap.js';
import { CREATION_TOOLS, LineCreation, TwoPointCreation } from '../src/graph/creation-tools.js';

const close = (a, b, eps = 1e-9) => assert.ok(a && b && Math.hypot(a.x - b.x, a.y - b.y) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

test('two points give a line, ray or segment anchored at the first point', () => {
  const from = { x: 1, y: 2 }, to = { x: 4, y: 8 };
  const line = lineFromPoints(from, to, 'line');
  assert.equal(line.slope, 2); assert.equal(line.extent, null); assert.equal(lineKindOf(line), 'line');
  const ray = lineFromPoints(from, to, 'ray');
  assert.equal(lineKindOf(ray), 'ray'); close(lineEndPoints(ray)[0], from); assert.equal(lineEndPoints(ray)[1], null);
  const segment = lineFromPoints(from, to, 'segment');
  assert.equal(lineKindOf(segment), 'segment');
  const [a, b] = lineEndPoints(segment); close(a, from); close(b, to);
  // Drawn right to left: the ray still starts at the first point and runs through the second.
  const back = lineFromPoints(to, from, 'ray');
  assert.deepEqual(back.extent, [null, 0]); close(lineEndPoints(back)[1], to);
  const backSegment = lineEndPoints(lineFromPoints(to, from, 'segment'));
  assert.ok([backSegment[0], backSegment[1]].some(p => Math.hypot(p.x - from.x, p.y - from.y) < 1e-9));
  assert.equal(lineFromPoints(from, { ...from }, 'segment'), null);
});

test('a shared x is an exact vertical line, never a huge finite slope', () => {
  assert.equal(slopeThrough({ x: 2, y: 1 }, { x: 2, y: 5 }), null);
  assert.equal(slopeThrough({ x: 2, y: 5 }, { x: 4, y: 5 }), 0);
  assert.ok(Object.is(slopeThrough({ x: 4, y: 5 }, { x: 2, y: 5 }), 0));
  const down = lineFromPoints({ x: 2, y: 5 }, { x: 2, y: 1 }, 'segment');
  assert.equal(down.slope, null);
  const [a, b] = lineEndPoints(down);
  assert.deepEqual([a.y, b.y].sort((p, q) => p - q), [1, 5]);
});

test('the line tool returns to selection with the new line selected, keeps kind and style, and is one undo step', () => {
  const store = createStore();
  store.setToolMode('line');
  store.update({ lineKind: 'segment', lineStyle: 'dashed' });
  store.beginHistory();
  const id = store.addLine({ x: 1, y: 1 }, { x: 5, y: 3 });
  store.endHistory();
  const state = store.getState(), line = state.lines.find(line => line.id === id);
  assert.equal(toolModeOf(state), 'hand');
  assert.deepEqual(state.selectedIds, [id]);
  assert.equal(line.style, 'dashed'); assert.equal(lineKindOf(line), 'segment'); assert.match(line.name, /^선분/);
  const saved = serializeDocument(state).lines[0];
  close(saved.segment.start, { x: 1, y: 1 }); close(saved.segment.end, { x: 5, y: 3 });
  assert.equal(saved.style, 'dashed');
  store.undo();
  assert.equal(store.getState().lines.length, 0);
  // Invalid settings are ignored; a plain line has no extent key at all.
  store.update({ lineKind: 'curve', lineStyle: 'dotted' });
  assert.equal(store.getState().lineKind, 'segment'); assert.equal(store.getState().lineStyle, 'dashed');
  store.update({ lineKind: 'line', lineStyle: 'solid' });
  assert.equal(store.getState().lineKind, 'line', 'the chosen kind is kept for the next use of the tool');
  const plainId = store.addLine({ x: 0, y: 0 }, { x: 1, y: 1 });
  const plain = store.getState().lines.find(line => line.id === plainId);
  assert.equal('extent' in plain, false); assert.equal(plain.style, undefined);
  assert.equal(store.addLine({ x: 0, y: 0 }, { x: 0, y: 0 }), null);
  // The earlier no-argument call still adds the default line and returns to selection.
  store.setToolMode('line');
  const legacy = store.addLine();
  assert.equal(store.getState().selectedId, legacy); assert.equal(toolModeOf(store.getState()), 'hand');
});

test('the end of a drawn segment is a shared endpoint target for the next line', () => {
  const store = createStore();
  store.setToolMode('line'); store.update({ lineKind: 'segment' });
  const id = store.addLine({ x: 1, y: 1 }, { x: 5, y: 3 });
  const targets = buildSnapTargets(store.getState(), bounds, null);
  const ends = targets.crossings.filter(target => target.kind === 'endpoint' && target.sourceId === id);
  assert.equal(ends.length, 2);
  for (const point of [{ x: 1, y: 1 }, { x: 5, y: 3 }]) assert.ok(ends.some(target => Math.hypot(target.point.x - point.x, target.point.y - point.y) < 1e-9));
});

test('a selected line changes kind while keeping the ends it already has', () => {
  const line = { anchor: { x: 2, y: 2 }, slope: 0 };
  const edge = visibleLineEnds({ ...line, extent: null }, bounds, { quadrantMode: 'first' }).edge;
  assert.deepEqual(edge, [-2, 8]);
  assert.equal(extentForKind({ ...line, extent: [0, 3] }, 'line', edge), null);
  assert.deepEqual(extentForKind({ ...line, extent: [0, 3] }, 'ray', edge), [0, null]);
  assert.deepEqual(extentForKind({ ...line, extent: [null, 1] }, 'ray', edge), [null, 1]);
  assert.deepEqual(extentForKind(line, 'ray', edge), [3, null]);
  assert.deepEqual(extentForKind(line, 'segment', edge), [0.5, 5.5]);
  assert.deepEqual(extentForKind({ ...line, extent: [0, null] }, 'segment', edge), [0, 4]);
  assert.deepEqual(extentForKind({ ...line, extent: [null, 0] }, 'segment', edge), [-1, 0]);
  assert.equal(extentForKind(line, 'segment', null), undefined);
});

test('the line tool pointer flow: click, click or one drag; Shift locks the axis', () => {
  assert.ok(CREATION_TOOLS.line instanceof LineCreation && CREATION_TOOLS.line instanceof TwoPointCreation);
  assert.equal('dashed' in CREATION_TOOLS, false, 'the separate dashed tool is gone');
  const tool = CREATION_TOOLS.line, added = [];
  const state = { lineSelected: true, lineKind: 'segment', lineStyle: 'solid', lines: [], historyRevision: 0 };
  const ctx = {
    state, viewport: { bounds }, segmentSnap: null,
    worldPoint: event => ({ x: event.x, y: event.y }), segmentPosition: point => point,
    inside: point => point.x >= 0 && point.x <= 10 && point.y >= 0 && point.y <= 10,
    store: { selectObject() {}, addLine: (from, to, options) => added.push({ from, to, options }) },
    setSegmentSnap() {}, capturePointer() {}, releasePointer() {}, redraw() {}, updateSnapFeedback() {},
  };
  const event = (x, y, extra = {}) => ({ x, y, clientX: x * 50, clientY: -y * 50, pointerId: 1, target: { closest: () => null }, preventDefault() {}, ...extra });
  const session = tool.createSession();
  tool.pointerDown(session, event(1, 1), ctx); tool.pointerEnd(session, { ...event(1, 1), type: 'pointerup' }, ctx);
  assert.equal(added.length, 0, 'a click waits for the second point');
  tool.pointerDown(session, event(4, 3), ctx);
  assert.deepEqual(added.pop(), { from: { x: 1, y: 1 }, to: { x: 4, y: 3 }, options: { kind: 'segment', style: 'solid' } });
  tool.pointerDown(session, event(2, 2), ctx);
  tool.pointerMove(session, event(6, 2.4, { shiftKey: true }), ctx);
  tool.pointerEnd(session, { ...event(6, 2.4, { shiftKey: true }), type: 'pointerup' }, ctx);
  assert.deepEqual(added.pop().to, { x: 6, y: 2 }, 'a drag finishes in one gesture; Shift keeps it horizontal');
  // Leaving the tool drops a half-drawn line.
  tool.pointerDown(session, event(1, 1), ctx); tool.pointerEnd(session, { ...event(1, 1), type: 'pointerup' }, ctx);
  tool.sync(session, { ...state, lineSelected: false }, state, ctx);
  assert.equal(session.draft, null);
  // Presses on existing lines draw from there instead of grabbing the line.
  const onLine = event(3, 3, { target: { closest: () => ({ dataset: { id: 'line-1' } }) } });
  assert.equal(tool.pointerDown(session, onLine, { ...ctx, state: { ...state, lines: [{ id: 'line-1' }] } }), true);
});

test('every creation and duplicate returns to the selection tool with its result selected', () => {
  const store = createStore();
  const cases = [
    ['line', () => store.addLine({ x: 1, y: 1 }, { x: 3, y: 2 })],
    ['point', () => store.addPoint({ x: 2, y: 2 })],
    ['sketch', () => store.addSketch({ x: 1, y: 5 }, { x: 5, y: 5 }, { x: 3, y: 3 })],
    ['sketch', () => store.addIndifference('cobb-douglas')],
  ];
  for (const [mode, create] of cases) {
    store.setToolMode(mode);
    const id = create();
    assert.ok(id, mode);
    assert.equal(toolModeOf(store.getState()), 'hand', `${mode} returns to selection`);
    assert.equal(store.getState().selectedId, id, `${mode} selects its result`);
  }
  store.selectObject(store.getState().points[0].id);
  store.setToolMode('duplicate');
  const copy = store.duplicateSelected();
  assert.equal(toolModeOf(store.getState()), 'hand'); assert.equal(store.getState().selectedId, copy);
});

test('a free curve start and end are shared endpoint targets, excluded while editing that curve', async () => {
  const { snapPoint } = await import('../src/graph/snap.js');
  const { snapFeedbackModel } = await import('../src/graph/snap-feedback.js');
  const store = createStore(), id = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 });
  const targets = buildSnapTargets(store.getState(), bounds);
  const ends = targets.crossings.filter(target => target.kind === 'endpoint' && target.sourceId === id);
  assert.equal(ends.length, 2);
  const hit = snapPoint({ x: 7.1, y: 6.08 }, targets, 50);
  assert.equal(hit.kind, 'endpoint'); assert.equal(snapFeedbackModel(hit).label, '끝점 맞춤'); close(hit.point, { x: 7, y: 6 });
  assert.equal(buildSnapTargets(store.getState(), bounds, id).crossings.some(target => target.sourceId === id), false);
  // A new line drawn from the curve end starts exactly there.
  store.setToolMode('line'); store.update({ lineKind: 'segment' });
  store.addLine(hit.point, { x: 9, y: 2 });
  close(lineEndPoints(store.getState().lines.at(-1))[0], { x: 7, y: 6 });
});

test('Shift picks the nearest of horizontal, vertical and the given tangents', async () => {
  const { directionLock, alongDirection } = await import('../src/graph/ruler.js');
  const anchor = { x: 2, y: 2 }, diagonal = { direction: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, ids: ['c1'] };
  assert.deepEqual(directionLock(anchor, { x: 6, y: 2.4 }), { axis: 'x' }, 'without tangents it stays the axis lock');
  assert.deepEqual(directionLock(anchor, { x: 2.3, y: 6 }, [diagonal]), { axis: 'y' });
  assert.deepEqual(directionLock(anchor, { x: 6, y: 2.4 }, [diagonal]), { axis: 'x' });
  assert.deepEqual(directionLock(anchor, { x: 5, y: -0.6 }, [diagonal]).ids, ['c1'], 'a heading near the tangent locks the tangent');
  assert.deepEqual(directionLock(anchor, { x: 0, y: 4.4 }, [diagonal]).ids, ['c1'], 'either side of the start');
  // A horizontal tangent (a minimum) replaces the horizontal axis and keeps its curve.
  assert.deepEqual(directionLock(anchor, { x: 6, y: 2.4 }, [{ direction: { x: 1, y: 0 }, ids: ['m'] }]).ids, ['m']);
  assert.deepEqual(directionLock(anchor, { x: 2.1, y: 6 }, [{ direction: { x: -1, y: 0 }, ids: ['m'] }]), { axis: 'y' });
  close(alongDirection(anchor, { x: 5, y: -0.6 }, diagonal.direction), { x: 4.8, y: -0.8 });
  close(alongDirection(anchor, { x: 9, y: -5 }, diagonal.direction, bounds), { x: 4, y: 0 }, 1e-12);
  const vertical = alongDirection(anchor, { x: 2.4, y: 7 }, { x: 0, y: 1 }, bounds);
  assert.equal(vertical.x, 2, 'a vertical lock keeps the exact x');
});

test('curve tangents at a point on PPC, free curves and contacts; none at kinks or off the curve', async () => {
  const { curveTangentsAt } = await import('../src/graph/curve-contacts.js');
  const { curveFamilyOf } = await import('../src/models/curve-families.js');
  const store = createStore(), ppcId = store.addIndifference('ppc', { anchor: { x: 3, y: 3 } });
  const state = store.getState(), ppc = state.sketches.find(curve => curve.id === ppcId) ?? state.curves.find(curve => curve.id === ppcId);
  const family = curveFamilyOf(ppc), on = family.nearestPoint(ppc, { x: 2, y: 4 }, bounds);
  const [found] = curveTangentsAt(state, bounds, on, [ppcId]);
  const expected = family.tangentVector(ppc, on);
  assert.ok(found && Math.abs(found.direction.x * expected.y - found.direction.y * expected.x) < 1e-9, 'PPC tangent from its family');
  assert.deepEqual(found.ids, [ppcId]);
  assert.deepEqual(curveTangentsAt(state, bounds, { x: on.x + 0.3, y: on.y }, [ppcId]), [], 'a point off the curve has no tangent');
  assert.deepEqual(curveTangentsAt(state, bounds, on, []), []);
  const kinkId = store.addIndifference('complements', { anchor: { x: 3, y: 3 } });
  assert.deepEqual(curveTangentsAt(store.getState(), bounds, { x: 3, y: 3 }, [kinkId]), [], 'a kink has no single tangent');
  // A free curve: the original quadratic piece, here its horizontal bottom.
  const sketchId = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 });
  const [bottom] = curveTangentsAt(store.getState(), bounds, { x: 4, y: 2 }, [sketchId]);
  assert.ok(bottom && Math.abs(bottom.direction.y) < 1e-6, 'free curve tangent at its bottom is horizontal');
});

test('the line tool: Shift after a start on a curve locks its tangent, Alt drops it, feedback names it', async () => {
  const { curveFamilyOf } = await import('../src/models/curve-families.js');
  const store = createStore(), ppcId = store.addIndifference('ppc', { anchor: { x: 3, y: 3 } });
  const state = { ...store.getState(), lineSelected: true, lineKind: 'segment', lineStyle: 'solid' };
  const ppc = [...state.curves, ...state.sketches].find(curve => curve.id === ppcId), family = curveFamilyOf(ppc);
  const on = family.nearestPoint(ppc, { x: 2, y: 4 }, bounds), t = family.tangentVector(ppc, on), slope = t.y / t.x;
  const tool = CREATION_TOOLS.line, added = [], guides = [];
  const ctx = {
    state, viewport: { bounds }, segmentSnap: null,
    worldPoint: event => ({ x: event.x, y: event.y }),
    segmentPosition(point, event, axis, guide) { guides.push(guide ?? null); return point; },
    inside: point => point.x >= 0 && point.x <= 10 && point.y >= 0 && point.y <= 10,
    store: { selectObject() {}, addLine: (from, to) => added.push({ from, to }) },
    setSegmentSnap(value) { this.segmentSnap = value; }, capturePointer() {}, releasePointer() {}, redraw() {}, updateSnapFeedback() {},
  };
  const event = (x, y, extra = {}) => ({ x, y, clientX: x * 50, clientY: -y * 50, pointerId: 1, target: { closest: () => null }, preventDefault() {}, ...extra });
  const session = tool.createSession();
  // The first click landed on the PPC body (as the shared segment snap reports it).
  ctx.segmentSnap = { point: on, kind: 'shape', ids: [ppcId] };
  tool.pointerDown(session, event(on.x, on.y), ctx); ctx.segmentSnap = null;
  tool.pointerEnd(session, { ...event(on.x, on.y), type: 'pointerup' }, ctx);
  assert.equal(session.draft.tangents.length, 1);
  const heading = { x: on.x + 2, y: on.y + 2 * slope + 0.3 };
  tool.pointerMove(session, event(heading.x, heading.y, { shiftKey: true }), ctx);
  const end = session.draft.end;
  assert.ok(Math.abs((end.y - on.y) / (end.x - on.x) - slope) < 1e-9, 'the end lies on the tangent');
  assert.ok(Math.abs(guides.at(-1).slope - slope) < 1e-12 && guides.at(-1).anchor === session.draft.anchor, 'snapping stays on the tangent guide');
  const { candidate } = tool.feedback(session, ctx);
  assert.equal(candidate.label, '접선 맞춤'); assert.deepEqual(candidate.ids, [ppcId]); close(candidate.point, on);
  tool.pointerMove(session, event(heading.x, heading.y, { shiftKey: true, altKey: true }), ctx);
  assert.ok(Math.abs(session.draft.end.y - on.y) < 1e-12 || Math.abs(session.draft.end.x - on.x) < 1e-12, 'Alt+Shift keeps only the axis lock');
  assert.equal(tool.feedback(session, ctx).candidate, null);
  tool.pointerMove(session, event(heading.x, heading.y), ctx);
  close(session.draft.end, heading); assert.equal(session.draft.lock, null, 'without Shift the end is free');
  tool.pointerDown(session, event(heading.x, heading.y, { shiftKey: true }), ctx);
  const drawn = added.pop();
  assert.ok(Math.abs((drawn.to.y - drawn.from.y) / (drawn.to.x - drawn.from.x) - slope) < 1e-9, 'the second click commits the tangent line');
  // A start off every curve keeps the plain horizontal/vertical lock.
  tool.pointerDown(session, event(1, 1), ctx); tool.pointerEnd(session, { ...event(1, 1), type: 'pointerup' }, ctx);
  assert.deepEqual(session.draft.tangents, []);
  tool.pointerDown(session, event(3, 1.5, { shiftKey: true }), ctx);
  assert.deepEqual(added.pop().to, { x: 3, y: 1 });
});
