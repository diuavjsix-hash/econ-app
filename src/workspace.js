import { mountGraph } from './graph/canvas.js';
import { QUADRANT_MODES } from './graph/viewport.js';
import { selectedIdsOf } from './objects.js';
import { toolModeFlags, toolModeOf } from './tool-modes.js';

export function diagramState(state, id) {
  const diagram = state.diagrams.find(d => d.id === id);
  const active = state.activeDiagramId === id;
  // Inactive diagrams show no tool mode, selection or editing handles.
  return { ...state, ...diagram, ...toolModeFlags(active ? toolModeOf(state) : null),
    selectedIds: active ? selectedIdsOf(state) : [], selectedId: active ? state.selectedId : null };
}

export function mountWorkspace(root, store) {
  const grid = root.querySelector('#graph');
  const cards = new Map();
  const name = root.querySelector('#diagram-name');
  const quadrant = root.querySelector('#diagram-quadrant');
  const directionX = root.querySelector('#diagram-x-direction');
  const directionY = root.querySelector('#diagram-y-direction');
  name.addEventListener('input', () => store.updateDiagram({ name: name.value }));
  quadrant.addEventListener('change', () => store.update({ quadrantMode: quadrant.value }));
  directionX.addEventListener('change', () => store.updateDiagram({ flipX: directionX.value === 'left' }));
  directionY.addEventListener('change', () => store.updateDiagram({ flipY: directionY.value === 'down' }));

  return store.subscribe(state => {
    const visible = state.diagrams.slice(0, state.layout.slots.length);
    for (const [id, card] of cards) if (!visible.some(d => d.id === id)) { card.dispose(); card.element.remove(); cards.delete(id); }
    const rows = Math.max(...state.layout.slots.map(s => s.row)) + 1;
    const columns = Math.max(...state.layout.slots.map(s => s.column)) + 1;
    grid.style.setProperty('--rows', rows);
    grid.style.setProperty('--columns', columns);
    grid.dataset.count = String(visible.length);
    for (const [index, diagram] of visible.entries()) {
      let card = cards.get(diagram.id);
      if (!card) {
        const element = document.createElement('section');
        element.className = 'diagram-card';
        element.dataset.diagramId = diagram.id;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'diagram-title';
        const graph = document.createElement('div'); graph.className = 'graph-container';
        element.append(button, graph); grid.append(element);
        const activate = () => store.selectDiagram(diagram.id);
        element.addEventListener('pointerdown', activate, true);
        element.addEventListener('keydown', activate, true);
        button.addEventListener('click', () => { activate(); store.selectObject(null); });
        const scoped = {
          getState: () => diagramState(store.getState(), diagram.id),
          subscribe: listener => store.subscribe(snapshot => listener(diagramState(snapshot, diagram.id))),
          ...Object.fromEntries(['beginHistory', 'endHistory', 'addLine', 'addPoint', 'addSketch', 'addDashedLine', 'addFill', 'selectObject', 'selectObjects', 'updateSelected'].map(method => [method, (...args) => store[method](...args)])),
        };
        card = { element, button, dispose: mountGraph(graph, scoped) };
        cards.set(diagram.id, card);
      }
      const position = state.layout.slots[index];
      card.element.style.gridRow = position.row + 1;
      card.element.style.gridColumn = position.column + 1;
      const active = diagram.id === state.activeDiagramId;
      card.element.classList.toggle('is-active', active);
      card.element.setAttribute('aria-label', diagram.name || `그래프 ${index + 1}`);
      card.button.textContent = diagram.name || `그래프 ${index + 1}`;
      card.button.setAttribute('aria-pressed', String(active));
      card.button.title = `${QUADRANT_MODES[diagram.quadrantMode].label} · ${diagram.flipX ? 'x ←' : 'x →'} · ${diagram.flipY ? 'y ↓' : 'y ↑'}`;
    }
    const active = state.diagrams.find(d => d.id === state.activeDiagramId);
    if (name.value !== active.name) name.value = active.name;
    quadrant.value = active.quadrantMode;
    directionX.value = active.flipX ? 'left' : 'right';
    directionY.value = active.flipY ? 'down' : 'up';
  });
}
