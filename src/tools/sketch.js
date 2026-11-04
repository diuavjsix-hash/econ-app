import { objectsOf } from '../objects.js';
import { distance } from '../graph/sketch.js';

export function mountSketchTool(root, store) {
  const button=root.querySelector('#sketch-tool'), options=root.querySelector('#sketch-options'), settings=root.querySelector('#sketch-settings');
  const mode=root.querySelector('#sketch-mode');
  button.addEventListener('click',()=>store.update({sketchSelected:!store.getState().sketchSelected}));
  mode.addEventListener('change',()=>store.update({sketchMode:mode.value}));
  const reachControls={};
  for (const [id,key] of [['sketch-left','leftReach'],['sketch-right','rightReach']]) reachControls[key]=new RangeControl(root,id).bind(value=>store.updateSelected({[key]:value/100}));
  root.querySelector('#sketch-minimum').addEventListener('change',event=>store.updateSelected({showMinimum:event.target.checked}));
  root.querySelector('#point-through-line').addEventListener('click',()=>store.lineThroughSelectedPoint({follow:root.querySelector('#point-line-follow').checked}));
  root.querySelector('#detach-binding').addEventListener('click',()=>store.detachSelected());
  for (const button of root.querySelectorAll('[data-sketch-shape]')) button.addEventListener('click',()=>{
    const state=store.getState(), curve=state.sketches.find(curve=>curve.id===state.selectedId);
    if (!curve || curve.binding) return;
    const shape=button.dataset.sketchShape, a=curve.anchor;
    const width=Math.max(0.5,(distance(curve.start,a)+distance(curve.end,a))/2), height=width*0.6;
    const vertical=['left','right'].includes(shape), sign=['cup','left'].includes(shape)?1:-1;
    store.updateSelected(vertical ? {start:{x:a.x+sign*height,y:a.y-width},end:{x:a.x+sign*height,y:a.y+width},tangent:{x:0,y:1}}
      : {start:{x:a.x-width,y:a.y+sign*height},end:{x:a.x+width,y:a.y+sign*height},tangent:{x:1,y:0}});
  });
  return store.subscribe(state=>{
    options.hidden=!state.sketchSelected;
    button.setAttribute('aria-pressed',String(state.sketchSelected)); button.setAttribute('aria-expanded',String(state.sketchSelected)); mode.value=state.sketchMode;
    const object=objectsOf(state).find(object=>object.id===state.selectedId), curve=object?.type==='sketch'?object:null;
    settings.hidden=!curve;
    root.querySelector('#binding-settings').hidden=!object?.binding;
    if (object?.binding) {
      const source=objectsOf(state).find(source=>source.id===object.binding.sourceId);
      const label={tangent:'접점 유지','through-point':'점 따라가기'}[object.binding.kind];
      root.querySelector('#binding-description').textContent=`${label} · ${source?.name ?? ''}`;
    }
    if (!curve) return;
    root.querySelector('#sketch-minimum').checked=Boolean(curve.showMinimum);
    reachControls.leftReach.setValue(Math.round(curve.leftReach*100)); reachControls.rightReach.setValue(Math.round(curve.rightReach*100));
    for (const button of root.querySelectorAll('[data-sketch-shape]')) button.disabled=Boolean(curve.binding);
  });
}
import { RangeControl } from '../ui/controls.js';
