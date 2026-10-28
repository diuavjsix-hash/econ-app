import { objectsOf } from '../objects.js';
import { distance } from '../graph/sketch.js';
import { canAttach } from '../relations.js';

export function mountSketchTool(root, store) {
  const button=root.querySelector('#sketch-tool'), options=root.querySelector('#sketch-options'), settings=root.querySelector('#sketch-settings');
  const mode=root.querySelector('#sketch-mode'), target=root.querySelector('#sketch-line'), status=root.querySelector('#sketch-status');
  let signature='', selectedId=null;
  button.addEventListener('click',()=>store.update({sketchSelected:!store.getState().sketchSelected}));
  mode.addEventListener('change',()=>store.update({sketchMode:mode.value}));
  target.addEventListener('change',()=>{root.querySelector('#sketch-attach').disabled=!target.value;status.textContent='';});
  for (const [id,key] of [['#sketch-left','leftReach'],['#sketch-right','rightReach']]) root.querySelector(id).addEventListener('input',event=>store.updateSelected({[key]:Number(event.target.value)/100}));
  root.querySelector('#sketch-attach').addEventListener('click',()=>{
    status.textContent=store.attachSelectedToLine(target.value) ? '직선과 접하도록 연결했습니다.' : '이 직선에는 연결할 수 없습니다. 순환 관계나 점의 겹침을 확인해 주세요.';
  });
  root.querySelector('#sketch-minimum').addEventListener('click',()=>store.markMinimum());
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
      const label={tangent:'접점 유지',minimum:'최저점 따라가기','through-point':'점 따라가기'}[object.binding.kind];
      root.querySelector('#binding-description').textContent=`${label} · ${source?.name ?? ''}`;
    }
    if (selectedId!==state.selectedId) {status.textContent='';selectedId=state.selectedId;}
    if (!curve) return;
    root.querySelector('#sketch-left').value=String(Math.round(curve.leftReach*100)); root.querySelector('#sketch-right').value=String(Math.round(curve.rightReach*100));
    for (const button of root.querySelectorAll('[data-sketch-shape]')) button.disabled=Boolean(curve.binding);
    const lines=state.lines.filter(line=>canAttach(state,curve.id,line.id));
    const next=JSON.stringify(lines.map(({id,name})=>[id,name]));
    if (signature!==next) {
      const previous=target.value, empty=document.createElement('option');empty.value='';empty.textContent='직선 선택';
      target.replaceChildren(empty,...lines.map(line=>{const option=document.createElement('option');option.value=line.id;option.textContent=line.name;return option;}));
      target.value=lines.some(line=>line.id===previous)?previous:''; signature=next;
    }
    if (!target.value && curve.binding) target.value=curve.binding.sourceId;
    root.querySelector('#sketch-attach').disabled=!target.value;
  });
}
