import { objectsOf, OBJECT_LABELS } from './objects.js';
import { DUPLICATABLE } from './duplicate.js';

/** One task determines the inspector; opening settings never changes the document. */
export function editorContext(state) {
  const object=objectsOf(state).find(object=>object.id===state.selectedId);
  if (state.sumPanel) return {kind:'operation',title:'수직합 · 수평합',mode:'합치기',detail:'직선·기본 곡선을 두 개 이상 선택하세요.'};
  if (state.duplicatePanel) return {kind:'operation',title:'복제',mode:'복제',detail:'원본을 고르고 복제합니다.'};
  if (state.sketchSelected) return {kind:'creation',title:'곡선 그리기',mode:'곡선',detail:'시작점 → 끝점 → 지나는 점'};
  if (state.dashedSelected) return {kind:'creation',title:'점선 그리기',mode:'점선',detail:'두 점을 클릭하거나 드래그하세요.'};
  if (state.mouseSelected) return {kind:'creation',title:'점 찍기',mode:'점',detail:state.activeTool==='point'?'클릭해서 점을 찍습니다.':'점 생성이 꺼져 있습니다.'};
  if (object) return {kind:'selection',title:`${OBJECT_LABELS[object.type]} 편집`,mode:'선택·이동',detail:object.name,object};
  return {kind:'empty',title:'선택 항목',mode:'선택·이동',detail:''};
}

export function mountEditorUI(root,store) {
  const dialog=root.querySelector('#graph-settings-dialog'),menu=root.querySelector('#curve-menu');
  const finish=root.querySelector('#finish-tool');
  finish.addEventListener('click',()=>{store.update({handSelected:true});root.querySelector('#hand-tool').focus();});
  root.querySelector('#graph-settings-action').addEventListener('click',()=>dialog.showModal());
  for (const id of ['#close-graph-settings','#done-graph-settings']) root.querySelector(id).addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>event.stopPropagation());
  root.addEventListener('click',event=>{
    if (event.target.closest('[data-add-curve]')) menu.open=false;
    else if (!menu.contains(event.target)) menu.open=false;
  });
  root.addEventListener('keydown',event=>{
    if (event.key==='Escape' && menu.open) menu.open=false;
  });
  return store.subscribe(state=>{
    const context=editorContext(state), selected=objectsOf(state).find(object=>object.id===state.selectedId);
    root.querySelector('#inspector-title').textContent=context.title;
    root.querySelector('#editor-mode').textContent=context.mode;
    const detail=root.querySelector('#editor-status-detail');detail.textContent=context.detail;detail.title=context.detail;
    root.querySelector('#inspector-empty').hidden=context.kind!=='empty';
    for (const [id,kind] of [['#creation-inspector','creation'],['#operation-inspector','operation'],['#selection-inspector','selection']]) root.querySelector(id).hidden=context.kind!==kind;
    finish.hidden=!['creation','operation'].includes(context.kind);
    const duplicate=root.querySelector('#duplicate-tool');
    duplicate.disabled=!selected || !DUPLICATABLE.includes(selected.type);
    duplicate.title=duplicate.disabled?'이 도형은 복제할 수 없습니다.':'선택한 도형 복제';
    root.querySelector('#object-count').textContent=String(state.objectOrder.length);
    root.querySelector('#objects-empty').hidden=state.objectOrder.length>0;
    const graph=state.diagrams.find(diagram=>diagram.id===state.activeDiagramId);
    root.querySelector('#graph-dialog-title').textContent=`${graph.name||'그래프'} 설정`;
    // A stale open disclosure should not carry a previous object's advanced controls.
    const inspector=root.querySelector('#selection-inspector');
    if (inspector.dataset.selectedId!==state.selectedId) {
      for (const details of inspector.querySelectorAll('details')) details.open=false;
      inspector.dataset.selectedId=state.selectedId??'';
    }
  });
}
