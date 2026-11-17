/**
 * Links: one typed list of relations per diagram (2026-11-16).
 *
 * A link records what the user aligned with a magnet at the moment it happened:
 * `{ id, type, role, ids: [subject, ...targets], at }`. ids[0] is the shape that was placed or
 * moved, `role` the part of it that was aligned (anchor, start, end or the whole shape), the
 * rest of ids what it was aligned to (strokes, axes or placed points). A sketch's extra through
 * points have the roles `through:<id>`; the role family `through` names all of them. A link never holds the
 * shapes in place: drawing stays free. The export checks every link against the current
 * geometry and reports whether it still holds. Live following relations (a free curve kept
 * tangent to a line, a line through a point) stay in each object's `binding`; the export lists
 * them in the same `links` list with `follow: true`.
 *
 * A new kind of relation adds a `type`, never a new structure.
 */

/** Candidate kinds from the shared magnets, as link types. Display-only kinds record nothing. */
const TYPE_OF_KIND = Object.freeze({
  intersection: 'intersection', tangent: 'tangent', intercept: 'intercept', endpoint: 'endpoint',
  kink: 'kink', minimum: 'minimum', point: 'point', shape: 'on', origin: 'origin',
});
export const LINK_TYPES = Object.freeze([...new Set(Object.values(TYPE_OF_KIND))]);
export const LINK_ROLES = Object.freeze(['anchor', 'start', 'end', 'shape', 'through']);
const THROUGH_ROLE = /^through:[A-Za-z0-9_-]+$/;
/** A role a link may carry: a fixed part, or one through point of a sketch. */
export const isLinkRole = role => (LINK_ROLES.includes(role) && role !== 'through') || THROUGH_ROLE.test(role ?? '');
/** Whether a changed-roles list covers a link's role; `through` covers every through point. */
const covers = (roles, role) => roles.includes(role) || (roles.includes('through') && THROUGH_ROLE.test(role ?? ''));

/** The shapes a magnet candidate aligned to, without the subject itself. */
export function candidateTargets(candidate, subjectId) {
  const ids = candidate?.ids?.length ? candidate.ids : candidate?.sourceId ? [candidate.sourceId] : [];
  return [...new Set(ids.filter(id => id && id !== subjectId))];
}

/** A link record for a magnet candidate, or null when the candidate aligns nothing durable. */
export function linkFor(id, subjectId, role, candidate) {
  const type = TYPE_OF_KIND[candidate?.kind], targets = candidateTargets(candidate, subjectId);
  if (!type || !isLinkRole(role) || !targets.length || !Number.isFinite(candidate.point?.x) || !Number.isFinite(candidate.point?.y)) return null;
  return { id, type, role, ids: [subjectId, ...targets], at: { x: candidate.point.x, y: candidate.point.y } };
}

/**
 * The roles a gesture changes. Moving or reshaping a whole shape re-places every part of it;
 * a handle changes its own part and the shape's form, but not its other ends.
 */
export function rolesChangedBy(type, action) {
  if (type === 'point') return ['anchor'];
  if (action === 'line-from') return ['start', 'shape'];
  if (action === 'line-to') return ['end', 'shape'];
  if (action === 'sketch-start') return ['start', 'shape'];
  if (action === 'sketch-end') return ['end', 'shape'];
  if (action === 'sketch-middle') return ['anchor', 'shape'];
  const through = /^sketch-point:(.+)$/.exec(action ?? '');
  if (through) return [`through:${through[1]}`, 'shape'];
  // Tangent and reach handles reshape the curve between its points; the points stay.
  if (/^sketch-(tangent|leftReach|rightReach)(:|$)/.test(action ?? '')) return ['shape'];
  return LINK_ROLES;
}

/**
 * Remove the subject's links for the changed roles, then add the new ones. `moving` holds the
 * shapes that moved together (a set): a link whose targets all moved with it stays true.
 */
export function replaceLinks(links, subjectId, roles, added = [], moving = null) {
  const kept = links.filter(link => link.ids[0] !== subjectId || !covers(roles, link.role)
    || (moving && link.ids.slice(1).every(id => moving.has(id))));
  const replaced = new Set(added.map(link => link.role));
  return [...kept.filter(link => link.ids[0] !== subjectId || !replaced.has(link.role)), ...added];
}

/** Links of one removed part (a sketch's through point) go with it. */
export function withoutRole(links, subjectId, role) {
  return links.filter(link => link.ids[0] !== subjectId || link.role !== role);
}

/** Links that mention a deleted shape go with it. */
export function withoutShapes(links, deleted) {
  return links.filter(link => !link.ids.some(id => deleted.has(id)));
}
