import { objectsOf } from './objects.js';
import { directionOf } from './graph/math.js';
import { sketchMinimum } from './graph/sketch.js';

export const dependencyId = object => object.binding?.sourceId ?? null;
export const dependencyIds = object => [...new Set([dependencyId(object), ...(object.sourceIds ?? [])].filter(Boolean))];
/** Geometry exclusion follows calculation dependencies, never list/folder membership. */
export function dependentIds(state, id) {
  const excluded = new Set([id]), followers = new Map();
  for (const object of objectsOf(state)) for (const source of dependencyIds(object)) {
    if (!followers.has(source)) followers.set(source, []);
    followers.get(source).push(object.id);
  }
  const queue = [id];
  for (let i = 0; i < queue.length; i++) for (const next of followers.get(queue[i]) ?? []) {
    if (!excluded.has(next)) { excluded.add(next); queue.push(next); }
  }
  return excluded;
}
export function canAttach(state, id, sourceId) {
  const byId = new Map(objectsOf(state).map(object=>[object.id,object]));
  const visiting = new Set([id]), done = new Set();
  const stack = [{ next: sourceId, exit: false }];
  while (stack.length) {
    const { next, exit } = stack.pop();
    if (exit) { visiting.delete(next); done.add(next); continue; }
    if (visiting.has(next) || !byId.has(next)) return false;
    if (done.has(next)) continue;
    visiting.add(next);
    stack.push({ next, exit: true });
    for (const source of dependencyIds(byId.get(next))) stack.push({ next: source, exit: false });
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
