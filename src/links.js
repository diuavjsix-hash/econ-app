/**
 * Link lines: one ordinary line in each of several graphs, tied by `link: { id, axis }`.
 * A vertical link (axis 'x') keeps every member at the same x, a horizontal one (axis 'y')
 * at the same y. Members stay real lines of their own graph, so magnets, relations, JSON,
 * selection and history treat them like any other line; this module only keeps them equal.
 * Nothing here knows screen pixels except linkBridges, which only draws.
 */
import { displayedLineSegments } from './graph/display.js';
import { toScreen } from './graph/viewport.js';

export const LINK_AXES = Object.freeze({
  x: Object.freeze({ slope: null, label: '세로 연결선' }),
  y: Object.freeze({ slope: 0, label: '가로 연결선' }),
});
export const isLinkAxis = axis => Object.hasOwn(LINK_AXES, axis);

/** link id → [{ diagram, line }] over every graph, hidden ones included. */
export function linkGroups(diagrams) {
  const groups = new Map();
  for (const diagram of diagrams) for (const line of diagram.lines ?? []) if (line.link) {
    if (!groups.has(line.link.id)) groups.set(line.link.id, []);
    groups.get(line.link.id).push({ diagram, line });
  }
  return groups;
}

/**
 * Keep each link's members on one coordinate. A member that follows a point leads; otherwise
 * the member in the active graph (the one just edited) leads. A link left with one member
 * dissolves into a plain line. Mutates the diagrams' line objects in place.
 */
export function syncLinks(diagrams, activeDiagramId) {
  for (const members of linkGroups(diagrams).values()) {
    if (members.length < 2) { for (const { line } of members) delete line.link; continue; }
    const leader = members.find(({ line }) => line.binding) ?? members.find(({ diagram }) => diagram.id === activeDiagramId) ?? members[0];
    const axis = leader.line.link.axis, value = leader.line.anchor[axis];
    for (const { line } of members) {
      if (line.link.axis !== axis) line.link = { ...line.link, axis };
      if (line.slope !== LINK_AXES[axis].slope) line.slope = LINK_AXES[axis].slope;
      if (line.anchor[axis] !== value) line.anchor = { ...line.anchor, [axis]: value };
    }
  }
}

/** A member whose partner follows a point cannot be dragged along the shared coordinate. */
export function linkHeld(diagrams, line) {
  if (!line?.link || line.binding) return false;
  return (diagrams ?? []).some(diagram => (diagram.lines ?? []).some(other => other.id !== line.id && other.link?.id === line.link.id && other.binding));
}

/** Graphs joined to `id` through any chain of links; they share one zoom. */
export function linkedDiagramIds(diagrams, id) {
  const groups = [...linkGroups(diagrams).values()].map(members => members.map(({ diagram }) => diagram.id));
  const found = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const ids of groups) if (ids.some(other => found.has(other)) && ids.some(other => !found.has(other))) {
      ids.forEach(other => found.add(other)); changed = true;
    }
  }
  return found;
}

// Where the shared axis sits inside a card: same key, same screen position (equal cells, shared zoom).
const xPlacement = d => d.quadrantMode === 'edgeworth' ? null : `${d.quadrantMode === 'first' ? 'edge' : 'center'}:${Boolean(d.flipX)}`;
const yPlacement = d => d.quadrantMode === 'edgeworth' ? null : `${d.quadrantMode === 'all' ? 'center' : 'edge'}:${Boolean(d.flipY)}`;

/**
 * Visible graphs a link from `id` can reach: the same column for a vertical link, the same row
 * for a horizontal one, with the shared axis placed and oriented the same way.
 */
export function alignedPartners(layout, diagrams, id, axis) {
  if (!isLinkAxis(axis)) return [];
  const visible = diagrams.slice(0, layout.slots.length).map((diagram, index) => ({ diagram, slot: layout.slots[index] }));
  const source = visible.find(({ diagram }) => diagram.id === id);
  const placement = axis === 'x' ? xPlacement : yPlacement;
  const key = source && placement(source.diagram);
  if (!key) return [];
  return visible.filter(({ diagram, slot }) => diagram.id !== id && placement(diagram) === key
    && (axis === 'x' ? slot.column === source.slot.column : slot.row === source.slot.row));
}

/**
 * The source member reaches toward its partners: a ray from the point when they are all on one
 * side, a full line when they are on both sides. Returned as a line extent along directionOf(slope).
 */
export function sourceExtent(source, partners, axis) {
  const key = axis === 'x' ? 'row' : 'column';
  const before = partners.some(p => p.slot[key] < source.slot[key]), after = partners.some(p => p.slot[key] > source.slot[key]);
  if (before === after) return null;
  // Screen "after" is down (rows) or right (columns); flips reverse the mathematical sign.
  const flipped = axis === 'x' ? source.diagram.flipY : source.diagram.flipX;
  const positive = axis === 'x' ? (after ? Boolean(flipped) : !flipped) : (after ? !flipped : Boolean(flipped));
  return positive ? [0, null] : [null, 0];
}

/** Export summary: which lines in which graphs share which coordinate. */
export function describeLinks(diagrams) {
  return [...linkGroups(diagrams)].filter(([, members]) => members.length > 1).map(([id, members]) => {
    const axis = members[0].line.link.axis;
    return { id, axis, value: members[0].line.anchor[axis], lines: members.map(({ diagram, line }) => ({ diagramId: diagram.id, lineId: line.id })) };
  });
}

/**
 * Screen pieces that carry a link across the gaps between graph cards. `cards` give each visible
 * graph's state, viewport and container offset inside the grid. Two members are bridged when they
 * line up on screen and each reaches the edge of its plot facing the other.
 */
export function linkBridges(cards) {
  const spans = new Map();
  for (const { state, viewport, offset } of cards) for (const line of state.lines ?? []) if (line.link) {
    const points = displayedLineSegments(line, viewport.bounds, state).flat().map(p => toScreen(p, viewport));
    if (!points.length) continue;
    const vertical = line.link.axis === 'x', along = vertical ? 'y' : 'x', across = vertical ? 'x' : 'y';
    const values = points.map(p => p[along] + offset[along]);
    const low = Math.min(...values), high = Math.max(...values);
    const edgeLow = offset[along] + (vertical ? viewport.plot.top : viewport.plot.left), edgeHigh = offset[along] + (vertical ? viewport.plot.bottom : viewport.plot.right);
    const tolerance = 1.5 + (state.axisGapEnabled ? (state.axisGap ?? 0) * viewport.unit : 0);
    const span = { across: points[0][across] + offset[across], low, high, reachesLow: low - edgeLow <= tolerance, reachesHigh: edgeHigh - high <= tolerance,
      vertical, color: line.color, dashed: line.style === 'dashed' };
    if (!spans.has(line.link.id)) spans.set(line.link.id, []);
    spans.get(line.link.id).push(span);
  }
  const bridges = [];
  for (const [linkId, list] of spans) {
    list.sort((a, b) => a.low - b.low);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (Math.abs(a.across - b.across) > 0.5 || !(a.high < b.low) || !a.reachesHigh || !b.reachesLow) continue;
      const at = (a.across + b.across) / 2;
      bridges.push({ linkId, color: a.color, dashed: a.dashed, ...(a.vertical ? { x1: at, y1: a.high, x2: at, y2: b.low } : { x1: a.high, y1: at, x2: b.low, y2: at }) });
    }
  }
  return bridges;
}
