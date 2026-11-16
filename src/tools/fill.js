import { FILL_COLORS } from '../graph/fill-style.js';
import { rangeField, RangeControl, swatches } from '../ui/controls.js';

export function fillControls(mode) {
  return `${mode === 'paint' ? '<div class="field"><span class="field-label">다음 구역</span><span id="fill-next-badge" class="fill-next-badge">A</span></div>' : swatches({ label: '구역 색', colors: FILL_COLORS, data: { 'fill-mode': mode } })}
    ${rangeField({id:`fill-${mode}-opacity`,label:'진하기',outputId:`fill-${mode}-value`,output:'24%',min:10,max:60,step:1,value:24})}`;
}

export function mountFillTool(root, store) {
  const button = root.querySelector('#fill-tool'), options = root.querySelector('#fill-options'), settings = root.querySelector('#fill-settings');
  button.addEventListener('click', () => store.toggleToolMode('fill'));
  for (const swatch of root.querySelectorAll('[data-fill-mode][data-color]')) swatch.addEventListener('click', () => {
    const color = swatch.dataset.color;
    if (swatch.dataset.fillMode === 'paint') store.update({ fillColor: color });
    else store.updateSelected({ color });
  });
  const opacityControls={};
  for (const mode of ['paint', 'edit']) opacityControls[mode]=new RangeControl(root,`fill-${mode}-opacity`).bind(value => {
    const opacity = value / 100;
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
      for (const swatch of root.querySelectorAll(`[data-fill-mode="${mode}"]`)) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color));
      const value = Math.round((opacity ?? 0.24) * 100);
      opacityControls[mode].setValue(value);
      root.querySelector(`#fill-${mode}-value`).textContent = `${value}%`;
    }
  });
}
