import { objectsOf, OBJECT_LABELS } from '../objects.js';
import { DUPLICATABLE, prepareDuplicate, placeCopiesNearby } from '../duplicate.js';
import { lineEquation } from '../graph/math.js';
import { isIndifference, indifferenceMovement } from '../graph/indifference.js';

export function mountDuplicateTool(root, store) {
  const button = root.querySelector('#duplicate-tool');
  const panel = root.querySelector('#duplicate-options');
  const target = root.querySelector('#duplicate-target');
  const factors = root.querySelectorAll('[data-copy-factor]');
  const children = root.querySelector('#duplicate-children');
  const preview = root.querySelector('#duplicate-preview');
  const action = root.querySelector('#duplicate-action');
  const status = root.querySelector('#duplicate-status');
  let factor = 1, current, signature = '', previousSelection;
  const options = () => ({ slopeFactor: factor, includeChildren: children.checked });
  function refresh() {
    const source = objectsOf(current).find(object => object.id === current.selectedId);
    const prepared = prepareDuplicate(source, options());
    if (!prepared.error) {
      prepared.object=placeCopiesNearby([prepared.object],objectsOf(current),source.id)?.[0];
      if (!prepared.object) prepared.error='복제 위치를 계산할 수 없습니다.';
    }
    root.querySelector('#duplicate-slope-options').hidden = source?.type !== 'line';
    root.querySelector('#duplicate-children-row').hidden = !source || !objectsOf(current).some(object => object.parentId === source.id);
    for (const choice of factors) choice.setAttribute('aria-pressed', String(Number(choice.dataset.copyFactor) === factor));
    action.disabled = Boolean(prepared.error);
    if (prepared.error) preview.textContent = prepared.error;
    else if (source.type === 'line') {
      preview.textContent = `${lineEquation(source)} → ${lineEquation(prepared.object)}`;
      if (source.slope === null) preview.textContent += ' · 수직선 유지';
      else if (source.slope === 0) preview.textContent += ' · 수평선 유지';
    } else preview.textContent = `${source.name || OBJECT_LABELS[source.type]} → ${prepared.object.name}${isIndifference(source)?` · ${indifferenceMovement(source)}`:''}`;
  }
  button.addEventListener('click', () => store.toggleToolMode('duplicate'));
  target.addEventListener('change', () => { status.textContent = ''; store.selectObject(target.value || null); });
  for (const choice of factors) choice.addEventListener('click', () => { factor = Number(choice.dataset.copyFactor); refresh(); });
  children.addEventListener('change', refresh);
  action.addEventListener('click', () => {
    const sourceId = current.selectedId;
    const id = store.duplicateSelected(options());
    if (id) {
      // Repeated copies keep using the explicitly chosen source, avoiding accidental x4, x8 slopes.
      store.selectObject(sourceId);
      status.textContent = '복제했습니다. 선택 도구로 위치를 바꿀 수 있습니다.';
    }
  });
  return store.subscribe(state => {
    current = state;
    if (state.selectedId !== previousSelection) status.textContent = '';
    previousSelection = state.selectedId;
    panel.hidden = !state.duplicatePanel;
    button.setAttribute('aria-pressed', String(state.duplicatePanel));
    button.setAttribute('aria-expanded', String(state.duplicatePanel));
    const objects = objectsOf(state).filter(object => DUPLICATABLE.includes(object.type));
    const next = JSON.stringify(objects.map(({ id, name, type }) => [id, name, type]));
    if (next !== signature) {
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = '도형 선택';
      target.replaceChildren(empty);
      for (const object of objects) {
        const item = document.createElement('option'); item.value = object.id;
        item.textContent = `${object.name || OBJECT_LABELS[object.type]} · ${OBJECT_LABELS[object.type]}`; target.append(item);
      }
      signature = next;
    }
    target.value = state.selectedId ?? '';
    refresh();
  });
}
