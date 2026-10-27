import { rulerMetrics } from '../graph/ruler.js';
import { pointCoordinatesLabel } from '../graph/point.js';

export function mountRulerTool(root, store) {
  const button = root.querySelector('#ruler-tool');
  const options = root.querySelector('#ruler-options');
  const mode = root.querySelector('#ruler-mode');
  const settings = root.querySelector('#ruler-settings');
  const style = root.querySelector('#ruler-style');
  const show = root.querySelector('#ruler-show-measurement');
  button.addEventListener('click', () => store.update({ rulerSelected: !store.getState().rulerSelected }));
  mode.addEventListener('change', () => store.update({ rulerMode: mode.value }));
  style.addEventListener('change', () => store.updateSelected({ style: style.value }));
  show.addEventListener('change', () => store.updateSelected({ showMeasurement: show.checked }));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && store.getState().rulerSelected) store.update({ rulerSelected: false });
  });
  return store.subscribe(state => {
    button.setAttribute('aria-pressed', String(state.rulerSelected));
    button.setAttribute('aria-expanded', String(state.rulerSelected));
    options.hidden = !state.rulerSelected;
    mode.value = state.rulerMode;
    const ruler = state.rulers.find(r => r.id === state.selectedId);
    settings.hidden = !ruler;
    if (!ruler) return;
    const metrics = rulerMetrics(ruler);
    root.querySelector('#ruler-length').textContent = String(Number(metrics.length.toFixed(2)));
    root.querySelector('#ruler-delta').textContent = `Δx ${Number(metrics.dx.toFixed(2))} · Δy ${Number(metrics.dy.toFixed(2))}`;
    root.querySelector('#ruler-endpoints').textContent = `${pointCoordinatesLabel(ruler.anchor)} → ${pointCoordinatesLabel(ruler.end)}`;
    style.value = ruler.style; show.checked = ruler.showMeasurement;
  });
}
