import { normalizeSlope } from './graph/math.js';
import { QUADRANT_MODES } from './graph/viewport.js';
import { CURVE_PRESETS, MAX_BEND } from './graph/curve.js';
import { canReparent, objectsOf } from './objects.js';
import { DEFAULT_AXIS_GAP, MIN_AXIS_GAP, MAX_AXIS_GAP } from './graph/display.js';

const COLORS = ['#6068e8', '#e69451', '#43a999', '#cf7299', '#849353', '#699bd1'];

/** Internal mathematical coordinates; hierarchy only organizes objects. */
export function createStore() {
  let state = {
    lines: [], curves: [], points: [], groups: [], objectOrder: [],
    selectedId: null, activeTool: 'select', mouseSelected: false, pointSnap: false, pointCoordinates: false, showGrid: true,
    quadrantMode: 'first', axisNames: { x: 'x', y: 'y' }, axisGapEnabled: false, axisGap: DEFAULT_AXIS_GAP,
  };
  let nextId = 1, nextCurveId = 1, nextPointId = 1, nextGroupId = 1;
  const listeners = new Set();
  const documentState = () => ({
    document: structuredClone({
      ...Object.fromEntries(['lines', 'curves', 'points', 'groups'].map((key) => [key, state[key].map(({ collapsed, ...object }) => object)])),
      objectOrder: state.objectOrder, quadrantMode: state.quadrantMode, axisNames: state.axisNames, showGrid: state.showGrid,
      axisGapEnabled: state.axisGapEnabled, axisGap: state.axisGap,
    }),
    selectedId: state.selectedId,
  });
  const different = (a, b) => JSON.stringify(a.document) !== JSON.stringify(b.document);
  let baseline = documentState(), transaction = null, restoring = false, historyRevision = 0;
  const past = [], future = [];
  const remember = (entry) => { past.push(entry); if (past.length > 100) past.shift(); };
  const pendingChange = () => transaction && different(transaction, documentState());
  const snapshot = () => ({ ...structuredClone(state), canUndo: past.length > 0 || Boolean(pendingChange()), canRedo: future.length > 0 && !pendingChange(), historyRevision });
  const emit = () => {
    const next = documentState();
    if (!restoring && different(baseline, next)) {
      if (!transaction) remember(baseline);
      future.length = 0;
    }
    baseline = next;
    for (const listener of listeners) listener(snapshot());
  };
  const endHistory = () => {
    if (!transaction) return;
    if (pendingChange()) { remember(transaction); future.length = 0; }
    transaction = null;
    emit();
  };
  const restore = (entry) => {
    const folds = new Map(objectsOf(state).map(({ id, collapsed }) => [id, collapsed]));
    Object.assign(state, structuredClone(entry.document));
    for (const object of objectsOf(state)) object.collapsed = folds.get(object.id) ?? false;
    state.selectedId = entry.selectedId;
    historyRevision++;
    restoring = true;
    emit();
    restoring = false;
  };
  const add = (collection, object) => {
    object.parentId = null;
    object.collapsed = false;
    state[collection].push(object);
    state.objectOrder.push(object.id);
    state.selectedId = object.id;
    if (object.type === 'line' || object.type === 'curve') state.mouseSelected = false;
    emit();
    return object.id;
  };
  return {
    getState: snapshot,
    beginHistory() { if (!transaction) transaction = documentState(); },
    endHistory,
    undo() {
      endHistory();
      if (!past.length) return false;
      future.push(documentState());
      restore(past.pop());
      return true;
    },
    redo() {
      endHistory();
      if (!future.length) return false;
      remember(documentState());
      restore(future.pop());
      return true;
    },
    clearAll() {
      endHistory();
      if (!state.objectOrder.length) return false;
      for (const key of ['lines', 'curves', 'points', 'groups', 'objectOrder']) state[key] = [];
      state.selectedId = null;
      historyRevision++;
      emit();
      return true;
    },
    update(patch) {
      if (typeof patch.axisGapEnabled === 'boolean') state.axisGapEnabled = patch.axisGapEnabled;
      if (Number.isFinite(patch.axisGap)) state.axisGap = Math.max(MIN_AXIS_GAP, Math.min(MAX_AXIS_GAP, patch.axisGap));
      if (typeof patch.showGrid === 'boolean') state.showGrid = patch.showGrid;
      if (typeof patch.pointSnap === 'boolean') state.pointSnap = patch.pointSnap;
      if (typeof patch.pointCoordinates === 'boolean') state.pointCoordinates = patch.pointCoordinates;
      if (typeof patch.mouseSelected === 'boolean') state.mouseSelected = patch.mouseSelected;
      if (Object.hasOwn(QUADRANT_MODES, patch.quadrantMode)) state.quadrantMode = patch.quadrantMode;
      if (['select', 'point'].includes(patch.activeTool)) state.activeTool = patch.activeTool;
      for (const axis of ['x', 'y']) {
        if (typeof patch.axisNames?.[axis] === 'string') state.axisNames[axis] = patch.axisNames[axis].slice(0, 80);
      }
      emit();
    },
    addLine() {
      const index = nextId - 1;
      return add('lines', {
        id: `line-${nextId}`, type: 'line', name: `직선 ${String(nextId++).padStart(2, '0')}`,
        slope: [1, -1, 0.5, -0.5, 0, 2][index % 6],
        anchor: { x: state.quadrantMode === 'first' ? 3 : 0, y: (state.quadrantMode === 'all' ? 0 : 3) + (index % 5) * 0.6 }, color: COLORS[index % COLORS.length],
      });
    },
    addCurve(placement = {}) {
      const index = nextCurveId++;
      const variant = index % 2 === 1 ? 'descending' : 'ascending';
      const preset = CURVE_PRESETS[variant];
      return add('curves', {
        id: `curve-${index}`, type: 'curve', name: `곡선 ${String(index).padStart(2, '0')}`,
        variant, slope: preset.slope, color: preset.color,
        span: Number.isFinite(placement.span) && placement.span > 0 ? placement.span : 3, bend: 0.25,
        anchor: Number.isFinite(placement.anchor?.x) && Number.isFinite(placement.anchor?.y)
          ? { ...placement.anchor } : { x: state.quadrantMode === 'first' ? 4 : 0, y: state.quadrantMode === 'all' ? 0 : 4 },
      });
    },
    addPoint(anchor) {
      if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) return null;
      const index = nextPointId++;
      return add('points', {
        id: `point-${index}`, type: 'point', name: `점 ${String(index).padStart(2, '0')}`,
        color: '#59627a', anchor: { x: anchor.x === 0 ? 0 : anchor.x, y: anchor.y === 0 ? 0 : anchor.y },
        showCoordinates: state.pointCoordinates,
        guides: { horizontal: 'none', vertical: 'none', extent: 'axes' },
      });
    },
    addGroup() {
      const index = nextGroupId++;
      return add('groups', { id: `group-${index}`, type: 'group', name: `폴더 ${String(index).padStart(2, '0')}`, color: '#949aab' });
    },
    selectObject(id) {
      if (id === null || objectsOf(state).some((object) => object.id === id)) {
        state.selectedId = id;
        emit();
      }
    },
    updateSelected(patch) {
      const object = objectsOf(state).find((item) => item.id === state.selectedId);
      if (!object) return;
      if (typeof patch.name === 'string') object.name = patch.name.slice(0, 80);
      if (object.type === 'curve') {
        if (Object.hasOwn(CURVE_PRESETS, patch.variant)) {
          object.variant = patch.variant;
          object.slope = CURVE_PRESETS[patch.variant].slope;
          object.color = CURVE_PRESETS[patch.variant].color;
        }
        if (Number.isFinite(patch.bend)) object.bend = Math.max(0, Math.min(MAX_BEND, patch.bend));
      } else if (object.type === 'line' && 'slope' in patch) object.slope = normalizeSlope(patch.slope);
      if (object.type === 'point') {
        if (typeof patch.showCoordinates === 'boolean') object.showCoordinates = patch.showCoordinates;
        for (const axis of ['horizontal', 'vertical']) {
          if (['none', 'dashed', 'solid'].includes(patch.guides?.[axis])) object.guides[axis] = patch.guides[axis];
        }
        if (['axes', 'full'].includes(patch.guides?.extent)) object.guides.extent = patch.guides.extent;
      }
      if (object.type !== 'group' && Number.isFinite(patch.anchor?.x) && Number.isFinite(patch.anchor?.y)) {
        object.anchor = { x: patch.anchor.x === 0 ? 0 : patch.anchor.x, y: patch.anchor.y === 0 ? 0 : patch.anchor.y };
      }
      emit();
    },
    moveObject(id, parentId) {
      const objects = objectsOf(state);
      if (!canReparent(objects, id, parentId)) return false;
      objects.find((item) => item.id === id).parentId = parentId;
      if (parentId !== null) objects.find((item) => item.id === parentId).collapsed = false;
      emit();
      return true;
    },
    toggleCollapsed(id) {
      const object = objectsOf(state).find((item) => item.id === id);
      if (!object) return;
      object.collapsed = !object.collapsed;
      emit();
    },
    removeSelected() {
      const removed = objectsOf(state).find((item) => item.id === state.selectedId);
      if (!removed) return;
      // Retain children when their parent is deleted.
      for (const object of objectsOf(state)) if (object.parentId === removed.id) object.parentId = removed.parentId;
      for (const collection of ['lines', 'curves', 'points', 'groups']) state[collection] = state[collection].filter((item) => item.id !== removed.id);
      state.objectOrder = state.objectOrder.filter((id) => id !== removed.id);
      state.selectedId = removed.parentId ?? state.objectOrder.at(-1) ?? null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
