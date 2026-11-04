/** Shared interaction distances, measured in CSS pixels by every magnet. */
export const SNAP_CAPTURE_PX = 16;
export const SNAP_RELEASE_PX = 24;

/** Abstract capture/release template, shared by every candidate chooser. */
export class SnapPolicy {
  constructor() { if (new.target === SnapPolicy) throw new TypeError('SnapPolicy is abstract'); }
  compare() { throw new TypeError('A snap policy must implement compare()'); }
  retained(candidates, previous) { return previous && candidates.find(candidate => candidate.key === previous.key); }
  promote() { return false; }
  choose(candidates, previous = null) {
    const available = candidates.filter(candidate => candidate.distance <= SNAP_RELEASE_PX);
    const retained = this.retained(available, previous);
    const preferred = available.filter(candidate => candidate.distance <= SNAP_CAPTURE_PX).sort((a, b) => this.compare(a, b))[0];
    return retained && !this.promote(retained, preferred) ? retained : preferred ?? null;
  }
}

/** Point/endpoint/sketch creation can promote a more specific target over a stroke. */
export class PrioritySnapPolicy extends SnapPolicy {
  compare(a, b) { return (a.priority ?? 0) - (b.priority ?? 0) || a.distance - b.distance; }
  retained(candidates, previous) { return previous && candidates.filter(candidate => candidate.key === previous.key).sort((a, b) => a.distance - b.distance)[0]; }
  promote(retained, preferred) {
    return preferred && (retained.kind === 'shape' && preferred.priority < retained.priority
      || preferred.kind === 'point' && retained.kind !== 'point' && preferred.distance < retained.distance);
  }
}

/** Whole-shape magnets retain the captured contact and otherwise take the nearest. */
export class NearestSnapPolicy extends SnapPolicy {
  constructor({ pointerTieBreak = true } = {}) { super(); this.pointerTieBreak = pointerTieBreak; }
  compare(a, b) { return a.distance - b.distance || (this.pointerTieBreak ? a.pointerDistance - b.pointerDistance : 0); }
}

export const PRIORITY_SNAP_POLICY = Object.freeze(new PrioritySnapPolicy());
export const SHAPE_SNAP_POLICY = Object.freeze(new NearestSnapPolicy());
export const INTERCEPT_SNAP_POLICY = Object.freeze(new NearestSnapPolicy({ pointerTieBreak: false }));
export const chooseSnapCandidate = (candidates, previous = null) => PRIORITY_SNAP_POLICY.choose(candidates, previous);
