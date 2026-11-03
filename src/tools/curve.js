import { CURVE_PRESETS, MAX_BEND } from '../graph/curve.js';
import { createViewport } from '../graph/viewport.js';
import { INDIFFERENCE_FAMILIES, isIndifference, indifferenceMovement, shapeIndifference } from '../graph/indifference.js';

export function mountCurveTool(root, store) {
  const settings = root.querySelector('#curve-settings');
  const slider = root.querySelector('#bend-slider');
  const presets = root.querySelectorAll('[data-curve-variant]');
  for (const button of root.querySelectorAll('[data-add-indifference]')) button.addEventListener('click',()=>{
    const graph=root.querySelector('.diagram-card.is-active .graph-container'),state=store.getState();
    const {bounds}=createViewport(graph.clientWidth,graph.clientHeight,state.quadrantMode,state);
    store.addIndifference(button.dataset.addIndifference,{anchor:{x:Math.max(0.2,bounds.xMax*0.4),y:Math.max(0.2,bounds.yMax*0.4)}});
  });
  const icSettings=root.querySelector('#indifference-settings'),shape=root.querySelector('#indifference-shape'),axis=root.querySelector('#indifference-axis');
  shape.addEventListener('input',()=>{
    const c=store.getState().curves.find(c=>c.id===store.getState().selectedId);
    if (!isIndifference(c)) return;
    const value=0.15*Math.pow(20/0.15,Number(shape.value)/100);
    if (c.family==='rectangular-hyperbola') store.updateSelected(shapeIndifference(c,{x:value,y:value}));
    else if (c.family==='complements') {
      const radius=Math.hypot(c.anchor.x,c.anchor.y),x=radius/Math.hypot(1,value);
      store.updateSelected({anchor:{x,y:x*value},reshape:true});
    } else store.updateSelected({shape:value});
  });
  axis.addEventListener('change',()=>store.updateSelected({linearAxis:axis.value}));
  for (const button of root.querySelectorAll('[data-add-curve]')) button.addEventListener('click', () => {
    const graph = root.querySelector('.diagram-card.is-active .graph-container');
    const { bounds } = createViewport(graph.clientWidth, graph.clientHeight, store.getState().quadrantMode);
    store.addCurve({
      variant:button.dataset.addCurve,
      anchor: { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 },
      span: Math.min((bounds.xMax - bounds.xMin) * 0.38, (bounds.yMax - bounds.yMin) * 0.36),
    });
  });
  slider.addEventListener('input', () => store.updateSelected({ bend: Number(slider.value) / 100 * MAX_BEND }));
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
      const value=curve.family==='rectangular-hyperbola'?Math.sqrt(curve.anchor.x)*Math.sqrt(curve.anchor.y):curve.family==='complements'?curve.anchor.y/curve.anchor.x:curve.shape;
      shape.value=String(Math.log(value/0.15)/Math.log(20/0.15)*100);
      shape.style.setProperty('--progress',`${shape.value}%`);
      return;
    }
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
