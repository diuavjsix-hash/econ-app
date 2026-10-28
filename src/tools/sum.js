import { sumError, sumSources } from '../graph/sum.js';

export function mountSumTool(root, store) {
  const button = root.querySelector('#sum-tool'), panel = root.querySelector('#sum-options');
  const sources = root.querySelector('#sum-sources'), direction = root.querySelector('#sum-direction');
  const nonnegative = root.querySelector('#sum-nonnegative'), action = root.querySelector('#sum-action');
  const status = root.querySelector('#sum-status');
  const selectedSettings = root.querySelector('#sum-selected-settings'), selectedNonnegative = root.querySelector('#sum-selected-nonnegative');
  selectedNonnegative.addEventListener('change', () => store.updateSelected({ nonnegative: selectedNonnegative.checked }));
  let diagramId = null, signature = '', selected = new Set();
  button.addEventListener('click', () => store.update({sumPanel:!store.getState().sumPanel}));
  function update() {
    const state = store.getState(), objects = [...state.lines, ...state.curves];
    const error = sumError(objects.filter(object => selected.has(object.id)), direction.value);
    action.disabled = Boolean(error);
    status.textContent = error ?? (direction.value === 'vertical' ? '같은 x에서 y₁ + y₂ + …' : '같은 y에서 x₁ + x₂ + …');
  }
  sources.addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
    update();
  });
  direction.addEventListener('change', update);
  action.addEventListener('click', () => {
    const id = store.addSum([...selected], { direction: direction.value, nonnegative: nonnegative.checked });
    if (id) status.textContent = '합을 추가했습니다.';
    else update();
  });
  return store.subscribe(state => {
    panel.hidden=!state.sumPanel;
    button.setAttribute('aria-expanded',String(state.sumPanel));
    button.setAttribute('aria-pressed',String(state.sumPanel));
    const sum = state.sums.find(sum => sum.id === state.selectedId);
    selectedSettings.hidden = !sum;
    if (sum) {
      const operands = sumSources(sum, state);
      selectedNonnegative.checked = sum.nonnegative;
      root.querySelector('#sum-selected-description').textContent = `${sum.direction === 'vertical' ? '수직합' : '수평합'} · ${operands.map(source => source?.name ?? '삭제된 원본').join(' + ')}`;
      root.querySelector('#sum-selected-status').textContent = sumError(operands, sum.direction) ?? '원본을 수정하면 자동 갱신됩니다.';
    }
    if (diagramId !== state.activeDiagramId) { diagramId = state.activeDiagramId; selected.clear(); signature = ''; }
    const objects = [...state.lines, ...state.curves];
    selected = new Set([...selected].filter(id => objects.some(object => object.id === id)));
    const next = JSON.stringify(objects.map(({ id, name }) => [id, name]));
    if (next !== signature) {
      const focusId = document.activeElement?.closest('#sum-sources input')?.value;
      sources.replaceChildren(...objects.map(object => {
        const label = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span');
        checkbox.type = 'checkbox'; checkbox.value = object.id; checkbox.checked = selected.has(object.id);
        text.textContent = object.name; label.append(checkbox, text); return label;
      }));
      signature = next;
      if (focusId) [...sources.querySelectorAll('input')].find(input => input.value === focusId)?.focus();
    }
    update();
  });
}
