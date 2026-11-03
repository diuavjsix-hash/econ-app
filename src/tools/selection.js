import { objectsOf, selectedIdsOf, OBJECT_LABELS } from '../objects.js';

export function canDeleteSelection(event,state,dialogOpen=false) {
  return ['Delete','Backspace'].includes(event.key) && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey
    && !event.isComposing && !event.repeat && !dialogOpen && state.handSelected && selectedIdsOf(state).length>0
    && !event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function mountSelectionTool(root,store) {
  const button=root.querySelector('#delete-selection'),label=root.querySelector('#delete-selection-label');
  const multiple=root.querySelector('#delete-multiple'),list=root.querySelector('#multi-selection-list');
  let signature='';
  for (const control of [button,multiple]) control.addEventListener('click',()=>store.removeSelected());
  root.querySelector('#clear-selection').addEventListener('click',()=>store.selectObject(null));
  document.addEventListener('keydown',event=>{
    if (!canDeleteSelection(event,store.getState(),Boolean(root.querySelector('dialog[open]')))) return;
    event.preventDefault();store.removeSelected();
  });
  return store.subscribe(state=>{
    const ids=selectedIdsOf(state),selected=new Set(ids),count=ids.length;
    button.disabled=!state.handSelected || !count;
    label.textContent=count>1?`${count}개 삭제`:'삭제';
    button.setAttribute('aria-label',count?`선택한 도형 ${count}개 삭제`:'선택한 도형 삭제');
    multiple.textContent=`선택한 ${count}개 삭제`;
    const objects=objectsOf(state).filter(object=>selected.has(object.id)),next=JSON.stringify(objects.map(({id,name,color})=>[id,name,color]));
    if (signature!==next) {
      list.replaceChildren(...objects.map(object=>{
        const item=document.createElement('li'),swatch=document.createElement('span'),name=document.createElement('span');
        swatch.className='selection-swatch';swatch.style.backgroundColor=object.color;
        name.textContent=object.name||OBJECT_LABELS[object.type];item.append(swatch,name);return item;
      }));signature=next;
    }
  });
}
