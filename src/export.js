import { DEFAULT_AXIS_GAP } from './graph/display.js';
import { QUADRANT_MODES } from './graph/viewport.js';
import { objectModel } from './models/objects.js';
const serializeObjects = objects => (objects ?? []).map(object => objectModel(object).serialize());

function serializeDiagram(state) {
  const baseOrigin = QUADRANT_MODES[state.quadrantMode].origin;
  const origin = baseOrigin === 'center' ? 'center' : `${state.flipY ? 'top' : 'bottom'}-${baseOrigin.endsWith('center') ? 'center' : state.flipX ? 'right' : 'left'}`;
  return {
    objectOrder: [...state.objectOrder],
    fills: serializeObjects(state.fills),
    sketches: serializeObjects(state.sketches),
    sums: serializeObjects(state.sums),
    groups: serializeObjects(state.groups),
    points: serializeObjects(state.points),
    rulers: serializeObjects(state.rulers),
    coordinateSystem: { origin, quadrants: [...QUADRANT_MODES[state.quadrantMode].quadrants], xPositive: state.flipX ? 'left' : 'right', yPositive: state.flipY ? 'down' : 'up', axesVisible: true, axisNames: { ...state.axisNames }, lineAxisGap: { enabled: Boolean(state.axisGapEnabled), distance: state.axisGap ?? DEFAULT_AXIS_GAP },
      ...(state.quadrantMode==='edgeworth'?{type:'edgeworth',totals:{...state.boxSize},oppositeOrigin:{x:state.boxSize.width,y:state.boxSize.height},oppositeAxisNames:{...state.boxAxisNames},oppositeXPositive:state.flipX?'right':'left',oppositeYPositive:state.flipY?'up':'down'}:{}) },
    showGrid: state.showGrid,
    lines: serializeObjects(state.lines),
    curves: serializeObjects(state.curves),
  };
}

export function serializeDocument(state) {
  return {
    schemaVersion: 12,
    // Retain the active diagram's fields for consumers of the earlier format.
    ...serializeDiagram(state),
    activeDiagramId: state.activeDiagramId,
    layout: {
      preset: state.layout.preset,
      slots: state.layout.slots.map(({ row, column }, index) => ({ diagramId: state.diagrams[index].id, row, column })),
    },
    diagrams: state.diagrams.map(diagram => ({ id: diagram.id, name: diagram.name, ...serializeDiagram(diagram) })),
  };
}

export function mountExport(root, store) {
  const dialog = root.querySelector('#json-dialog');
  const output = root.querySelector('#json-output');
  root.querySelector('#export-json').addEventListener('click', () => {
    output.value = JSON.stringify(serializeDocument(store.getState()), null, 2);
    dialog.showModal();
  });
  root.querySelector('#close-json').addEventListener('click', () => dialog.close());
  const copyButton = root.querySelector('#copy-json');
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copyButton.textContent = '복사됨';
    } catch {
      output.focus();
      output.select();
      copyButton.textContent = 'Ctrl+C';
    }
    setTimeout(() => { copyButton.textContent = '복사'; }, 1500);
  });
  root.querySelector('#download-json').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([output.value], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'econ-studio.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
