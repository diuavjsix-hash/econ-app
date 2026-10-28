import { mountGraph } from './graph/canvas.js';
import { QUADRANT_MODES } from './graph/viewport.js';

export function diagramState(state, id) {
  const diagram = state.diagrams.find(d => d.id === id);
  return { ...state, ...diagram, selectedId: state.activeDiagramId === id ? state.selectedId : null, sketchSelected:state.activeDiagramId===id && state.sketchSelected, handSelected: state.activeDiagramId === id && state.handSelected, duplicatePanel: state.activeDiagramId === id && state.duplicatePanel, dashedSelected: state.activeDiagramId === id && state.dashedSelected, mouseSelected: state.activeDiagramId === id && state.mouseSelected };
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
    for (const [index, diagram] of visible.entries()) {
      let card = cards.get(diagram.id);
      if (!card) {
        const element = document.createElement('section');
        element.className = 'diagram-card';
        element.dataset.diagramId = diagram.id;
        const button = document.createElement('button');
        button.className = 'diagram-title';
        const graph = document.createElement('div'); graph.className = 'graph-container';
        element.append(button, graph); grid.append(element);
        const activate = () => store.selectDiagram(diagram.id);
        element.addEventListener('pointerdown', activate, true);
        element.addEventListener('keydown', activate, true);
        button.addEventListener('click', () => { activate(); store.selectObject(null); });
        const scoped = {
          getState: () => diagramState(store.getState(), diagram.id),
          subscribe: listener => store.subscribe(snapshot => listener(diagramState(snapshot, diagram.id))),
          ...Object.fromEntries(['beginHistory', 'endHistory', 'addPoint', 'addSketch', 'addDashedLine', 'selectObject', 'updateSelected'].map(method => [method, (...args) => store[method](...args)])),
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
