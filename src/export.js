import { DEFAULT_AXIS_GAP } from './graph/display.js';
import { QUADRANT_MODES, faceToFace, stacked, lowerHeightOf } from './graph/viewport.js';
import { objectModel } from './models/objects.js';
import { describeRelations } from './graph/drawn-relations.js';
const serializeObjects = objects => (objects ?? []).map(object => objectModel(object).serialize());

export const SCHEMA_VERSION = 13;
/** Exported text keeps this many decimals; the document itself keeps full precision. */
export const EXPORT_DECIMALS = 6;

// A short key for readers (people or AI) of the exported file. English, so any reader can use it.
const LEGEND = Object.freeze({
  coordinates: 'All coordinates are mathematical graph coordinates, never screen pixels. Numbers are rounded to 6 decimals.',
  relations: 'Position relations computed from the current drawing. at = the position; points = point objects at it; on = objects and axes passing through it; tangent = pairs of objects with the same direction there (touching); slopes = curve slopes there (null = vertical); features = start/end of a line or curve, kink, minimum.',
  axes: 'axis-x and axis-y are the x and y axes; axis-b-x and axis-b-y are the axes of Edgeworth box owner B; axis-lower-x and axis-lower-y are the axes of the lower graph on a stacked sheet.',
  lines: 'A line passes through anchor with slope (null = vertical; then xIntercept is its x). Direction is the unit vector (1, slope)/sqrt(1 + slope^2), or (0, 1) when vertical. extent [from, to] gives distances along that direction from anchor; null means that end is open (a ray or a full line). segment lists the drawn end points. implicit is a*x + b*y + c = 0. style is solid or dashed.',
  curves: 'type curve with variant ascending/descending is a free-hand quadratic Bezier with tangent-ray extensions. With family it is a parametric curve (ppc, cobb-douglas, rectangular-hyperbola, substitutes, complements, quasilinear) passing through anchor, with shape as its parameter. orientation opposite: the curve is drawn from oppositeOrigin with both axes reversed (global point = oppositeOrigin - local point), and geometry describes it in that reversed frame.',
  sketches: 'A sketch is a free curve from start to end through anchor, with tangent the direction at anchor; geometry.controlPoints are its two quadratic Bezier pieces. showMinimum only shows its lowest point.',
  sums: 'A sum is computed, not stored as a shape. direction vertical adds the y values of sourceIds at each x; horizontal adds their x values at each y. nonnegative: inputs start at 0 and each contribution is max(0, value).',
  bindings: 'binding is a live dependency on sourceId. through-point: the line always passes through that point and moves with it. tangent: the sketch stays tangent to that line at distance parameter along it. parentId is only folder/list nesting with no geometric meaning; groups are folders.',
  fills: 'A fill paints the area enclosed by rings (even-odd rule, so an inner ring is a hole); label is its letter on the drawing.',
  display: 'color, opacity, label, style, showGrid, showCoordinates, showMinimum and lineAxisGap (lines kept off the axes by that distance) only change how the drawing looks. objectOrder is the order the objects were created.',
});
// Added only when such a sheet is exported, so other files keep their legend.
const FACE_LEGEND = 'A face-to-face sheet (coordinateSystem.type face-to-face) is two graphs back to back on a shared y axis. Coordinates with x < 0 belong to the facing graph, whose own horizontal value is -x.';
const EDGEWORTH_LEGEND = "An Edgeworth box (coordinateSystem.type edgeworth) stores every coordinate from owner A's origin. Owner B's origin is oppositeOrigin; B reads a point p as (totals.width - p.x, totals.height - p.y).";

/** The facing graph on a face-to-face sheet: where it is drawn and how to read its x. */
// Added only when a stacked sheet is exported.
const STACKED_LEGEND = 'A stacked sheet (coordinateSystem.type stacked) is an upper and a lower graph sharing one x scale. Coordinates with y >= 0 belong to the upper graph (origin 0,0); y < 0 belongs to the lower graph (origin lower.lowerOrigin), whose own vertical value is y + lowerHeight. A segment crossing both graphs, such as a dashed guide, is an ordinary segment in this one coordinate system; lines and curves are drawn as drawn and may cross both graphs.';
/** The lower graph on a stacked sheet: its origin and axis names. */
const lowerGraph = state => ({ lowerHeight: lowerHeightOf(state), lowerOrigin: { x: 0, y: -lowerHeightOf(state) }, lowerAxisNames: { ...(state.lowerAxisNames ?? { x: 'x', y: 'y' }) }, ownY: 'y+lowerHeight' });
const facingSide = state => ({ side: state.flipX ? 'right' : 'left', axisName: state.faceAxisName, xPositive: state.flipX ? 'right' : 'left', ownX: '-x' });

function serializeDiagram(state) {
  const baseOrigin = QUADRANT_MODES[state.quadrantMode].origin;
  const origin = baseOrigin === 'center' ? 'center' : `${baseOrigin.startsWith('middle') ? 'middle' : state.flipY ? 'top' : 'bottom'}-${baseOrigin.endsWith('center') ? 'center' : state.flipX ? 'right' : 'left'}`;
  return {
    coordinateSystem: { origin, quadrants: [...QUADRANT_MODES[state.quadrantMode].quadrants], xPositive: state.flipX ? 'left' : 'right', yPositive: state.flipY ? 'down' : 'up', axesVisible: true, axisNames: { ...state.axisNames }, lineAxisGap: { enabled: Boolean(state.axisGapEnabled), distance: state.axisGap ?? DEFAULT_AXIS_GAP },
      ...(state.quadrantMode==='edgeworth'?{type:'edgeworth',totals:{...state.boxSize},oppositeOrigin:{x:state.boxSize.width,y:state.boxSize.height},oppositeAxisNames:{...state.boxAxisNames},oppositeXPositive:state.flipX?'right':'left',oppositeYPositive:state.flipY?'up':'down'}:{}),
      ...(faceToFace(state.quadrantMode) ? { type: 'face-to-face', sharedAxis: 'y', facing: facingSide(state) } : {}),
      ...(stacked(state.quadrantMode) ? { type: 'stacked', sharedAxis: 'x', lower: lowerGraph(state) } : {}) },
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
    legend: { ...LEGEND, ...(state.diagrams.some(diagram => faceToFace(diagram.quadrantMode)) ? { faceToFace: FACE_LEGEND } : {}),
      ...(state.diagrams.some(diagram => stacked(diagram.quadrantMode)) ? { stacked: STACKED_LEGEND } : {}),
      ...(state.diagrams.some(diagram => diagram.quadrantMode === 'edgeworth') ? { edgeworth: EDGEWORTH_LEGEND } : {}) },
    activeDiagramId: state.activeDiagramId,
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
