import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';
import { objectModel } from '../src/models/objects.js';
import { displayedLineSegments } from '../src/graph/display.js';
import { lineEndPoints, linePointAt, rebasedExtent, visibleLineEnds } from '../src/graph/line-extent.js';
import { buildSnapTargets, snapPoint, SnapTargetCache } from '../src/graph/snap.js';
import { snapDashedPoint, snapMovingDashed } from '../src/graph/dashed-magnets.js';
import { snapLineToIntercept } from '../src/graph/intercepts.js';
import { snapShapeToPoint } from '../src/graph/point-magnets.js';
import { snapSketchTangent } from '../src/graph/sketch-magnets.js';
import { interactionFor } from '../src/graph/interactions.js';
import { snapFeedbackModel } from '../src/graph/snap-feedback.js';
import { buildFillRegions, findFillRegion } from '../src/graph/fill.js';
import { sumError, displayedSumSegments } from '../src/graph/sum.js';
import { createViewport } from '../src/graph/viewport.js';

const bounds = { xMin: -1, xMax: 10, yMin: -1, yMax: 10 }, unit = 50;
const viewport = { ...createViewport(550, 550, 'all'), bounds, unit };
const close = (a, b, eps = 1e-9) => assert.ok(a && b && Math.hypot(a.x - b.x, a.y - b.y) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const lineOf = (store, id) => store.getState().lines.find(line => line.id === id);
function addLine(store, slope, anchor, patch = {}) {
  const id = store.addLine(); store.updateSelected({ slope, anchor, ...patch }); return id;
}
const ctxFor = (store, id, tangentSnap = null) => ({ state: store.getState(), viewport, tangentSnap,
  snapTargets: () => buildSnapTargets(store.getState(), bounds, id) });
const dragEnd = (store, id, action, point, event = {}, previous = null) => {
  const line = lineOf(store, id), result = interactionFor(line).drag(line, action, point, point, event, ctxFor(store, id, previous));
  store.selectObject(id); if (result.patch) store.updateSelected(result.patch);
  return result;
};

test('an untrimmed line is unchanged; a trimmed one draws only its stored part, including vertical lines', () => {
  const store = createStore(), id = addLine(store, 1, { x: 2, y: 2 });
  assert.equal(lineOf(store, id).extent, undefined);
  const json = serializeDocument(store.getState()).lines[0];
  assert.equal(json.style, 'solid'); assert.equal('extent' in json, false);
  store.updateSelected({ extent: [0, Math.SQRT2 * 2] });
  const [segment] = displayedLineSegments(lineOf(store, id), bounds, store.getState());
  close(segment[0], { x: 2, y: 2 }); close(segment[1], { x: 4, y: 4 });
  const vertical = addLine(store, null, { x: 3, y: 3 }, { extent: [-1, 2] });
  const [piece] = displayedLineSegments(lineOf(store, vertical), bounds, store.getState());
  close(piece[0], { x: 3, y: 2 }); close(piece[1], { x: 3, y: 5 });
  assert.equal(lineOf(store, vertical).slope, null, 'a vertical line stays null, not a large slope');
  const saved = serializeDocument(store.getState()).lines.find(line => line.id === vertical);
  assert.deepEqual(saved.extent, [-1, 2]); close(saved.segment.start, { x: 3, y: 2 }); close(saved.segment.end, { x: 3, y: 5 });
  for (const invalid of [[2, 1], [1, 1], ['a', 1], [1]]) { store.updateSelected({ extent: invalid }); assert.deepEqual(lineOf(store, vertical).extent, [-1, 2]); }
  store.updateSelected({ extent: [null, null] }); assert.equal(lineOf(store, vertical).extent, undefined, 'both ends open is an ordinary line');
});

test('dragging an end meets crossings, axes, points and other ends exactly; the edge opens it again', () => {
  const store = createStore();
  const a = addLine(store, 1, { x: 2, y: 2 }), b = addLine(store, -1, { x: 5, y: 3 });
  // Crossing with another line: both ends land on the same exact point.
  let result = dragEnd(store, a, 'line-to', { x: 4.1, y: 4.15 });
  assert.equal(snapFeedbackModel(result.tangentSnap).label, '교점 맞춤'); assert.ok(result.tangentSnap.ids.includes(b));
  result = dragEnd(store, b, 'line-from', { x: 3.9, y: 4.05 });
  close(lineEndPoints(lineOf(store, a))[1], { x: 4, y: 4 }, 1e-12); close(lineEndPoints(lineOf(store, b))[0], { x: 4, y: 4 }, 1e-12);
  assert.equal(result.tangentSnap.kind === 'endpoint' || result.tangentSnap.kind === 'intersection', true);
  // Axis: the other end of b stops on the x-axis.
  result = dragEnd(store, b, 'line-to', { x: 8.1, y: -0.05 });
  assert.equal(snapFeedbackModel(result.tangentSnap).label, 'x절편'); close(lineEndPoints(lineOf(store, b))[1], { x: 8, y: 0 }, 1e-12);
  // A point already on the line.
  const c = addLine(store, 0, { x: 0, y: 7 }), point = store.addPoint({ x: 6, y: 7 });
  result = dragEnd(store, c, 'line-to', { x: 6.1, y: 7.2 });
  assert.equal(result.tangentSnap.kind, 'point'); assert.deepEqual(result.tangentSnap.ids, [point]);
  close(lineEndPoints(lineOf(store, c))[1], { x: 6, y: 7 }, 1e-12);
  // Held inside 24px, released beyond, Alt bypasses, and the edge opens the end.
  const held = dragEnd(store, c, 'line-to', { x: 6 + 20 / unit, y: 7 }, {}, result.tangentSnap);
  assert.equal(held.tangentSnap?.kind, 'point');
  assert.equal(dragEnd(store, c, 'line-to', { x: 6 + 30 / unit, y: 7 }, {}, result.tangentSnap).tangentSnap, null);
  dragEnd(store, c, 'line-to', { x: 6.05, y: 7 }, { altKey: true }); close(lineEndPoints(lineOf(store, c))[1], { x: 6.05, y: 7 }, 1e-12);
  dragEnd(store, c, 'line-to', { x: 9.9, y: 7 }); assert.equal(lineOf(store, c).extent, undefined, 'dragging to the edge continues the line again');
  // The two ends never cross.
  dragEnd(store, c, 'line-from', { x: 5, y: 7 }, { altKey: true }); dragEnd(store, c, 'line-to', { x: 2, y: 7 }, { altKey: true });
  const [from, to] = lineOf(store, c).extent; assert.ok(to - from >= 24 / unit - 1e-12);
});

test('a trimmed end is a shared point target for every point and dashed consumer, excluded while editing its own line', () => {
  const store = createStore(), id = addLine(store, 1, { x: 2, y: 2 }, { extent: [null, 2 * Math.SQRT2] }), end = { x: 4, y: 4 };
  const targets = buildSnapTargets(store.getState(), bounds), pointer = { x: 4.12, y: 3.95 };
  for (const result of [snapPoint(pointer, targets, unit), snapDashedPoint(pointer, targets, unit)]) {
    assert.equal(result.kind, 'endpoint'); assert.equal(snapFeedbackModel(result).label, '끝점 맞춤'); close(result.point, end, 1e-12);
  }
  for (const endpoint of ['anchor', 'end']) {
    const segment = endpoint === 'anchor' ? { anchor: pointer, end: { x: 8, y: 1 } } : { anchor: { x: 8, y: 1 }, end: pointer };
    const moved = snapMovingDashed(segment, targets, unit, { bounds });
    assert.equal(moved.kind, 'endpoint'); close(moved.geometry[endpoint], end, 1e-12);
  }
  // Past the trimmed end there is nothing to snap to on this line.
  assert.equal(snapPoint({ x: 6, y: 6.05 }, targets, unit), null);
  assert.equal(buildSnapTargets(store.getState(), bounds, id).crossings.some(c => c.kind === 'endpoint'), false);
  const cache = new SnapTargetCache(), first = cache.get(store.getState(), bounds).crossings.find(c => c.kind === 'endpoint').point;
  store.selectObject(id); store.updateSelected({ extent: [null, Math.SQRT2] });
  const second = cache.get(store.getState(), bounds).crossings.find(c => c.kind === 'endpoint').point;
  close(second, { x: 3, y: 3 }); assert.notDeepEqual(first, second, 'the shared cache follows extent edits');
});

test('rotation, re-anchoring and following a point keep the drawn ends physically in place', () => {
  const store = createStore(), id = addLine(store, 1, { x: 3, y: 3 }, { extent: [0, 2] });
  const line = lineOf(store, id), handler = interactionFor(line);
  // Re-anchoring on the same line changes no drawn point.
  const patch = handler.startPatch(line, { x: 4, y: 4 });
  assert.deepEqual(lineEndPoints({ ...line, ...patch }).map(p => p && [+p.x.toFixed(12), +p.y.toFixed(12)]), lineEndPoints(line).map(p => p && [+p.x.toFixed(12), +p.y.toFixed(12)]));
  assert.deepEqual(handler.startPatch({ ...line, extent: undefined }, { x: 4, y: 4 }), { anchor: { x: 4, y: 4 } });
  // Rotating past vertical keeps the drawn end on the side the pointer carried it.
  const angle = 100 * Math.PI / 180, pointer = { x: 3 + 3 * Math.cos(angle), y: 3 + 3 * Math.sin(angle) };
  const start = linePointAt(line, 1), result = handler.drag(line, 'rotate', start, pointer, { altKey: true }, ctxFor(store, id));
  store.updateSelected(result.patch);
  const ends = lineEndPoints(lineOf(store, id)).filter(Boolean);
  assert.ok(ends.some(p => Math.hypot(p.x - (3 + 2 * Math.cos(angle)), p.y - (3 + 2 * Math.sin(angle))) < 1e-9), JSON.stringify(ends));
  // Slider/keyboard steps across vertical keep continuity too.
  store.updateSelected({ slope: 1, extent: [0, 2] });
  for (const degrees of [60, 80, 89.9, 90.1, 100]) store.updateSelected({ slope: Math.tan(degrees * Math.PI / 180) });
  const far = lineEndPoints(lineOf(store, id)).filter(Boolean).find(p => Math.hypot(p.x - 3, p.y - 3) > 1);
  close(far, { x: 3 + 2 * Math.cos(angle), y: 3 + 2 * Math.sin(angle) });
  // A followed point carries the whole trimmed line with it.
  const point = store.addPoint({ x: 2, y: 5 }), follow = store.lineThroughSelectedPoint({ slope: 0 });
  store.updateSelected({ extent: [0, 3] }); store.selectObject(point); store.updateSelected({ anchor: { x: 3, y: 6 } });
  close(lineEndPoints(lineOf(store, follow))[1], { x: 6, y: 6 });
  assert.deepEqual(interactionFor(lineOf(store, follow)).start(lineOf(store, follow), ctxFor(store, follow)), { x: 3, y: 6 }, 'the followed point is the pivot');
});

test('line magnets only use the drawn part of a trimmed line', () => {
  const store = createStore(), id = addLine(store, 1, { x: 2, y: 2.1 });
  const ownIntercept = () => snapLineToIntercept(lineOf(store, id), store.getState(), bounds, unit);
  assert.equal(ownIntercept()?.kind, 'intercept', 'the full line reaches the origin');
  store.updateSelected({ extent: [0, 1] }); assert.equal(ownIntercept(), null, 'its drawn part does not');
  const point = store.addPoint({ x: 8, y: 8.1 });
  assert.equal(snapShapeToPoint(lineOf(store, id), store.getState(), bounds, unit), null);
  store.selectObject(point); store.updateSelected({ anchor: { x: 2.4, y: 2.6 } });
  assert.equal(snapShapeToPoint(lineOf(store, id), store.getState(), bounds, unit)?.kind, 'point');
  assert.equal(snapSketchTangent({ x: 7, y: 7.1 }, store.getState(), bounds, unit), null);
  assert.equal(snapSketchTangent({ x: 2.3, y: 2.45 }, store.getState(), bounds, unit)?.kind, 'tangent');
});

test('fills follow the drawn part, sums exclude trimmed lines, and copies keep ends and style', () => {
  const store = createStore();
  const steep = addLine(store, -2, { x: 2, y: 4 }, { extent: [null, 0] }), flat = addLine(store, -0.5, { x: 2, y: 4 }, { extent: [0, null], style: 'dashed' });
  const fillBounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, regions = buildFillRegions(store.getState(), fillBounds);
  assert.equal(findFillRegion(regions, { x: 0.5, y: 5.5 }), findFillRegion(regions, { x: 1, y: 1 }), 'no phantom edge beyond the kink');
  assert.notEqual(findFillRegion(regions, { x: 1, y: 1 }), findFillRegion(regions, { x: 1, y: 7 }));
  const other = store.addLine();
  assert.match(sumError([lineOf(store, flat), lineOf(store, other)], 'vertical'), /끝을 자른 직선/);
  store.selectObject(steep); store.updateSelected({ extent: null });
  const sum = store.addSum([steep, other], { direction: 'vertical' });
  store.selectObject(steep); store.updateSelected({ extent: [null, 0] });
  assert.deepEqual(displayedSumSegments(store.getState().sums.find(s => s.id === sum), store.getState(), fillBounds), [], 'an existing sum stops drawing, like other unsupported sources');
  const { object } = objectModel(lineOf(store, flat)).duplicate();
  assert.deepEqual(object.extent, [0, null]); assert.equal(object.style, 'dashed');
  assert.equal(serializeDocument(store.getState()).lines.find(l => l.id === flat).style, 'dashed');
});

test('end handles sit on drawn ends or just inside the edge, and the keyboard trims and reopens', () => {
  const store = createStore(), id = addLine(store, 0, { x: 3, y: 5 }), line = lineOf(store, id);
  const ends = visibleLineEnds(line, bounds, store.getState());
  assert.ok(ends.ends.every(end => end.open)); close(ends.ends[1].point, { x: 10, y: 5 });
  const handler = interactionFor(line), ctx = ctxFor(store, id);
  assert.equal(handler.keyboard(line, 'line-to', { key: 'ArrowRight' }, ctx).patch.extent[1], null, 'past the edge stays open');
  const trimmed = handler.keyboard(line, 'line-to', { key: 'ArrowLeft', shiftKey: true }, ctx).patch.extent;
  store.updateSelected({ extent: trimmed }); close(lineEndPoints(lineOf(store, id))[1], { x: 9, y: 5 });
  const reopened = visibleLineEnds(lineOf(store, id), bounds, store.getState());
  assert.equal(reopened.ends[1].open, false); assert.deepEqual(rebasedExtent(lineOf(store, id), { x: 9, y: 5 })[1], 0);
});
