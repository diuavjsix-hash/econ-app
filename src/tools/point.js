export function mountPointTool(root, store) {
  const button = root.querySelector('#point-tool');
  const settings = root.querySelector('#point-settings');
  const snapToggle = root.querySelector('#point-snap-toggle');
  const coordinatesToggle = root.querySelector('#point-coordinates-toggle');
  const showCoordinates = root.querySelector('#point-show-coordinates');
  const mouseButton = root.querySelector('#mouse-tool');
  const mouseSettings = root.querySelector('#mouse-settings');
  mouseButton.addEventListener('click', () => {
    store.update({ mouseSelected: !store.getState().mouseSelected });
  });
  snapToggle.addEventListener('change', () => store.update({ pointSnap: snapToggle.checked }));
  coordinatesToggle.addEventListener('change', () => store.update({ pointCoordinates: coordinatesToggle.checked }));
  showCoordinates.addEventListener('change', () => store.updateSelected({ showCoordinates: showCoordinates.checked }));
  button.addEventListener('change', () => store.update({ activeTool: button.checked ? 'point' : 'select' }));
  for (const [id, key] of [['point-horizontal', 'horizontal'], ['point-vertical', 'vertical'], ['point-guide-extent', 'extent']]) {
    root.querySelector(`#${id}`).addEventListener('change', (event) => store.updateSelected({ guides: { [key]: event.target.value } }));
  }
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') store.update({ activeTool: 'select' });
  });
  return store.subscribe(({ points, selectedId, activeTool, mouseSelected, pointSnap, pointCoordinates }) => {
    mouseSettings.hidden = !mouseSelected;
    mouseButton.setAttribute('aria-pressed', String(mouseSelected));
    mouseButton.setAttribute('aria-expanded', String(mouseSelected));
    snapToggle.checked = pointSnap;
    coordinatesToggle.checked = pointCoordinates;
    button.checked = activeTool === 'point';
    const point = points.find((item) => item.id === selectedId);
    settings.hidden = !point;
    if (!point) return;
    showCoordinates.checked = point.showCoordinates;
    root.querySelector('#point-horizontal').value = point.guides.horizontal;
    root.querySelector('#point-vertical').value = point.guides.vertical;
    root.querySelector('#point-guide-extent').value = point.guides.extent;
  });
}
