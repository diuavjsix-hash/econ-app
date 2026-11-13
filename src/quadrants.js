export function mountQuadrants(root, store) {
  const dialog = root.querySelector('#quadrant-dialog');
  const button = root.querySelector('#choose-quadrants');
  const choices = root.querySelectorAll('[data-quadrants]');
  const apply = root.querySelector('#apply-workspace');
  const close = root.querySelector('#close-workspace');
  const boxWidth = root.querySelector('#workspace-box-width'), boxHeight = root.querySelector('#workspace-box-height');
  let chosen = false, mode;

  function renderDraft() {
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.quadrants === mode));
    root.querySelector('#workspace-box-size').hidden = mode !== 'edgeworth';
    apply.disabled = mode === 'edgeworth' && (!boxWidth.validity.valid || !boxHeight.validity.valid);
  }
  boxWidth.addEventListener('input', renderDraft); boxHeight.addEventListener('input', renderDraft);
  function open() {
    const state = store.getState();
    mode = state.quadrantMode;
    boxWidth.value = String(state.boxSize.width); boxHeight.value = String(state.boxSize.height);
    apply.textContent = chosen ? '적용' : '시작'; close.hidden = !chosen;
    renderDraft(); dialog.showModal();
  }
  button.addEventListener('click', open);
  for (const choice of choices) choice.addEventListener('click', () => { mode = choice.dataset.quadrants; renderDraft(); });
  apply.addEventListener('click', () => {
    store.configureWorkspace(mode, { boxSize: { width: boxWidth.valueAsNumber, height: boxHeight.valueAsNumber } });
    chosen = true; dialog.close();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (!chosen) event.preventDefault(); });
  open();
  return () => {};
}
