import { DEFAULT_AXIS_GAP, MIN_AXIS_GAP, MAX_AXIS_GAP } from './graph/display.js';
import { prepareDuplicate, DUPLICATABLE } from './duplicate.js';
import { validPoint, rulerMetrics } from './graph/ruler.js';
import { LAYOUTS, normalizeSlots } from './layouts.js';
import { normalizeSlope, directionOf } from './graph/math.js';
import { QUADRANT_MODES } from './graph/viewport.js';
import { CURVE_PRESETS, MAX_BEND } from './graph/curve.js';
import { canReparent, objectsOf } from './objects.js';
import { sumError } from './graph/sum.js';
import { validSketch, unitVector, projectOnLine, translatedSketch } from './graph/sketch.js';
import { resolveRelations, canAttach, dependencyId } from './relations.js';

const COLORS = ['#6068e8', '#e69451', '#43a999', '#cf7299', '#849353', '#699bd1'];

/** Internal mathematical coordinates; hierarchy only organizes objects. */
export function createStore() {
  const state = {
    lines: [], curves: [], sketches: [], sums: [], points: [], dashedLines: [], rulers: [], groups: [], objectOrder: [],
    selectedId: null, handSelected: true, duplicatePanel: false, sumPanel: false, sketchSelected: false, sketchMode: 'auto', activeTool: 'point', mouseSelected: false, rulerSelected: false, dashedSelected: false, dashedMode: 'free', dashedSnap: true, pointSnap: true, pointCoordinates: false, showGrid: true,
    quadrantMode: 'first', axisNames: { x: 'x', y: 'y' }, axisGapEnabled: false, axisGap: DEFAULT_AXIS_GAP,
  };
  let nextId = 1, nextCurveId = 1, nextPointId = 1, nextGroupId = 1, nextRulerId = 1, nextDashedId = 1;
  let nextSumId = 1;
  let nextSketchId = 1;
  const listeners = new Set();
  const documentKeys = ['lines', 'curves', 'sketches', 'sums', 'points', 'dashedLines', 'rulers', 'groups', 'objectOrder', 'quadrantMode', 'axisNames', 'showGrid', 'axisGapEnabled', 'axisGap'];
  const emptyDocument = () => ({ lines: [], curves: [], sketches: [], sums: [], points: [], dashedLines: [], rulers: [], groups: [], objectOrder: [], quadrantMode: 'first', axisNames: { x: 'x', y: 'y' }, axisGapEnabled: false, axisGap: DEFAULT_AXIS_GAP, showGrid: true });
  let diagrams = [{ id: 'diagram-1', name: '그래프 1', flipX: false, flipY: false, ...emptyDocument() }];
  let activeDiagramId = 'diagram-1';
  let layout = { preset: 'single', slots: structuredClone(LAYOUTS.single.slots) };
  let nextDiagramId = 2;
  const syncDiagram = () => Object.assign(diagrams.find(d => d.id === activeDiagramId), Object.fromEntries(documentKeys.map(key => [key, state[key]])));
  const loadDiagram = () => {
    const diagram = diagrams.find(d => d.id === activeDiagramId);
    for (const key of documentKeys) state[key] = diagram[key];
    state.selectedId = null;
  };
  const documentState = () => {
    syncDiagram();
    return {
      document: structuredClone({ layout, diagrams: diagrams.map(diagram => ({
        ...diagram,
        ...Object.fromEntries(['lines', 'curves', 'sketches', 'sums', 'points', 'dashedLines', 'rulers', 'groups'].map(key => [key, diagram[key].map(({ collapsed, ...object }) => object)])),
      })) }),
      activeDiagramId, selectedId: state.selectedId,
    };
  };
  const different = (a, b) => JSON.stringify(a.document) !== JSON.stringify(b.document);
  let baseline = documentState(), transaction = null, restoring = false, historyRevision = 0;
  const past = [], future = [];
  const remember = (entry) => { past.push(entry); if (past.length > 100) past.shift(); };
  const pendingChange = () => transaction && different(transaction, documentState());
  const snapshot = () => {
    syncDiagram();
    const active = diagrams.find(d => d.id === activeDiagramId);
    return {
      ...structuredClone(state), diagrams: structuredClone(diagrams), layout: structuredClone(layout),
      activeDiagramId, flipX: active.flipX, flipY: active.flipY,
      canUndo: past.length > 0 || Boolean(pendingChange()), canRedo: future.length > 0 && !pendingChange(), historyRevision,
    };
  };
  const emit = () => {
    resolveRelations(state);
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
    syncDiagram();
    const folds = new Map(diagrams.flatMap(d => objectsOf(d)).map(({ id, collapsed }) => [id, collapsed]));
    ({ diagrams, layout } = structuredClone(entry.document));
    activeDiagramId = entry.activeDiagramId;
    for (const diagram of diagrams) for (const object of objectsOf(diagram)) object.collapsed = folds.get(object.id) ?? false;
    loadDiagram();
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
    if (['line', 'curve', 'sketch', 'sum'].includes(object.type)) { state.mouseSelected = false; state.rulerSelected = false; state.dashedSelected = false; state.handSelected = true; state.duplicatePanel = false; state.sketchSelected = false; state.sumPanel=false; }
    emit();
    return object.id;
  };
  return {
    getState: snapshot,
    selectDiagram(id) {
      if (id === activeDiagramId || !diagrams.slice(0, layout.slots.length).some(d => d.id === id)) return;
      if (state.sumPanel || state.duplicatePanel) {state.sumPanel=false;state.duplicatePanel=false;state.handSelected=true;}
      endHistory(); syncDiagram(); activeDiagramId = id; loadDiagram(); historyRevision++; emit();
    },
    configureLayout(preset, customSlots, quadrantMode, { allQuadrants = true, preserveDirections = false } = {}) {
      const slots = normalizeSlots(preset === 'custom' ? customSlots : LAYOUTS[preset]?.slots);
      if (!slots) return false;
      endHistory(); syncDiagram();
      while (diagrams.length < slots.length) {
        const index = nextDiagramId++;
        diagrams.push({ id: `diagram-${index}`, name: `그래프 ${index}`, flipX: false, flipY: false, ...emptyDocument() });
      }
      layout = { preset, slots };
      if (!diagrams.slice(0, slots.length).some(d => d.id === activeDiagramId)) activeDiagramId = diagrams[0].id;
      slots.forEach((slot, index) => {
        if (!preserveDirections) { diagrams[index].flipX = slot.flipX; diagrams[index].flipY = slot.flipY; }
        if ((allQuadrants || diagrams[index].id === activeDiagramId) && Object.hasOwn(QUADRANT_MODES, quadrantMode)) diagrams[index].quadrantMode = quadrantMode;
      });
      loadDiagram(); historyRevision++; emit();
      return true;
    },
    updateDiagram(patch) {
      const diagram = diagrams.find(d => d.id === activeDiagramId);
      if (typeof patch.name === 'string') diagram.name = patch.name.slice(0, 80);
      for (const axis of ['flipX', 'flipY']) if (typeof patch[axis] === 'boolean') diagram[axis] = patch[axis];
      emit();
    },
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
      for (const key of ['lines', 'curves', 'sketches', 'sums', 'points', 'dashedLines', 'rulers', 'groups', 'objectOrder']) state[key] = [];
      state.selectedId = null;
      historyRevision++;
      emit();
      return true;
    },
    update(patch) {
      if (patch.handSelected || patch.mouseSelected || patch.dashedSelected || patch.duplicatePanel || patch.sketchSelected) state.sumPanel=false;
      if (['auto','horizontal','vertical'].includes(patch.sketchMode)) state.sketchMode=patch.sketchMode;
      if (typeof patch.axisGapEnabled === 'boolean') state.axisGapEnabled = patch.axisGapEnabled;
      if (Number.isFinite(patch.axisGap)) state.axisGap = Math.max(MIN_AXIS_GAP, Math.min(MAX_AXIS_GAP, patch.axisGap));
      if (typeof patch.showGrid === 'boolean') state.showGrid = patch.showGrid;
      if (typeof patch.pointSnap === 'boolean') state.pointSnap = patch.pointSnap;
      if (typeof patch.pointCoordinates === 'boolean') state.pointCoordinates = patch.pointCoordinates;
      if (typeof patch.mouseSelected === 'boolean') {
        state.mouseSelected = patch.mouseSelected;
        // Switching to the point tool ends the previous line/curve selection.
        if (patch.mouseSelected) { state.rulerSelected = false; state.dashedSelected = false; state.handSelected = false; state.duplicatePanel = false; state.sketchSelected = false; }
        if (patch.mouseSelected && [...state.lines, ...state.curves, ...state.sketches, ...state.sums, ...state.dashedLines, ...state.rulers].some(object => object.id === state.selectedId)) state.selectedId = null;
      }
      // The ruler tool is intentionally disabled until its behavior is redesigned.
      state.rulerSelected = false;
      if (typeof patch.dashedSelected === 'boolean') {
        state.dashedSelected = patch.dashedSelected;
        if (patch.dashedSelected) {
          state.mouseSelected = false; state.handSelected = false; state.duplicatePanel = false; state.sketchSelected = false;
          if (!state.dashedLines.some(line => line.id === state.selectedId)) state.selectedId = null;
        }
      }
      if (typeof patch.duplicatePanel === 'boolean') {
        state.duplicatePanel = patch.duplicatePanel;
        if (patch.duplicatePanel) { state.mouseSelected = false; state.dashedSelected = false; state.handSelected = false; state.sketchSelected = false; }
      }
      if (typeof patch.sketchSelected === 'boolean') {
        state.sketchSelected=patch.sketchSelected;
        if (patch.sketchSelected) { state.handSelected=false; state.mouseSelected=false; state.dashedSelected=false; state.duplicatePanel=false; state.selectedId=null; }
      }
      if (typeof patch.sumPanel==='boolean') {
        state.sumPanel=patch.sumPanel;
        if (patch.sumPanel) {state.handSelected=false;state.mouseSelected=false;state.dashedSelected=false;state.duplicatePanel=false;state.sketchSelected=false;}
      }
      if (patch.handSelected === true) {
        state.handSelected = true; state.mouseSelected = false; state.dashedSelected = false; state.duplicatePanel = false; state.sketchSelected = false;
      }
      if (!state.mouseSelected && !state.dashedSelected && !state.duplicatePanel && !state.sketchSelected && !state.sumPanel) state.handSelected = true;
      if (typeof patch.dashedSnap === 'boolean') state.dashedSnap = patch.dashedSnap;
      if (['free', 'horizontal', 'vertical'].includes(patch.dashedMode)) state.dashedMode = patch.dashedMode;
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
      const variant = Object.hasOwn(CURVE_PRESETS,placement.variant) ? placement.variant : index % 2 === 1 ? 'descending' : 'ascending';
      const preset = CURVE_PRESETS[variant];
      return add('curves', {
        id: `curve-${index}`, type: 'curve', name: `곡선 ${String(index).padStart(2, '0')}`,
        variant, slope: preset.slope, color: preset.color,
        span: Number.isFinite(placement.span) && placement.span > 0 ? placement.span : 3, bend: 0.25,
        anchor: Number.isFinite(placement.anchor?.x) && Number.isFinite(placement.anchor?.y)
          ? { ...placement.anchor } : { x: state.quadrantMode === 'first' ? 4 : 0, y: state.quadrantMode === 'all' ? 0 : 4 },
      });
    },
    addSketch(start, end, anchor, { lineId=null, tangent=null, mode=state.sketchMode } = {}) {
      if (![start,end,anchor].every(validPoint)) return null;
      const target=state.lines.find(line=>line.id===lineId);
      const projection=target ? projectOnLine(anchor,target) : null;
      const curve={ start:{...start}, end:{...end}, anchor:projection?.point ?? {...anchor},
        tangent:unitVector(tangent ?? (mode==='horizontal' ? {x:1,y:0} : mode==='vertical' ? {x:0,y:1} : {x:end.x-start.x,y:end.y-start.y})), leftReach:0.5, rightReach:0.5 };
      if (!validSketch(curve)) return null;
      const index=nextSketchId++;
      return add('sketches',{...curve,id:`sketch-${index}`,type:'sketch',name:`자유 곡선 ${String(index).padStart(2,'0')}`,color:'#4c8e9a',
        binding:target ? {kind:'tangent',sourceId:target.id,parameter:projection.parameter,direction:directionOf(target.slope)}:null });
    },
    attachSelectedToLine(lineId) {
      const curve=state.sketches.find(curve=>curve.id===state.selectedId), line=state.lines.find(line=>line.id===lineId);
      if (!curve || !line || !canAttach(state,curve.id,line.id)) return false;
      const projection=projectOnLine(curve.anchor,line);
      if (!validSketch({...curve,anchor:projection.point})) return false;
      curve.binding={kind:'tangent',sourceId:line.id,parameter:projection.parameter,direction:directionOf(line.slope)}; emit(); return true;
    },
    detachSelected() {
      const object=objectsOf(state).find(object=>object.id===state.selectedId);
      if (!object?.binding) return false;
      object.binding=null; emit(); return true;
    },
    markMinimum() {
      const source=state.sketches.find(curve=>curve.id===state.selectedId);
      if (!source) return null;
      const index=nextPointId++;
      return add('points',{id:`point-${index}`,type:'point',name:`최저점 ${index}`,color:'#59627a',anchor:{...source.anchor},showCoordinates:true,binding:{kind:'minimum',sourceId:source.id}});
    },
    lineThroughSelectedPoint({follow=true,slope=1}={}) {
      const point=state.points.find(point=>point.id===state.selectedId);
      if (!point) return null;
      const index=nextId++;
      return add('lines',{id:`line-${index}`,type:'line',name:`통과 직선 ${index}`,color:COLORS[(index-1)%COLORS.length],anchor:{...point.anchor},slope:normalizeSlope(slope),binding:follow ? {kind:'through-point',sourceId:point.id}:null});
    },
    addSum(sourceIds, { direction = 'vertical', nonnegative = true } = {}) {
      if (!Array.isArray(sourceIds) || new Set(sourceIds).size !== sourceIds.length) return null;
      const sources = sourceIds.map(id => [...state.lines, ...state.curves].find(source => source.id === id));
      if (sumError(sources, direction)) return null;
      endHistory();
      const index = nextSumId++;
      return add('sums', { id: `sum-${index}`, type: 'sum', name: `${direction === 'vertical' ? '수직합' : '수평합'} ${String(index).padStart(2, '0')}`,
        direction, nonnegative: Boolean(nonnegative), sourceIds: [...sourceIds], color: ['#b67836', '#9b5eb5', '#257f96', '#ad5265'][(index - 1) % 4] });
    },
    addPoint(anchor) {
      if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) return null;
      const index = nextPointId++;
      return add('points', {
        id: `point-${index}`, type: 'point', name: `점 ${String(index).padStart(2, '0')}`,
        color: '#59627a', anchor: { x: anchor.x === 0 ? 0 : anchor.x, y: anchor.y === 0 ? 0 : anchor.y },
        showCoordinates: state.pointCoordinates,
      });
    },
    addDashedLine(anchor, end) {
      if (!validPoint(anchor) || !validPoint(end)) return null;
      const length = rulerMetrics({ anchor, end }).length;
      if (!Number.isFinite(length) || length < 1e-8) return null;
      const index = nextDashedId++;
      return add('dashedLines', { id: `dashed-${index}`, type: 'dashed', name: `점선 ${String(index).padStart(2, '0')}`,
        anchor: { ...anchor }, end: { ...end }, color: '#7b879c' });
    },
    addRuler(anchor, end) {
      if (!validPoint(anchor) || !validPoint(end)) return null;
      const length = rulerMetrics({ anchor, end }).length;
      if (!Number.isFinite(length) || length < 1e-8) return null;
      const index = nextRulerId++;
      return add('rulers', { id: `ruler-${index}`, type: 'ruler', name: `자 ${String(index).padStart(2, '0')}`,
        anchor: { ...anchor }, end: { ...end }, color: '#7b879c', style: 'solid', showMeasurement: true });
    },
    addGroup() {
      const index = nextGroupId++;
      return add('groups', { id: `group-${index}`, type: 'group', name: `폴더 ${String(index).padStart(2, '0')}`, color: '#949aab' });
    },
    selectObject(id) {
      const object = objectsOf(state).find(item => item.id === id);
      if (id === null || object) {
        if (object && !state.duplicatePanel) { state.handSelected = true; state.mouseSelected = false; state.dashedSelected = false; state.sketchSelected=false; state.sumPanel=false; }
        state.selectedId = id;
        emit();
      }
    },
    duplicateSelected(options = {}) {
      const source = objectsOf(state).find(object => object.id === state.selectedId);
      const prepared = prepareDuplicate(source, options);
      if (prepared.error) return null;
      const originals = objectsOf(state);
      const selected = new Set([source.id]);
      if (options.includeChildren !== false) {
        let changed = true;
        while (changed) {
          changed = false;
          for (const object of originals) if (!selected.has(object.id) && selected.has(object.parentId) && DUPLICATABLE.includes(object.type)) { selected.add(object.id); changed = true; }
        }
      }
      const copies = originals.filter(object => selected.has(object.id)).map(object => {
        if (object.id === source.id) return prepared.object;
        return prepareDuplicate(object, { placement: options.placement ?? 'same' }).object;
      });
      if (copies.some(object => !object)) return null;
      endHistory();
      const names = new Set(originals.map(object => object.name));
      for (const object of copies) {
        const base = object.name;
        let index = 2;
        while (names.has(object.name)) {
          const suffix = ` ${index++}`;
          object.name = `${base.slice(0, 80 - suffix.length)}${suffix}`;
        }
        names.add(object.name);
      }
      const ids = new Map();
      const collections = { line: 'lines', curve: 'curves', sketch: 'sketches', point: 'points', dashed: 'dashedLines', group: 'groups' };
      for (const object of copies) {
        const previous = object.id;
        object.id = object.type === 'line' ? `line-${nextId++}` : object.type === 'curve' ? `curve-${nextCurveId++}` : object.type === 'sketch' ? `sketch-${nextSketchId++}` : object.type === 'point' ? `point-${nextPointId++}` : object.type === 'dashed' ? `dashed-${nextDashedId++}` : `group-${nextGroupId++}`;
        ids.set(previous, object.id);
      }
      for (const object of copies) {
        object.parentId = ids.get(object.parentId) ?? object.parentId;
        state[collections[object.type]].push(object); state.objectOrder.push(object.id);
      }
      state.selectedId = ids.get(source.id);
      historyRevision++;
      emit();
      return state.selectedId;
    },
    updateSelected(patch) {
      const object = objectsOf(state).find((item) => item.id === state.selectedId);
      if (!object) return;
      if (typeof patch.name === 'string') object.name = patch.name.slice(0, 80);
      if (object.type==='sketch') {
        const next=structuredClone(object);
        if (validPoint(patch.anchor)) {
          const desired=object.binding && patch.translate ? projectOnLine(patch.anchor,state.lines.find(line=>line.id===object.binding.sourceId)).point : patch.anchor;
          if (patch.translate) Object.assign(next,translatedSketch(object,{x:desired.x-object.anchor.x,y:desired.y-object.anchor.y}));
          else next.anchor={...patch.anchor};
        }
        for (const key of ['start','end']) if (validPoint(patch[key])) next[key]={...patch[key]};
        if (validPoint(patch.tangent) && !object.binding) next.tangent=unitVector(patch.tangent);
        for (const key of ['leftReach','rightReach']) if (Number.isFinite(patch[key])) next[key]=Math.max(0.05,Math.min(2,patch[key]));
        if (next.binding && validPoint(patch.anchor)) {
          const line=state.lines.find(line=>line.id===next.binding.sourceId);
          const projection=projectOnLine(next.anchor,line);
          next.anchor=projection.point; next.binding.parameter=projection.parameter;next.binding.direction=directionOf(line.slope);
        }
        if (validSketch(next)) Object.assign(object,next);
      }
      if (object.type === 'sum' && typeof patch.nonnegative === 'boolean') object.nonnegative = patch.nonnegative;
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
      }
      if (object.type === 'ruler' || object.type === 'dashed') {
        const anchor = validPoint(patch.anchor) ? patch.anchor : object.anchor;
        const end = validPoint(patch.end) ? patch.end : object.end;
        const length = rulerMetrics({ anchor, end }).length;
        if (Number.isFinite(length) && length >= 1e-8) { object.anchor = { ...anchor }; object.end = { ...end }; }
        if (object.type === 'ruler' && ['solid', 'dashed'].includes(patch.style)) object.style = patch.style;
        if (object.type === 'ruler' && typeof patch.showMeasurement === 'boolean') object.showMeasurement = patch.showMeasurement;
      }
      if (!['group', 'ruler', 'dashed', 'sum', 'sketch'].includes(object.type) && Number.isFinite(patch.anchor?.x) && Number.isFinite(patch.anchor?.y)) {
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
      const deleted = new Set([removed.id, ...state.sums.filter(sum => sum.sourceIds.includes(removed.id)).map(sum => sum.id)]);
      // Freeze the current geometry when its relation source is deleted.
      for (const object of objectsOf(state)) if (deleted.has(dependencyId(object))) object.binding=null;
      // Retain children of both the deleted source and its dependent sums.
      const byId = new Map(objectsOf(state).map(object => [object.id, object]));
      const survivingParent = id => {
        while (deleted.has(id)) id = byId.get(id)?.parentId ?? null;
        return id;
      };
      for (const object of byId.values()) object.parentId = survivingParent(object.parentId);
      for (const collection of ['lines', 'curves', 'sketches', 'sums', 'points', 'dashedLines', 'rulers', 'groups']) state[collection] = state[collection].filter((item) => !deleted.has(item.id));
      state.objectOrder = state.objectOrder.filter((id) => !deleted.has(id));
      state.selectedId = survivingParent(removed.parentId) ?? state.objectOrder.at(-1) ?? null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
