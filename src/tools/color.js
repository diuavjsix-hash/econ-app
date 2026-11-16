import { colorTargets } from '../objects.js';

/** The colors the selection currently shows: one color, or several (mixed). */
export function selectionColors(state) {
  return [...new Set(colorTargets(state).map(object => object.color?.toLowerCase()).filter(Boolean))];
}

/**
 * The color rows of the shape/set panel and the multi-selection panel. A chip paints the
 * whole selection (every shape in a selected set); the custom chip opens the system picker
 * and its live preview is one undo step.
 */
export function mountColorTool(root, store) {
  const scopes = ['object', 'multi'];
  for (const chip of root.querySelectorAll('[data-color-scope][data-color]')) chip.addEventListener('click', () => store.colorSelected(chip.dataset.color));
  for (const scope of scopes) {
    const input = root.querySelector(`#${scope}-color-custom`);
    let previewing = false;
    input.addEventListener('input', () => {
      if (!previewing) { store.beginHistory(); previewing = true; }
      store.colorSelected(input.value);
    });
    input.addEventListener('change', () => { if (previewing) { previewing = false; store.endHistory(); } });
  }
  const row = root.querySelector('#object-color-row');
  return store.subscribe(state => {
    const colors = selectionColors(state), single = colors.length === 1 ? colors[0] : null;
    // A painted region keeps its own color and opacity settings.
    row.hidden = state.fills.some(fill => fill.id === state.selectedId);
    for (const scope of scopes) {
      root.querySelector(`#${scope}-color-mixed`).hidden = colors.length < 2;
      for (const chip of root.querySelectorAll(`[data-color-scope="${scope}"]`)) chip.setAttribute('aria-pressed', String(chip.dataset.color === single));
      const input = root.querySelector(`#${scope}-color-custom`);
      if (single && document.activeElement !== input) input.value = single;
    }
  });
}
