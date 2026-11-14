import { CURVE_PRESETS, MAX_BEND } from '../graph/curve.js';
import { createViewport } from '../graph/viewport.js';
import { INDIFFERENCE_FAMILIES, isIndifference, indifferenceMovement } from '../graph/indifference.js';
import { ppcRadii } from '../graph/ppc.js';
import { curveFamilyOf, supportsOpposite, isOppositeCurve } from '../models/curve-families.js';
import { boxOrigin, defaultOppositeOrigin } from '../graph/axes.js';
import { RangeControl, NumberControl } from '../ui/controls.js';

export function mountCurveTool(root, store) {
  const settings = root.querySelector('#curve-settings');
  const bendControl = new RangeControl(root,'bend-slider');
  const presets = root.querySelectorAll('[data-curve-variant]');
  for (const button of root.querySelectorAll('[data-add-indifference]')) button.addEventListener('click',()=>{
    const graph=root.querySelector('.diagram-card.is-active .graph-container'),state=store.getState();
    const {bounds}=createViewport(graph.clientWidth,graph.clientHeight,state.quadrantMode,state);
    const x=Math.max(0.2,bounds.xMax*0.4),y=Math.max(0.2,bounds.yMax*0.4),family=button.dataset.addIndifference;
    if (state.indifferenceOpposite&&supportsOpposite({family})) {
      // Mirror the usual placement: the same offset, measured from the opposite origin.
      const origin=boxOrigin(state)??{x:bounds.xMax*0.8,y:bounds.yMax*0.8};
      // A mirrored Leontief's kink rides a ray from (0,0); start it off the diagonal to the opposite origin.
      const lower=family==='complements'?Math.max(0.2,bounds.yMax*0.6):y;
      store.addIndifference(family,{anchor:{x:origin.x-x,y:origin.y-lower},opposite:true,oppositeOrigin:origin});
    } else store.addIndifference(family,{anchor:family==='ppc'?{x:Math.min(x,y),y:Math.min(x,y)}:{x,y}});
  });
  const oppositeNew=root.querySelector('#indifference-opposite-new'),opposite=root.querySelector('#indifference-opposite');
  oppositeNew.addEventListener('change',()=>store.update({indifferenceOpposite:oppositeNew.checked}));
  opposite.addEventListener('change',()=>{
    const state=store.getState(),c=state.curves.find(c=>c.id===state.selectedId);
    if (c) store.updateSelected({opposite:opposite.checked,oppositeOrigin:defaultOppositeOrigin(state,c.anchor)});
  });
  const icSettings=root.querySelector('#indifference-settings'),axis=root.querySelector('#indifference-axis');
  const shapeControl=new RangeControl(root,'indifference-shape'),radii={};
  for (const key of ['x','y']) radii[key]=new NumberControl(root,`ppc-radius-${key}`).bind(value=>{
    const c=store.getState().curves.find(c=>c.id===store.getState().selectedId);
    if (c?.family==='ppc') store.updateSelected(curveFamilyOf(c).endpointPatch(c,key,value));
  });
  // The family maps the slider; the kink slider needs the visible area of the active graph.
  const visibleBounds=state=>{
    const graph=root.querySelector('.diagram-card.is-active .graph-container');
    return graph?.clientWidth&&graph.clientHeight?createViewport(graph.clientWidth,graph.clientHeight,state.quadrantMode,state).bounds:null;
  };
  shapeControl.bind(position=>{
    const state=store.getState(),c=state.curves.find(c=>c.id===state.selectedId);
    if (!isIndifference(c)) return;
    store.updateSelected(curveFamilyOf(c).fromSliderPosition(c,position,visibleBounds(state)));
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
  return store.subscribe(state => {
    const { curves, selectedId, indifferenceOpposite } = state;
    const curve = curves.find((item) => item.id === selectedId);
    oppositeNew.checked=indifferenceOpposite;
    root.querySelector('.indifference-library').classList.toggle('is-opposite',indifferenceOpposite);
    settings.hidden = !curve || isIndifference(curve);
    icSettings.hidden=!isIndifference(curve);
    if (isIndifference(curve)) {
      const preset=INDIFFERENCE_FAMILIES[curve.family];
      root.querySelector('#indifference-title').textContent=preset.label;
      root.querySelector('#indifference-movement').textContent=indifferenceMovement(curve);
      root.querySelector('#indifference-axis-row').hidden=curve.family!=='quasilinear';
      root.querySelector('#indifference-opposite-row').hidden=!supportsOpposite(curve);
      opposite.checked=isOppositeCurve(curve);
      root.querySelector('#indifference-shape-label').textContent=preset.shape;
      axis.value=curve.linearAxis;
      root.querySelector('#ppc-radii').hidden=curve.family!=='ppc';
      if (curve.family==='ppc') for (const [key,radius] of Object.entries(ppcRadii(curve))) {
        radii[key].setValue(radius,3);
      }
      shapeControl.setValue(curveFamilyOf(curve).sliderPosition(curve,visibleBounds(state)));
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
