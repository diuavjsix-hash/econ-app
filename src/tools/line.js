import { angleFromSlope, formatNumber, lineEquation, normalizeSlope, slopeFromAngle } from '../graph/math.js';

export function mountLineTool(root, store) {
  const button = root.querySelector('#line-tool');
  const settings = root.querySelector('#line-settings');
  const slider = root.querySelector('#slope-slider');
  const slopeInput = root.querySelector('#slope-input');
  const presets = root.querySelectorAll('[data-slope]');
  let editingSlope = false;
  let verticalSide = 90;
  button.addEventListener('click', () => store.addLine());
  slider.addEventListener('input', () => {
    verticalSide = Number(slider.value) < 0 ? -90 : 90;
    store.updateSelected({ slope: slopeFromAngle(Number(slider.value)) });
  });
  slopeInput.addEventListener('input', () => {
    if (slopeInput.value === '' || !Number.isFinite(slopeInput.valueAsNumber)) return;
    editingSlope = true;
    store.updateSelected({ slope: slopeInput.valueAsNumber });
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

  return store.subscribe(({ lines, selectedId }) => {
    const selected = lines.find((line) => line.id === selectedId);
    settings.hidden = !selected;
    if (!selected) return;
    const { slope } = selected;
    settings.style.setProperty('--selected-color', selected.color);
    const angle = slope === null ? verticalSide : angleFromSlope(slope);
    slider.value = String(angle);
    slider.style.setProperty('--progress', `${(angle + 90) / 180 * 100}%`);
    slider.setAttribute('aria-valuetext', slope === null ? '수직선' : formatNumber(slope));
    if (!editingSlope) slopeInput.value = slope === null ? '' : String(slope);
    slopeInput.placeholder = slope === null ? '수직' : '';
    root.querySelector('#equation-value').textContent = lineEquation(selected);
    for (const preset of presets) preset.setAttribute('aria-pressed', String(preset.dataset.slope === 'vertical' ? slope === null : slope !== null && Number(preset.dataset.slope) === slope));
  });
}
