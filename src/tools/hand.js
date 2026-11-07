export function mountHandTool(root, store) {
  const button = root.querySelector('#hand-tool');
  button.addEventListener('click', () => store.setToolMode('hand'));
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || root.querySelector('dialog[open]')) return;
    if (store.getState().handSelected) store.selectObject(null);
    store.setToolMode('hand');
  });
  return store.subscribe(({ handSelected }) => button.setAttribute('aria-pressed', String(handSelected)));
}
