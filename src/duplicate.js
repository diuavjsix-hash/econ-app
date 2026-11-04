import { objectModel } from './models/objects.js';
import { DUPLICATABLE_TYPES } from './models/object-types.js';
import { MovableObject } from './models/graph-object.js';

export const DUPLICATABLE = DUPLICATABLE_TYPES;

/** Keep a copied hierarchy together and leave room for repeated copies of one source. */
export function placeCopiesNearby(copies,objects,sourceId) {
  const reference=copies.find(copy=>copy.id===sourceId && copy.anchor) ?? copies.find(copy=>copy.anchor);
  if (!reference) return copies;
  const offset=objectModel(reference).nearbyOffset();
  for (let step=1;step<=objects.length+1;step++) {
    const delta={x:offset.x*step,y:offset.y*step},candidate=objectModel(reference).translate(delta);
    if (!candidate) return null;
    if (objects.some(object=>objectModel(candidate).sameGeometry(object))) continue;
    const placed=copies.map(copy=>{
      const model=objectModel(copy);
      return model instanceof MovableObject ? model.translate(delta) : structuredClone(copy);
    });
    return placed.every(Boolean)?placed:null;
  }
  return null;
}

/** Prepare a copy without changing the source or allocating IDs. */
export function prepareDuplicate(source, { slopeFactor = 1 } = {}) {
  if (!source || !DUPLICATABLE.includes(source.type)) return { error: '복제할 도형을 선택해 주세요.' };
  return objectModel(source).duplicate({ slopeFactor });
}
