import { projectOnLine, distance } from './sketch.js';
import { isLinePointVisible } from './display.js';
import { chooseSnapCandidate } from './snap-policy.js';

/** Third-click tangency keeps the existing line binding; only capture feedback is shared. */
export function snapSketchTangent(point, state, bounds, unit, { previous=null, altKey=false, enabled=true, directId=null }={}) {
  if (altKey) return null;
  const candidates = state.lines.filter(line => enabled || line.id === directId).map(line => {
    const projected = projectOnLine(point,line);
    return { ...projected, line, kind:'tangent', key:`sketch-tangent:${line.id}`, ids:[line.id],
      distance:distance(projected.point,point)*unit };
  }).filter(candidate => isLinePointVisible(candidate.point,bounds,state));
  return chooseSnapCandidate(candidates,previous);
}
