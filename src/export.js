import { DEFAULT_AXIS_GAP } from './graph/display.js';
import { QUADRANT_MODES, faceToFace } from './graph/viewport.js';
import { objectModel } from './models/objects.js';
import { describeRelations } from './graph/drawn-relations.js';
const serializeObjects = objects => (objects ?? []).map(object => objectModel(object).serialize());

export const SCHEMA_VERSION = 13;
/** Exported text keeps this many decimals; the document itself keeps full precision. */
export const EXPORT_DECIMALS = 6;

// A short key for readers (people or AI) of the exported file.
const LEGEND = Object.freeze({
  coordinates: '모든 좌표는 그래프의 수학 좌표입니다. 화면 픽셀이 아닙니다.',
  relations: '현재 그림에서 계산한 위치 관계입니다. at=위치, points=그 위치의 점, on=그 위치를 지나는 도형과 축, tangent=그 위치에서 방향이 같은(접하는) 두 도형, slopes=곡선의 그 위치 기울기(null은 수직), features=도형의 start·end(시작·끝)·kink(꺾임)·minimum(최저점)',
  axes: 'axis-x·axis-y는 x축·y축, axis-b-x·axis-b-y는 에지워드 상자 B의 축입니다.',
});
// Added only when a face-to-face sheet is exported, so other files keep their legend.
const FACE_LEGEND = 'coordinateSystem.type이 face-to-face인 그래프는 y축을 공유하는 맞붙은 두 그래프입니다. x<0인 좌표는 맞은편 그래프에 있고, 그 그래프의 수평축 값은 -x입니다.';

/** The facing graph on a face-to-face sheet: where it is drawn and how to read its x. */
const facingSide = state => ({ side: state.flipX ? 'right' : 'left', axisName: state.faceAxisName, xPositive: state.flipX ? 'right' : 'left', ownX: '-x' });

function serializeDiagram(state) {
  const baseOrigin = QUADRANT_MODES[state.quadrantMode].origin;
  const origin = baseOrigin === 'center' ? 'center' : `${state.flipY ? 'top' : 'bottom'}-${baseOrigin.endsWith('center') ? 'center' : state.flipX ? 'right' : 'left'}`;
  return {
    coordinateSystem: { origin, quadrants: [...QUADRANT_MODES[state.quadrantMode].quadrants], xPositive: state.flipX ? 'left' : 'right', yPositive: state.flipY ? 'down' : 'up', axesVisible: true, axisNames: { ...state.axisNames }, lineAxisGap: { enabled: Boolean(state.axisGapEnabled), distance: state.axisGap ?? DEFAULT_AXIS_GAP },
      ...(state.quadrantMode==='edgeworth'?{type:'edgeworth',totals:{...state.boxSize},oppositeOrigin:{x:state.boxSize.width,y:state.boxSize.height},oppositeAxisNames:{...state.boxAxisNames},oppositeXPositive:state.flipX?'right':'left',oppositeYPositive:state.flipY?'up':'down'}:{}),
      ...(faceToFace(state.quadrantMode) ? { type: 'face-to-face', sharedAxis: 'y', facing: facingSide(state) } : {}) },
    showGrid: state.showGrid,
    objectOrder: [...state.objectOrder],
    lines: serializeObjects(state.lines),
    curves: serializeObjects(state.curves),
    sketches: serializeObjects(state.sketches),
    sums: serializeObjects(state.sums),
    points: serializeObjects(state.points),
    fills: serializeObjects(state.fills),
    groups: serializeObjects(state.groups),
    rulers: serializeObjects(state.rulers),
    relations: describeRelations(state),
  };
}

/** Every diagram once (no top-level copy of the active one), each with its computed relations. */
export function serializeDocument(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    legend: state.diagrams.some(diagram => faceToFace(diagram.quadrantMode)) ? { ...LEGEND, faceToFace: FACE_LEGEND } : LEGEND,
    activeDiagramId: state.activeDiagramId,
    layout: {
      preset: state.layout.preset,
      slots: state.layout.slots.map(({ row, column }, index) => ({ diagramId: state.diagrams[index].id, row, column })),
    },
    diagrams: state.diagrams.map(diagram => ({ id: diagram.id, name: diagram.name, ...serializeDiagram(diagram) })),
  };
}

const roundNumber = (key, value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scale = 10 ** EXPORT_DECIMALS, rounded = Math.round(value * scale) / scale;
  return rounded === 0 ? 0 : rounded; // No -0 in the text.
};
/** The text the save dialog shows, copies and downloads. */
export function exportJson(state) {
  return JSON.stringify(serializeDocument(state), roundNumber, 2);
}

export function mountExport(root, store) {
  const dialog = root.querySelector('#json-dialog');
  const output = root.querySelector('#json-output');
  root.querySelector('#export-json').addEventListener('click', () => {
    output.value = exportJson(store.getState());
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
