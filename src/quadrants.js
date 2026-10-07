import { QUADRANT_MODES } from './graph/viewport.js';

export function mountQuadrants(root, store) {
  const dialog = root.querySelector('#quadrant-dialog');
  const button = root.querySelector('#choose-quadrants');
  const choices = root.querySelectorAll('[data-quadrants]');
  button.addEventListener('click', () => dialog.showModal());
  for (const choice of choices) {
    choice.addEventListener('click', () => {
      store.update({ quadrantMode: choice.dataset.quadrants });
      dialog.close();
    });
  }
  // The initial choice is required; later openings can be dismissed with Escape.
  let chosen = false;
  dialog.addEventListener('cancel', (event) => { if (!chosen) event.preventDefault(); });
  dialog.addEventListener('close', () => { chosen = true; });
  const unsubscribe = store.subscribe(({ quadrantMode }) => {
    button.textContent = QUADRANT_MODES[quadrantMode].label;
    button.setAttribute('aria-label', `사분면 선택, 현재 ${QUADRANT_MODES[quadrantMode].label}`);
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.quadrants === quadrantMode));
  });
  dialog.showModal();
  return unsubscribe;
}
