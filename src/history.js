export function mountHistory(root, store) {
  const undo = root.querySelector('#undo-action');
  const redo = root.querySelector('#redo-action');
  const clear = root.querySelector('#clear-all');
  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  clear.addEventListener('click', () => store.clearAll());

  const textInput = (target) => target.matches('input[type="text"], input[type="number"]');
  let editingText = null;
  root.addEventListener('focusin', ({ target }) => {
    if (textInput(target)) { store.endHistory(); store.beginHistory(); editingText = target; }
  });
  root.addEventListener('focusout', ({ target }) => {
    if (target === editingText) { editingText = null; store.endHistory(); }
  });
  let rangeGesture = false;
  const endRange = () => { if (rangeGesture) { rangeGesture = false; store.endHistory(); } };
  root.addEventListener('pointerdown', ({ target }) => {
    if (target.matches('input[type="range"]')) {
      // Pointerdown precedes the old text field's blur; finish it before starting the slider.
      if (editingText) { editingText = null; store.endHistory(); }
      store.beginHistory(); rangeGesture = true;
    }
  });
  document.addEventListener('pointerup', endRange);
  document.addEventListener('pointercancel', endRange);
  root.addEventListener('keydown', (event) => {
    if (event.target.matches('input[type="range"]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      store.beginHistory(); rangeGesture = true;
    }
  });
  root.addEventListener('keyup', endRange);
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return;
    if (event.target.closest('input:not([type="range"]), textarea, [contenteditable="true"]') || root.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) store.redo();
    else store.undo();
  });
  return store.subscribe(({ canUndo, canRedo, objectOrder }) => {
    undo.disabled = !canUndo;
    redo.disabled = !canRedo;
    clear.disabled = objectOrder.length === 0;
  });
}
