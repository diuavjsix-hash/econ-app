export function mountHandTool(root, store) {
  const button = root.querySelector('#hand-tool');
  button.addEventListener('click', () => store.update({ handSelected: true }));
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || root.querySelector('dialog[open]')) return;
    store.update({ handSelected: true });
  });
  return store.subscribe(({ handSelected }) => button.setAttribute('aria-pressed', String(handSelected)));
}
