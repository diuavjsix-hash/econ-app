import { OBJECT_LABELS } from './objects.js';

export const DUPLICATABLE = ['line', 'curve', 'sketch', 'point', 'dashed', 'group'];

/** Prepare a copy without changing the source or allocating IDs. */
export function prepareDuplicate(source, { slopeFactor = 1, pivot = 'intercept', placement = 'same' } = {}) {
  if (!source || !DUPLICATABLE.includes(source.type)) return { error: '복제할 도형을 선택해 주세요.' };
  if (![0.5, 1, 2].includes(slopeFactor) || !['intercept', 'anchor'].includes(pivot) || !['same', 'right', 'up'].includes(placement)) return { error: '복제 옵션을 확인해 주세요.' };
  const object = structuredClone(source);
  if ('binding' in object) object.binding=null;
  object.name = `${(source.name || OBJECT_LABELS[source.type]).slice(0, 79)}′`;
  object.collapsed = false;
  if (object.type === 'line' && object.slope !== null) {
    const slope = object.slope * slopeFactor;
    if (!Number.isFinite(slope) || (object.slope !== 0 && slope === 0)) return { error: '이 기울기는 숫자 범위를 벗어납니다.' };
    object.slope = slope;
    // Horizontal scaling preserves the vertical intercept without overflowing b=y-m*x.
    if (pivot === 'intercept') object.anchor.x /= slopeFactor;
  }
  const offset = { x: placement === 'right' ? 1 : 0, y: placement === 'up' ? 1 : 0 };
  for (const key of ['anchor', 'start', 'end']) if (object[key]) {
    object[key].x += offset.x; object[key].y += offset.y;
    if (!Number.isFinite(object[key].x) || !Number.isFinite(object[key].y)) return { error: '복제 위치가 숫자 범위를 벗어납니다.' };
  }
  return { object, error: null };
}
