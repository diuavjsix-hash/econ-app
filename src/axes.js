import { MIN_AXIS_GAP, MAX_AXIS_GAP } from './graph/display.js';

export function mountAxes(root, store) {
  const horizontal = root.querySelector('#horizontal-axis-name');
  const vertical = root.querySelector('#vertical-axis-name');
  const gapToggle = root.querySelector('#axis-gap-toggle');
  const gapSettings = root.querySelector('#axis-gap-settings');
  const gapSlider = root.querySelector('#axis-gap-slider');
  const gapValue = root.querySelector('#axis-gap-value');
  horizontal.addEventListener('input', () => store.update({ axisNames: { x: horizontal.value } }));
  vertical.addEventListener('input', () => store.update({ axisNames: { y: vertical.value } }));
  gapToggle.addEventListener('change', () => store.update({ axisGapEnabled: gapToggle.checked }));
  gapSlider.addEventListener('input', () => store.update({ axisGap: Number(gapSlider.value) }));
  return store.subscribe(({ axisNames, axisGapEnabled, axisGap }) => {
    if (horizontal.value !== axisNames.x) horizontal.value = axisNames.x;
    if (vertical.value !== axisNames.y) vertical.value = axisNames.y;
    gapToggle.checked = axisGapEnabled;
    gapSettings.hidden = !axisGapEnabled;
    gapSlider.value = String(axisGap);
    gapSlider.style.setProperty('--progress', `${(axisGap - MIN_AXIS_GAP) / (MAX_AXIS_GAP - MIN_AXIS_GAP) * 100}%`);
    gapValue.value = String(Number(axisGap.toFixed(2)));
  });
}
