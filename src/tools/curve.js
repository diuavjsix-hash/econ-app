import { CURVE_PRESETS, MAX_BEND } from '../graph/curve.js';
import { createViewport } from '../graph/viewport.js';

export function mountCurveTool(root, store) {
  const settings = root.querySelector('#curve-settings');
  const slider = root.querySelector('#bend-slider');
  const presets = root.querySelectorAll('[data-curve-variant]');
  root.querySelector('#curve-tool').addEventListener('click', () => {
    const graph = root.querySelector('#graph');
    const { bounds } = createViewport(graph.clientWidth, graph.clientHeight, store.getState().quadrantMode);
    store.addCurve({
      anchor: { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 },
      span: Math.min((bounds.xMax - bounds.xMin) * 0.38, (bounds.yMax - bounds.yMin) * 0.36),
    });
  });
  slider.addEventListener('input', () => store.updateSelected({ bend: Number(slider.value) / 100 * MAX_BEND }));
  for (const preset of presets) preset.addEventListener('click', () => store.updateSelected({ variant: preset.dataset.curveVariant }));
  root.querySelector('#reset-curve').addEventListener('click', () => store.updateSelected({ bend: 0.25 }));
  return store.subscribe(({ curves, selectedId }) => {
    const curve = curves.find((item) => item.id === selectedId);
    settings.hidden = !curve;
    if (!curve) return;
    const value = Math.round(curve.bend / MAX_BEND * 100);
    settings.style.setProperty('--selected-color', curve.color);
    slider.value = String(value);
    slider.style.setProperty('--progress', `${value}%`);
    root.querySelector('#bend-value').textContent = `${value}%`;
    root.querySelector('#curve-title').textContent = CURVE_PRESETS[curve.variant].label;
    for (const preset of presets) preset.setAttribute('aria-pressed', String(preset.dataset.curveVariant === curve.variant));
  });
}
