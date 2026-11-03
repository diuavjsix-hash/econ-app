/** Shared interaction distances, measured in CSS pixels by every magnet. */
export const SNAP_CAPTURE_PX = 16;
export const SNAP_RELEASE_PX = 24;

/** Stable capture, with explicit points/crossings allowed to take over from a stroke. */
export function chooseSnapCandidate(candidates, previous = null) {
  const available = candidates.filter(candidate => candidate.distance <= SNAP_RELEASE_PX);
  const retained = previous && available.filter(candidate => candidate.key === previous.key).sort((a,b) => a.distance-b.distance)[0];
  const preferred = available.filter(candidate => candidate.distance <= SNAP_CAPTURE_PX)
    .sort((a,b) => (a.priority ?? 0)-(b.priority ?? 0) || a.distance-b.distance)[0];
  const promote = preferred && (retained?.kind === 'shape' && preferred.priority < retained.priority
    || preferred.kind === 'point' && retained?.kind !== 'point' && preferred.distance < retained?.distance);
  return retained && !promote ? retained : preferred ?? null;
}
