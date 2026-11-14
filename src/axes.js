import { RangeControl, NumberControl } from './ui/controls.js';
import { faceToFace, sheetPanels } from './graph/viewport.js';

export function mountAxes(root, store) {
  const horizontal = root.querySelector('#horizontal-axis-name');
  const vertical = root.querySelector('#vertical-axis-name');
  const faceName = root.querySelector('#face-axis-name');
  const gapToggle = root.querySelector('#axis-gap-toggle');
  const gapSettings = root.querySelector('#axis-gap-settings');
  const gapSlider = new RangeControl(root,'axis-gap-slider');
  const gapValue = root.querySelector('#axis-gap-value');
  horizontal.addEventListener('input', () => store.update({ axisNames: { x: horizontal.value } }));
  vertical.addEventListener('input', () => store.update({ axisNames: { y: vertical.value } }));
  faceName.addEventListener('input', () => store.update({ faceAxisName: faceName.value }));
  gapToggle.addEventListener('change', () => store.update({ axisGapEnabled: gapToggle.checked }));
  gapSlider.bind(value => store.update({ axisGap: value }));
  const lowerHeight = new NumberControl(root, 'lower-height').bind(value => store.update({ lowerHeight: value }));
  const leftWidth = new NumberControl(root, 'left-width').bind(value => store.update({ leftWidth: value }));
  const panelAxes = [...root.querySelectorAll('[data-panel-axes]')];
  for (const group of panelAxes) for (const axis of ['x', 'y']) {
    const key = group.dataset.panelAxes;
    root.querySelector(`#${key}-axis-${axis}`).addEventListener('input', event => store.update({ panelAxisNames: { [key]: { [axis]: event.target.value } } }));
  }
  const totals={};
  for (const key of ['width','height']) totals[key]=new NumberControl(root,`box-${key}`).bind(value=>store.update({boxSize:{[key]:value}}));
  for (const key of ['x','y']) root.querySelector(`#box-axis-${key}`).addEventListener('input',event=>store.update({boxAxisNames:{[key]:event.target.value}}));
  return store.subscribe(state => {
    const { axisNames, axisGapEnabled, axisGap, quadrantMode, boxSize, boxAxisNames, faceAxisName, panelAxisNames } = state;
    // Panel sheets show the sizes and axis names of the graphs they have.
    const panels = new Set(sheetPanels(state).map(panel => panel.key));
    root.querySelector('#panel-settings').hidden = !panels.size;
    root.querySelector('#left-width-setting').hidden = !panels.has('right');
    lowerHeight.setValue(state.lowerHeight); leftWidth.setValue(state.leftWidth);
    root.querySelector('label[for="lower-height"] .field-label').textContent = panels.has('middle') ? '가운데·아래 그래프 높이' : '아래 그래프 높이';
    for (const group of panelAxes) {
      const key = group.dataset.panelAxes;
      group.hidden = !panels.has(key);
      for (const axis of ['x', 'y']) {
        const input = root.querySelector(`#${key}-axis-${axis}`);
        if (input.value !== panelAxisNames[key][axis]) input.value = panelAxisNames[key][axis];
      }
    }
    root.querySelector('#edgeworth-settings').hidden=quadrantMode!=='edgeworth';
    root.querySelector('#face-settings').hidden=!faceToFace(quadrantMode);
    if (faceName.value !== faceAxisName) faceName.value = faceAxisName;
    for (const key of ['width','height']) {
      totals[key].setValue(boxSize[key]);
    }
    for (const key of ['x','y']) {
      const input=root.querySelector(`#box-axis-${key}`);
      if (input.value!==boxAxisNames[key]) input.value=boxAxisNames[key];
    }
    if (horizontal.value !== axisNames.x) horizontal.value = axisNames.x;
    if (vertical.value !== axisNames.y) vertical.value = axisNames.y;
    gapToggle.checked = axisGapEnabled;
    gapSettings.hidden = !axisGapEnabled;
    gapSlider.setValue(axisGap);
    gapValue.value = String(Number(axisGap.toFixed(2)));
  });
}
