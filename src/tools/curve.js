import { CURVE_PRESETS, MAX_BEND } from '../graph/curve.js';
import { createViewport } from '../graph/viewport.js';
import { INDIFFERENCE_FAMILIES, isIndifference, indifferenceMovement } from '../graph/indifference.js';
import { ppcRadii } from '../graph/ppc.js';
import { curveFamilyOf } from '../models/curve-families.js';
import { RangeControl, NumberControl } from '../ui/controls.js';

export function mountCurveTool(root, store) {
  const settings = root.querySelector('#curve-settings');
  const bendControl = new RangeControl(root,'bend-slider');
  const presets = root.querySelectorAll('[data-curve-variant]');
  for (const button of root.querySelectorAll('[data-add-indifference]')) button.addEventListener('click',()=>{
    const graph=root.querySelector('.diagram-card.is-active .graph-container'),state=store.getState();
    const {bounds}=createViewport(graph.clientWidth,graph.clientHeight,state.quadrantMode,state);
    const x=Math.max(0.2,bounds.xMax*0.4),y=Math.max(0.2,bounds.yMax*0.4);
    store.addIndifference(button.dataset.addIndifference,{anchor:button.dataset.addIndifference==='ppc'?{x:Math.min(x,y),y:Math.min(x,y)}:{x,y}});
  });
  const icSettings=root.querySelector('#indifference-settings'),axis=root.querySelector('#indifference-axis');
  const shapeControl=new RangeControl(root,'indifference-shape'),radii={};
  for (const key of ['x','y']) radii[key]=new NumberControl(root,`ppc-radius-${key}`).bind(value=>{
    const c=store.getState().curves.find(c=>c.id===store.getState().selectedId);
    if (c?.family==='ppc') store.updateSelected(curveFamilyOf(c).endpointPatch(c,key,value));
  });
  shapeControl.bind(position=>{
    const c=store.getState().curves.find(c=>c.id===store.getState().selectedId);
    if (!isIndifference(c)) return;
    const value=0.15*Math.pow(20/0.15,position/100);
    store.updateSelected(curveFamilyOf(c).shapeFromValue(c,value));
  });
  axis.addEventListener('change',()=>store.updateSelected({linearAxis:axis.value}));
  for (const button of root.querySelectorAll('[data-add-curve]')) button.addEventListener('click', () => {
    const graph = root.querySelector('.diagram-card.is-active .graph-container');
    const state=store.getState(),{ bounds } = createViewport(graph.clientWidth, graph.clientHeight, state.quadrantMode,state);
    store.addCurve({
      variant:button.dataset.addCurve,
      anchor: { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 },
      span: Math.min((bounds.xMax - bounds.xMin) * 0.38, (bounds.yMax - bounds.yMin) * 0.36),
    });
  });
  bendControl.bind(value => store.updateSelected({ bend: value / 100 * MAX_BEND }));
  for (const preset of presets) preset.addEventListener('click', () => store.updateSelected({ variant: preset.dataset.curveVariant }));
  root.querySelector('#reset-curve').addEventListener('click', () => store.updateSelected({ bend: 0.25 }));
  return store.subscribe(({ curves, selectedId }) => {
    const curve = curves.find((item) => item.id === selectedId);
    settings.hidden = !curve || isIndifference(curve);
    icSettings.hidden=!isIndifference(curve);
    if (isIndifference(curve)) {
      const preset=INDIFFERENCE_FAMILIES[curve.family];
      root.querySelector('#indifference-title').textContent=preset.label;
      root.querySelector('#indifference-movement').textContent=indifferenceMovement(curve);
      root.querySelector('#indifference-axis-row').hidden=curve.family!=='quasilinear';
      root.querySelector('#indifference-shape-label').textContent=preset.shape;
      axis.value=curve.linearAxis;
      const value=curveFamilyOf(curve).shapeValue(curve);
      root.querySelector('#ppc-radii').hidden=curve.family!=='ppc';
      if (curve.family==='ppc') for (const [key,radius] of Object.entries(ppcRadii(curve))) {
        radii[key].setValue(radius,3);
      }
      shapeControl.setValue(Math.log(value/0.15)/Math.log(20/0.15)*100);
      return;
    }
    if (!curve) return;
    const value = Math.round(curve.bend / MAX_BEND * 100);
    settings.style.setProperty('--selected-color', curve.color);
    bendControl.setValue(value);
    root.querySelector('#bend-value').textContent = `${value}%`;
    root.querySelector('#curve-title').textContent = CURVE_PRESETS[curve.variant].label;
    for (const preset of presets) preset.setAttribute('aria-pressed', String(preset.dataset.curveVariant === curve.variant));
  });
}
