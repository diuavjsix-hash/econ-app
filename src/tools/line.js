import { angleFromSlope, formatNumber, lineEquation, normalizeSlope, slopeFromAngle } from '../graph/math.js';
import { RangeControl, NumberControl } from '../ui/controls.js';
import { createViewport } from '../graph/viewport.js';
import { LINE_KINDS, LINE_STYLES, extentForKind, lineKindOf, visibleLineEnds } from '../graph/line-extent.js';

/** Bounds of the active diagram as its canvas currently draws them. */
function activeBounds(root, state) {
  const container = root.querySelector('.diagram-card.is-active .graph-container');
  if (!container?.clientWidth || !container.clientHeight) return null;
  return createViewport(container.clientWidth, container.clientHeight, state.quadrantMode, state).bounds;
}
/** Kind and style buttons; `choose` receives the clicked value, `pressed` mirrors the state. */
function mountShapeButtons(section, { kind, style }) {
  for (const button of section.querySelectorAll('[data-line-kind]')) button.addEventListener('click', () => kind(button.dataset.lineKind));
  for (const button of section.querySelectorAll('[data-line-style]')) button.addEventListener('click', () => style(button.dataset.lineStyle));
  return (currentKind, currentStyle) => {
    for (const button of section.querySelectorAll('[data-line-kind]')) button.setAttribute('aria-pressed', String(button.dataset.lineKind === currentKind));
    for (const button of section.querySelectorAll('[data-line-style]')) button.setAttribute('aria-pressed', String(button.dataset.lineStyle === currentStyle));
  };
}

export function mountLineTool(root, store) {
  const button = root.querySelector('#line-tool');
  const settings = root.querySelector('#line-settings');
  const slider = new RangeControl(root,'slope-slider');
  const numeric = new NumberControl(root, 'slope-input'), slopeInput = numeric.input;
  const presets = root.querySelectorAll('[data-slope]');
  let editingSlope = false;
  let verticalSide = 90;
  const options = root.querySelector('#line-options');
  const snap = root.querySelector('#line-snap-toggle');
  button.addEventListener('click', () => store.toggleToolMode('line'));
  // The two-point tools share the segment snap and its toggle.
  snap.addEventListener('change', () => store.update({ segmentSnap: snap.checked }));
  const showNew = mountShapeButtons(options, {
    kind: kind => store.update({ lineKind: kind }), style: style => store.update({ lineStyle: style }),
  });
  const selectedLine = () => { const state = store.getState(); return state.lines.find(line => line.id === state.selectedId); };
  const showSelected = mountShapeButtons(root.querySelector('#line-shape-selected'), {
    kind: kind => {
      const line = selectedLine(), state = store.getState();
      if (!line || !LINE_KINDS.includes(kind) || lineKindOf(line) === kind) return;
      const bounds = activeBounds(root, state), visible = bounds && visibleLineEnds({ ...line, extent: null }, bounds, state);
      const extent = extentForKind(line, kind, visible?.edge ?? null);
      if (extent !== undefined) store.updateSelected({ extent });
    },
    style: style => { if (LINE_STYLES.includes(style)) store.updateSelected({ style }); },
  });
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

  return store.subscribe(({ lines, selectedId, lineSelected, lineKind, lineStyle, segmentSnap }) => {
    button.setAttribute('aria-pressed', String(lineSelected));
    button.setAttribute('aria-expanded', String(lineSelected));
    options.hidden = !lineSelected;
    snap.checked = segmentSnap;
    showNew(lineKind, lineStyle);
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
    showSelected(lineKindOf(selected), selected.style === 'dashed' ? 'dashed' : 'solid');
    // A link line keeps its direction: only its position, kind and style change.
    for (const control of [slider.input, slopeInput, root.querySelector('#reset-line'), ...presets]) control.disabled = Boolean(selected.link);
    for (const preset of presets) preset.setAttribute('aria-pressed', String(preset.dataset.slope === 'vertical' ? slope === null : slope !== null && Number(preset.dataset.slope) === slope));
  });
}
