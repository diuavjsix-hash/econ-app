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

  });
}
