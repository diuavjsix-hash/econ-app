import { canReparent, OBJECT_LABELS, objectsOf, selectedIdsOf } from '../objects.js';
import { icon, objectGlyph } from '../ui/icons.js';

export function mountObjectList(root, store) {
  const list = root.querySelector('#object-list');
  const rootDrop = root.querySelector('#object-root-drop');
  const settings = root.querySelector('#object-settings');
  const nameInput = root.querySelector('#object-name');
  const parentInput = root.querySelector('#object-parent');
  let signature = '', parentSignature = '', draggedId = null;
  let currentObjects = [];
  const label = (object) => object.name || OBJECT_LABELS[object.type];
  const clearDrop = () => {
    for (const node of root.querySelectorAll('.drop-target')) node.classList.remove('drop-target');
  };
  root.querySelector('#add-group').addEventListener('click', () => {
    store.addGroup();
    nameInput.focus();
    nameInput.select();
  });
  nameInput.addEventListener('input', () => store.updateSelected({ name: nameInput.value }));
  parentInput.addEventListener('change', () => store.moveObject(store.getState().selectedId, parentInput.value || null));
  root.querySelector('#delete-object').addEventListener('click', () => store.removeSelected());
  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-object-id]');
    if (!row) return;
    if (event.target.closest('[data-action="fold"]')) store.toggleCollapsed(row.dataset.objectId);
    else store.selectObject(row.dataset.objectId,{toggle:event.ctrlKey||event.metaKey});
  });
  list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-object-id]');
    if (!row || !event.dataTransfer) return;
    draggedId = row.dataset.objectId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedId);
    rootDrop.hidden = false;
    row.classList.add('is-tree-dragging');
  });
  const finishDrag = () => {
    draggedId = null;
    clearDrop();
    rootDrop.hidden = true;
    for (const row of list.querySelectorAll('.is-tree-dragging')) row.classList.remove('is-tree-dragging');
  };
  list.addEventListener('dragend', finishDrag);
  for (const area of [list, rootDrop]) {
    area.addEventListener('dragover', (event) => {
      const row = event.target.closest('[data-object-id]');
      const parentId = row?.dataset.objectId ?? null;
      clearDrop();
      if (!draggedId || !canReparent(currentObjects, draggedId, parentId)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      (row || rootDrop).classList.add('drop-target');
    });
    area.addEventListener('drop', (event) => {
      if (!draggedId) return;
      event.preventDefault();
      const row = event.target.closest('[data-object-id]');
      store.moveObject(draggedId, row?.dataset.objectId ?? null);
      finishDrag();
    });
  }

  return store.subscribe((state) => {
    const objects = objectsOf(state);
    currentObjects = objects;
    const selected = objects.find((object) => object.id === state.selectedId);
    const nextSignature = JSON.stringify(objects.map(({ id, type, name, color, parentId, collapsed }) => ({ id, type, name, color, parentId, collapsed })));
    if (signature !== nextSignature) {
      const focusRow = document.activeElement?.closest('[data-object-id]');
      const focusId = focusRow?.dataset.objectId;
      const focusAction = document.activeElement?.dataset.action;
      const children = new Map();
      for (const object of objects) {
        const parent = object.parentId ?? null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(object);
      }
      function branch(object) {
        const wrapper = document.createElement('div');
        wrapper.className = 'object-branch';
        wrapper.setAttribute('role', 'treeitem');
        const descendants = children.get(object.id) ?? [];
        if (descendants.length || object.type === 'group') wrapper.setAttribute('aria-expanded', String(!object.collapsed));
        const row = document.createElement('div');
        row.className = 'object-row';
        row.dataset.objectId = object.id;
        row.draggable = true;
        const fold = document.createElement('button');
        fold.className = 'tree-fold';
        fold.dataset.action = 'fold';
        fold.type = 'button';
        fold.innerHTML = icon('chevron');
        fold.classList.toggle('is-collapsed', Boolean(object.collapsed));
        fold.setAttribute('aria-label', `${label(object)} ${object.collapsed ? '펼치기' : '접기'}`);
        fold.disabled = !descendants.length && object.type !== 'group';
        if (fold.disabled) fold.classList.add('empty-fold');
        const item = document.createElement('button');
        item.className = 'object-item';
        item.dataset.action = 'select';
        item.setAttribute('aria-label', label(object));
        const swatch = document.createElement('span');
        swatch.className = `object-symbol ${object.type}`;
        swatch.style.setProperty('--object-color', object.color);
        swatch.innerHTML = objectGlyph(object.type === 'group' || descendants.length ? 'group' : object.type);
        const name = document.createElement('span');
        name.className = 'object-label';
        name.textContent = label(object);
        const grip = document.createElement('span');
        grip.className = 'tree-grip';
        grip.innerHTML = icon('grip');
        grip.setAttribute('aria-hidden', 'true');
        item.append(swatch, name, grip);
        row.append(fold, item);
        wrapper.append(row);
        if (descendants.length && !object.collapsed) {
          const nested = document.createElement('div');
          nested.className = 'object-children';
          nested.setAttribute('role', 'group');
          nested.append(...descendants.map(branch));
          wrapper.append(nested);
        }
        return wrapper;
      }
      list.replaceChildren(...(children.get(null) ?? []).map(branch));
      signature = nextSignature;
      if (focusId && focusAction) list.querySelector(`[data-object-id="${focusId}"] [data-action="${focusAction}"]`)?.focus();
    }
    for (const row of list.querySelectorAll('[data-object-id]')) {
      const active = selectedIdsOf(state).includes(row.dataset.objectId);
      row.classList.toggle('is-selected', active);
      row.parentElement.setAttribute('aria-selected', String(active));
      row.querySelector('.object-item').setAttribute('aria-pressed', String(active));
    }
    settings.hidden = !selected;
    if (!selected) return;
    if (nameInput.value !== selected.name) nameInput.value = selected.name;
    const nextParents = JSON.stringify([state.selectedId, objects.map(({ id, name, parentId }) => ({ id, name, parentId }))]);
    if (parentSignature !== nextParents) {
      const top = document.createElement('option');
      top.value = '';
      top.textContent = '최상위';
      parentInput.replaceChildren(top);
      for (const candidate of objects) {
        if (!canReparent(objects, selected.id, candidate.id)) continue;
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = label(candidate);
        parentInput.append(option);
      }
      parentSignature = nextParents;
    }
    parentInput.value = selected.parentId ?? '';
  });
}
