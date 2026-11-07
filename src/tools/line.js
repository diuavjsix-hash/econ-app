import { angleFromSlope, formatNumber, lineEquation, normalizeSlope, slopeFromAngle } from '../graph/math.js';
import { RangeControl, NumberControl } from '../ui/controls.js';

export function mountLineTool(root, store) {
  const button = root.querySelector('#line-tool');
  const settings = root.querySelector('#line-settings');
  const slider = new RangeControl(root,'slope-slider');
  const numeric = new NumberControl(root, 'slope-input'), slopeInput = numeric.input;
  const presets = root.querySelectorAll('[data-slope]');
  let editingSlope = false;
  let verticalSide = 90;
  button.addEventListener('click', () => store.addLine());
  slider.bind(value => {
    verticalSide = value < 0 ? -90 : 90;
    store.updateSelected({ slope: slopeFromAngle(value) });
  });
  numeric.bind(value => {
    editingSlope = true;
    store.updateSelected({ slope: value });
    editingSlope = false;
  });
  slopeInput.addEventListener('change', () => {
    const selected = store.getState().lines.find((line) => line.id === store.getState().selectedId);
    if (selected) slopeInput.value = selected.slope === null ? '' : String(selected.slope);
  });
  for (const preset of presets) {
    preset.addEventListener('click', () => store.updateSelected({ slope: preset.dataset.slope === 'vertical' ? null : normalizeSlope(preset.dataset.slope) }));
  }
  root.querySelector('#reset-line').addEventListener('click', () => store.updateSelected({ slope: 1 }));
  const dashed = root.querySelector('#line-dashed');
  dashed.addEventListener('change', () => store.updateSelected({ style: dashed.checked ? 'dashed' : 'solid' }));

  return store.subscribe(({ lines, selectedId }) => {
    const selected = lines.find((line) => line.id === selectedId);
    settings.hidden = !selected;
    if (!selected) return;
    const { slope } = selected;
    settings.style.setProperty('--selected-color', selected.color);
    const angle = slope === null ? verticalSide : angleFromSlope(slope);
    slider.setValue(angle,slope === null ? '수직선' : formatNumber(slope));
    if (!editingSlope) slopeInput.value = slope === null ? '' : String(slope);
    slopeInput.placeholder = slope === null ? '수직' : '';
    root.querySelector('#equation-value').textContent = lineEquation(selected);
    dashed.checked = selected.style === 'dashed';
    for (const preset of presets) preset.setAttribute('aria-pressed', String(preset.dataset.slope === 'vertical' ? slope === null : slope !== null && Number(preset.dataset.slope) === slope));
  });
}
