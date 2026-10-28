import { objectsOf } from './objects.js';
import { directionOf } from './graph/math.js';
import { sketchMinimum } from './graph/sketch.js';

export const dependencyId = object => object.binding?.sourceId ?? null;
export function canAttach(state, id, sourceId) {
  const byId = new Map(objectsOf(state).map(object=>[object.id,object]));
  const seen = new Set([id]);
  for (let next=sourceId; next; next=dependencyId(byId.get(next) ?? {})) {
    if (seen.has(next) || !byId.has(next)) return false;
    seen.add(next);
  }
  return true;
}
/** Resolve the small dependency DAG before recording history or notifying renderers. */
export function resolveRelations(state) {
  const byId=new Map(objectsOf(state).map(object=>[object.id,object])), done=new Set(), visiting=new Set();
  function resolve(object) {
    if (done.has(object.id) || !object.binding) return;
    if (visiting.has(object.id)) return;
    visiting.add(object.id);
    const source=byId.get(dependencyId(object));
    if (!source) object.binding=null;
    else {
      resolve(source);
      if (object.type==='sketch' && object.binding.kind==='tangent' && source.type==='line') {
        const direction=directionOf(source.slope), previous=object.binding.direction;
        // An unoriented line's canonical direction flips at vertical. Preserve the same side.
        if (previous && direction.x*previous.x+direction.y*previous.y < -1e-10) object.binding.parameter*=-1;
        object.binding.direction=direction;
        const parameter=object.binding.parameter;
        const anchor={x:source.anchor.x+direction.x*parameter,y:source.anchor.y+direction.y*parameter};
        if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
          const sign=direction.x*object.tangent.x+direction.y*object.tangent.y < 0 ? -1:1;
          object.anchor=anchor; object.tangent={x:sign*direction.x || 0,y:sign*direction.y || 0};
        }
      } else if (object.type==='point' && object.binding.kind==='minimum' && source.type==='sketch') object.anchor=sketchMinimum(source);
      else if (object.type==='line' && object.binding.kind==='through-point' && source.type==='point') object.anchor={...source.anchor};
    }
    visiting.delete(object.id); done.add(object.id);
  }
  for (const object of byId.values()) resolve(object);
}
