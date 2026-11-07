export function mountDashedTool(root, store) {
  const button = root.querySelector('#dashed-tool');
  const options = root.querySelector('#dashed-options');
  const mode = root.querySelector('#dashed-mode');
  const snap = root.querySelector('#dashed-snap-toggle');
  button.addEventListener('click', () => store.toggleToolMode('dashed'));
  mode.addEventListener('change', () => store.update({ dashedMode: mode.value }));
  snap.addEventListener('change', () => store.update({ dashedSnap: snap.checked }));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && store.getState().dashedSelected) store.setToolMode('hand');
  });
  return store.subscribe(({ dashedSelected, dashedMode, dashedSnap }) => {
    button.setAttribute('aria-pressed', String(dashedSelected));
    button.setAttribute('aria-expanded', String(dashedSelected));
    options.hidden = !dashedSelected;
    mode.value = dashedMode;
    snap.checked = dashedSnap;
  });
}
