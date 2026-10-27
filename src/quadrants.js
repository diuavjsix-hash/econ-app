import { LAYOUTS } from './layouts.js';

export function mountQuadrants(root, store) {
  const dialog = root.querySelector('#quadrant-dialog');
  const button = root.querySelector('#choose-quadrants');
  const choices = root.querySelectorAll('[data-quadrants]');
  const layoutChoices = root.querySelector('#layout-choices');
  const customGrid = root.querySelector('#custom-layout-grid');
  const applyAll = root.querySelector('#apply-all-quadrants');
  const apply = root.querySelector('#apply-workspace');
  const close = root.querySelector('#close-workspace');
  let chosen = false, preset, slots, mode;

  function renderDraft() {
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.quadrants === mode));
    for (const choice of layoutChoices.children) choice.setAttribute('aria-pressed', String(choice.dataset.layout === preset));
    for (const cell of customGrid.children) cell.setAttribute('aria-pressed', String(slots.some(s => s.row === Number(cell.dataset.row) && s.column === Number(cell.dataset.column))));
    apply.disabled = slots.length === 0;
  }
  for (const [id, layout] of Object.entries(LAYOUTS)) {
    const choice = document.createElement('button'); choice.dataset.layout = id;
    const preview = document.createElement('span'); preview.className = 'layout-preview'; preview.setAttribute('aria-hidden', 'true');
    const rows = Math.max(...layout.slots.map(s => s.row)) + 1, columns = Math.max(...layout.slots.map(s => s.column)) + 1;
    preview.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    preview.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    for (const slot of layout.slots) {
      const cell = document.createElement('span'); cell.className = 'layout-preview-cell';
      cell.style.gridRow = slot.row + 1; cell.style.gridColumn = slot.column + 1;
      cell.innerHTML = `<svg viewBox="0 0 32 28"><g transform="translate(${slot.flipX ? 32 : 0} ${slot.flipY ? 28 : 0}) scale(${slot.flipX ? -1 : 1} ${slot.flipY ? -1 : 1})"><path d="M5 3v20h24M2 6l3-3 3 3M26 20l3 3-3 3"/></g></svg>`;
      preview.append(cell);
    }
    const label = document.createElement('span'); label.textContent = layout.label;
    choice.append(preview, label); layoutChoices.append(choice);
    choice.addEventListener('click', () => { preset = id; slots = structuredClone(layout.slots); renderDraft(); });
  }
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const cell = document.createElement('button'); cell.dataset.row = row; cell.dataset.column = column;
    cell.textContent = '+'; cell.setAttribute('aria-label', `${row + 1}행 ${column + 1}열 그래프`); customGrid.append(cell);
    cell.addEventListener('click', () => {
      preset = 'custom';
      const exists = slots.some(s => s.row === row && s.column === column);
      slots = slots.filter(s => s.row !== row || s.column !== column);
      if (!exists) slots.push({ row, column, flipX: false, flipY: false });
      slots.sort((a, b) => a.row - b.row || a.column - b.column);
      renderDraft();
    });
  }
  function open() {
    const state = store.getState();
    preset = state.layout.preset; slots = structuredClone(state.layout.slots); mode = state.quadrantMode;
    applyAll.checked = !chosen;
    apply.textContent = chosen ? '적용' : '시작'; close.hidden = !chosen;
    renderDraft(); dialog.showModal();
  }
  button.addEventListener('click', open);
  for (const choice of choices) choice.addEventListener('click', () => { mode = choice.dataset.quadrants; renderDraft(); });
  apply.addEventListener('click', () => {
    const state = store.getState();
    const preserveDirections = state.layout.preset === preset && JSON.stringify(state.layout.slots) === JSON.stringify(slots);
    store.configureLayout(preset, slots, mode, { allQuadrants: applyAll.checked, preserveDirections });
    chosen = true; dialog.close();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (!chosen) event.preventDefault(); });
  const unsubscribe = store.subscribe(({ layout }) => {
    button.textContent = `배치 · ${layout.slots.length}개`;
    button.setAttribute('aria-label', `작업 영역 설정, 현재 ${LAYOUTS[layout.preset]?.label ?? '직접 배치'}`);
  });
  open();
  return unsubscribe;
}
