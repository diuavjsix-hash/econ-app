import { objectsOf, OBJECT_LABELS, selectedIdsOf } from './objects.js';
import { DUPLICATABLE } from './duplicate.js';
import { TOOL_MODES, toolModeOf } from './tool-modes.js';

/** One task determines the inspector; opening settings never changes the document. */
export function editorContext(state) {
  const object=objectsOf(state).find(object=>object.id===state.selectedId);
  const tool=TOOL_MODES[toolModeOf(state)];
  if (tool?.context) return {kind:tool.kind,...tool.context(state)};
  if (selectedIdsOf(state).length>1) return {kind:'multiple',title:`${selectedIdsOf(state).length}개 선택`,mode:'선택',detail:`${selectedIdsOf(state).length}개 선택`};
  if (object) return {kind:'selection',title:`${OBJECT_LABELS[object.type]} 편집`,mode:'선택·이동',detail:object.name,object};
  return {kind:'empty',title:'선택 항목',mode:'선택·이동',detail:''};
}

export function mountEditorUI(root,store) {
  const dialog=root.querySelector('#graph-settings-dialog');
  const finish=root.querySelector('#finish-tool');
  finish.addEventListener('click',()=>{store.setToolMode('hand');root.querySelector('#hand-tool').focus();});
  root.querySelector('#graph-settings-action').addEventListener('click',()=>dialog.showModal());
  for (const id of ['#close-graph-settings','#done-graph-settings']) root.querySelector(id).addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>event.stopPropagation());
  return store.subscribe(state=>{
    const context=editorContext(state), selected=objectsOf(state).find(object=>object.id===state.selectedId);
    root.querySelector('#inspector-title').textContent=context.title;
    root.querySelector('#editor-mode').textContent=context.mode;
    const detail=root.querySelector('#editor-status-detail');detail.textContent=context.detail;detail.title=context.detail;
    root.querySelector('#inspector-empty').hidden=context.kind!=='empty';
    for (const [id,kind] of [['#creation-inspector','creation'],['#operation-inspector','operation'],['#selection-inspector','selection'],['#multi-selection-inspector','multiple']]) root.querySelector(id).hidden=context.kind!==kind;
    finish.hidden=!['creation','operation'].includes(context.kind);
    const duplicate=root.querySelector('#duplicate-tool');
    duplicate.disabled=!objectsOf(state).some(object=>DUPLICATABLE.includes(object.type));
    duplicate.title=duplicate.disabled?'복제할 도형을 먼저 추가하세요.':DUPLICATABLE.includes(selected?.type)?'선택한 도형 복제':'복제할 도형 선택';
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
