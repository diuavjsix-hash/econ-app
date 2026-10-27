import { directionOf, interceptOf } from './graph/math.js';
import { QUADRANT_MODES } from './graph/viewport.js';
import { curveControlPoints, curveTangentRays } from './graph/curve.js';

function serializeDiagram(state) {
  const baseOrigin = QUADRANT_MODES[state.quadrantMode].origin;
  const origin = baseOrigin === 'center' ? 'center' : `${state.flipY ? 'top' : 'bottom'}-${baseOrigin.endsWith('center') ? 'center' : state.flipX ? 'right' : 'left'}`;
  return {
    objectOrder: [...state.objectOrder],
    groups: state.groups.map(({ id, name, parentId }) => ({ id, type: 'group', name, parentId })),
    points: state.points.map((point) => ({
      id: point.id, type: 'point', name: point.name, color: point.color, parentId: point.parentId,
      anchor: { ...point.anchor }, showCoordinates: Boolean(point.showCoordinates),
    })),
    dashedLines: state.dashedLines.map(({ id, name, color, parentId, anchor, end }) => ({
      id, type: 'dashed', name, color, parentId, anchor: { ...anchor }, end: { ...end },
    })),
    rulers: state.rulers.map(({ id, name, color, parentId, anchor, end, style, showMeasurement }) => ({
      id, type: 'ruler', name, color, parentId, anchor: { ...anchor }, end: { ...end }, style, showMeasurement,
    })),
    coordinateSystem: { origin, quadrants: [...QUADRANT_MODES[state.quadrantMode].quadrants], xPositive: state.flipX ? 'left' : 'right', yPositive: state.flipY ? 'down' : 'up', axesVisible: true, axisNames: { ...state.axisNames } },
    showGrid: state.showGrid,
    lines: state.lines.map((line) => {
      const direction = directionOf(line.slope);
      return {
        id: line.id, type: 'line', name: line.name, color: line.color, parentId: line.parentId,
        slope: line.slope, intercept: interceptOf(line), anchor: { ...line.anchor },
        vertical: line.slope === null,
        xIntercept: line.slope === null ? line.anchor.x : null,
        // a*x + b*y + c = 0 also covers vertical lines without Infinity in JSON.
        implicit: { a: -direction.y, b: direction.x, c: direction.y * line.anchor.x - direction.x * line.anchor.y },
      };
    }),
    curves: state.curves.map((curve) => ({
      id: curve.id, type: 'curve', name: curve.name, color: curve.color, variant: curve.variant, parentId: curve.parentId,
      anchor: { ...curve.anchor }, span: curve.span, slope: curve.slope, bend: curve.bend,
      geometry: {
        type: 'quadratic-bezier', controlPoints: curveControlPoints(curve),
        extensions: { type: 'tangent-rays', rays: curveTangentRays(curve) },
      },
    })),
  };
}

export function serializeDocument(state) {
  return {
    schemaVersion: 6,
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
