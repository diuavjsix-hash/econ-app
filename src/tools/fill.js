import { FILL_COLORS } from '../graph/fill-style.js';

export function fillControls(mode) {
  return `${mode === 'paint' ? '<div class="fill-next"><span>다음 구역</span><span id="fill-next-badge" class="fill-next-badge">A</span></div>' : `<div class="fill-colors" role="group" aria-label="구역 색">${FILL_COLORS.map(([color, name]) =>
    `<button class="fill-color" data-fill-mode="${mode}" data-fill-color="${color}" style="--fill-color:${color}" aria-label="${name}" aria-pressed="false" title="${name}"></button>`).join('')}</div>`}
    <label class="setting-row" for="fill-${mode}-opacity">진하기<output id="fill-${mode}-value">24%</output></label>
    <input id="fill-${mode}-opacity" type="range" min="10" max="60" step="1" value="24" />`;
}

export function mountFillTool(root, store) {
  const button = root.querySelector('#fill-tool'), options = root.querySelector('#fill-options'), settings = root.querySelector('#fill-settings');
  button.addEventListener('click', () => store.update({ fillSelected: !store.getState().fillSelected }));
  for (const swatch of root.querySelectorAll('[data-fill-color]')) swatch.addEventListener('click', () => {
    const color = swatch.dataset.fillColor;
    if (swatch.dataset.fillMode === 'paint') store.update({ fillColor: color });
    else store.updateSelected({ color });
  });
  for (const mode of ['paint', 'edit']) root.querySelector(`#fill-${mode}-opacity`).addEventListener('input', event => {
    const opacity = Number(event.target.value) / 100;
    if (mode === 'paint') store.update({ fillOpacity: opacity });
    else store.updateSelected({ opacity });
  });
  return store.subscribe(state => {
    const selected = state.fills.find(fill => fill.id === state.selectedId);
    button.setAttribute('aria-pressed', String(state.fillSelected));
    button.setAttribute('aria-expanded', String(state.fillSelected));
    options.hidden = !state.fillSelected; settings.hidden = !selected;
    const next = root.querySelector('#fill-next-badge'); next.textContent = state.fillNextLabel; next.style.setProperty('--fill-color', state.fillColor);
    for (const mode of ['paint', 'edit']) {
      const color = mode === 'paint' ? state.fillColor : selected?.color;
      const opacity = mode === 'paint' ? state.fillOpacity : selected?.opacity;
      (mode === 'paint' ? options : settings).style.setProperty('--selected-color', color ?? state.fillColor);
      for (const swatch of root.querySelectorAll(`[data-fill-mode="${mode}"]`)) swatch.setAttribute('aria-pressed', String(swatch.dataset.fillColor === color));
      const input = root.querySelector(`#fill-${mode}-opacity`), value = Math.round((opacity ?? 0.24) * 100);
      input.value = String(value); input.style.setProperty('--progress', `${(value - 10) / 50 * 100}%`);
      root.querySelector(`#fill-${mode}-value`).textContent = `${value}%`;
    }
  });
}
