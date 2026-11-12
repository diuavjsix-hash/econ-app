import { objectModel } from './models/objects.js';
import { OBJECT_TYPES, OBJECT_COLLECTIONS } from './models/object-types.js';
import { TOOL_MODES, toolModeFlags, toolModeOf, requestedToolMode, isOperationMode } from './tool-modes.js';
import { DEFAULT_AXIS_GAP, MIN_AXIS_GAP, MAX_AXIS_GAP } from './graph/display.js';
import { prepareDuplicate, DUPLICATABLE, placeCopiesNearby } from './duplicate.js';
import { validPoint, rulerMetrics } from './graph/ruler.js';
import { LAYOUTS, normalizeSlots } from './layouts.js';
import { normalizeSlope, directionOf } from './graph/math.js';
import { LINE_KINDS, LINE_STYLES, lineFromPoints, lineKindOf } from './graph/line-extent.js';
import { QUADRANT_MODES, clampZoom } from './graph/viewport.js';
import { CURVE_PRESETS } from './graph/curve.js';
import { canReparent, objectsOf } from './objects.js';
import { sumError } from './graph/sum.js';
import { validSketch, unitVector, projectOnLine } from './graph/sketch.js';
import { resolveRelations, canAttach, dependencyId } from './relations.js';
import { INDIFFERENCE_FAMILIES } from './graph/indifference.js';
import { orientCurve, supportsOpposite } from './models/curve-families.js';
import { followBoxOrigin, defaultOppositeOrigin } from './graph/axes.js';
import { validFill, fillKey } from './graph/fill.js';
import { nextFillColor, nextFillLabel } from './graph/fill-style.js';

import { INK, ROLE_COLORS, lineColor, sumColor } from './models/palette.js';
import { LINK_AXES, alignedPartners, isLinkAxis, linkedDiagramIds, sourceExtent, syncLinks } from './links.js';


/** Internal mathematical coordinates; hierarchy only organizes objects. */
export function createStore() {
  const state = {
    selectedIds: [],
    ...Object.fromEntries(OBJECT_COLLECTIONS.map(collection => [collection, []])), objectOrder: [],
    ...toolModeFlags('hand'), fillColor: INK.blue, fillAutoColor: true, fillOpacity: 0.24,
    selectedId: null, indifferenceOpposite: false, sketchMode: 'auto', activeTool: 'point', rulerSelected: false, segmentSnap: true, lineKind: 'line', lineStyle: 'solid', pointSnap: true, pointCoordinates: false, showGrid: true,
    quadrantMode: 'first', axisNames: { x: 'x', y: 'y' }, boxSize: { width: 10, height: 8 }, boxAxisNames: { x: 'xᴮ', y: 'yᴮ' }, faceAxisName: 'x′', axisGapEnabled: false, axisGap: DEFAULT_AXIS_GAP,
  };
  let nextId = 1, nextCurveId = 1, nextPointId = 1, nextGroupId = 1, nextRulerId = 1;
  let nextSumId = 1;
  let nextSketchId = 1;
  let nextFillId = 1;
  const listeners = new Set();
  const setSelection = ids => {
    const requested=new Set(ids);
    state.selectedIds=objectsOf(state).filter(object=>requested.has(object.id)).map(object=>object.id);
    state.selectedId=state.selectedIds.length===1?state.selectedIds[0]:null;
  };
  // The only writer of tool-mode flags; each mode's selection rule lives in TOOL_MODES.
  const enterToolMode = mode => {
    const spec = TOOL_MODES[mode], selected = new Set(state.selectedIds);
    Object.assign(state, toolModeFlags(mode));
    spec.enter?.(state);
    if (spec.keepSelection && !spec.keepSelection(objectsOf(state).filter(object => selected.has(object.id)))) setSelection([]);
  };
  // Each registered collection is part of a diagram document, its history and deletion.
  const documentKeys = [...OBJECT_COLLECTIONS, 'objectOrder', 'quadrantMode', 'axisNames', 'boxSize', 'boxAxisNames', 'faceAxisName', 'showGrid', 'axisGapEnabled', 'axisGap'];
  const emptyDocument = () => ({ ...Object.fromEntries(OBJECT_COLLECTIONS.map(collection => [collection, []])), objectOrder: [], quadrantMode: 'first', axisNames: { x: 'x', y: 'y' }, boxSize: { width: 10, height: 8 }, boxAxisNames: { x: 'xᴮ', y: 'yᴮ' }, faceAxisName: 'x′', axisGapEnabled: false, axisGap: DEFAULT_AXIS_GAP, showGrid: true });
  let diagrams = [{ id: 'diagram-1', name: '그래프 1', flipX: false, flipY: false, ...emptyDocument() }];
  let activeDiagramId = 'diagram-1';
  const zooms = new Map(); // diagram id → view zoom; kept out of documentState on purpose
  let layout = { preset: 'single', slots: structuredClone(LAYOUTS.single.slots) };
  let nextDiagramId = 2;
  let nextLinkId = 1;
  const syncDiagram = () => Object.assign(diagrams.find(d => d.id === activeDiagramId), Object.fromEntries(documentKeys.map(key => [key, state[key]])));
  const loadDiagram = () => {
    const diagram = diagrams.find(d => d.id === activeDiagramId);
    for (const key of documentKeys) state[key] = diagram[key];
    setSelection([]);
  };
  const documentState = () => {
    syncDiagram();
    return {
      document: structuredClone({ layout, diagrams: diagrams.map(diagram => ({
        ...diagram,
        ...Object.fromEntries(OBJECT_COLLECTIONS.map(key => [key, diagram[key].map(({ collapsed, ...object }) => object)])),
      })) }),
      activeDiagramId, selectedId: state.selectedId, selectedIds: [...state.selectedIds],
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
      ...structuredClone(state), diagrams: structuredClone(diagrams).map(d => ({ ...d, zoom: zooms.get(d.id) ?? 1 })), layout: structuredClone(layout),
      zoom: zooms.get(activeDiagramId) ?? 1,
      fillColor: state.fillAutoColor ? nextFillColor(state.fills) : state.fillColor, fillNextLabel: nextFillLabel(state.fills),
      activeDiagramId, flipX: active.flipX, flipY: active.flipY,
      canUndo: past.length > 0 || Boolean(pendingChange()), canRedo: future.length > 0 && !pendingChange(), historyRevision,
    };
  };
  const emit = () => {
    resolveRelations(state);
    // Link lines in other graphs follow the one just edited (or the one following a point).
    syncDiagram(); syncLinks(diagrams, activeDiagramId);
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
    setSelection(entry.selectedIds ?? (entry.selectedId?[entry.selectedId]:[]));
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
    // Every creation ends in the selection tool with the new object selected,
    // so it can be moved or edited at once. Tools never stay armed after one result.
    enterToolMode('hand');
    setSelection([object.id]);
    emit();
    return object.id;
  };
  /** View zoom of one graph: not part of the document, its history or the JSON. */
  // Graphs joined by a link share one zoom, so the linked coordinate stays lined up on screen.
  const setDiagramZoom = (id, zoom) => {
    const next = clampZoom(zoom);
    if (!diagrams.some(d => d.id === id) || next === (zooms.get(id) ?? 1)) return;
    for (const linked of linkedDiagramIds(diagrams, id)) zooms.set(linked, next);
    emit();
  };
  return {
    getState: snapshot,
    setDiagramZoom,
    setZoom(zoom) { setDiagramZoom(activeDiagramId, zoom); },
    selectDiagram(id) {
      if (id === activeDiagramId || !diagrams.slice(0, layout.slots.length).some(d => d.id === id)) return;
      if (isOperationMode(state)) enterToolMode('hand');
      endHistory(); syncDiagram(); activeDiagramId = id; loadDiagram(); historyRevision++; emit();
    },
    configureLayout(preset, customSlots, quadrantMode, { allQuadrants = true, preserveDirections = false, boxSize = null } = {}) {
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
        if (quadrantMode==='edgeworth' && (allQuadrants || diagrams[index].id===activeDiagramId)) {
          const previous={...diagrams[index].boxSize};
          for (const key of ['width','height']) if (Number.isFinite(boxSize?.[key]) && boxSize[key]>=1 && boxSize[key]<=100) diagrams[index].boxSize[key]=boxSize[key];
          followBoxOrigin(diagrams[index],previous);
        }
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
      for (const key of [...OBJECT_COLLECTIONS, 'objectOrder']) state[key] = [];
      setSelection([]);
      historyRevision++;
      emit();
      return true;
    },
    update(patch) {
      const mode = requestedToolMode(patch, toolModeOf(state));
      if (mode) enterToolMode(mode);
      if (typeof patch.fillColor === 'string' && /^#[0-9a-f]{6}$/i.test(patch.fillColor)) { state.fillColor = patch.fillColor; state.fillAutoColor = false; }
      if (Number.isFinite(patch.fillOpacity)) state.fillOpacity = Math.max(0.1, Math.min(0.6, patch.fillOpacity));
      if (['auto','horizontal','vertical'].includes(patch.sketchMode)) state.sketchMode=patch.sketchMode;
      if (typeof patch.axisGapEnabled === 'boolean') state.axisGapEnabled = patch.axisGapEnabled;
      if (Number.isFinite(patch.axisGap)) state.axisGap = Math.max(MIN_AXIS_GAP, Math.min(MAX_AXIS_GAP, patch.axisGap));
      if (typeof patch.showGrid === 'boolean') state.showGrid = patch.showGrid;
      if (typeof patch.pointSnap === 'boolean') state.pointSnap = patch.pointSnap;
      if (typeof patch.pointCoordinates === 'boolean') state.pointCoordinates = patch.pointCoordinates;
      // The ruler tool is intentionally disabled until its behavior is redesigned.
      state.rulerSelected = false;
      if (typeof patch.segmentSnap === 'boolean') state.segmentSnap = patch.segmentSnap;
      if (LINE_KINDS.includes(patch.lineKind)) state.lineKind = patch.lineKind;
      if (LINE_STYLES.includes(patch.lineStyle)) state.lineStyle = patch.lineStyle;
      if (Object.hasOwn(QUADRANT_MODES, patch.quadrantMode)) state.quadrantMode = patch.quadrantMode;
      if (['select', 'point'].includes(patch.activeTool)) state.activeTool = patch.activeTool;
      for (const axis of ['x', 'y']) {
        if (typeof patch.axisNames?.[axis] === 'string') state.axisNames[axis] = patch.axisNames[axis].slice(0, 80);
        if (typeof patch.boxAxisNames?.[axis] === 'string') state.boxAxisNames[axis] = patch.boxAxisNames[axis].slice(0, 80);
      }
      if (typeof patch.faceAxisName === 'string') state.faceAxisName = patch.faceAxisName.slice(0, 80);
      const previousBox={...state.boxSize};
      for (const key of ['width','height']) if (Number.isFinite(patch.boxSize?.[key]) && patch.boxSize[key]>=1 && patch.boxSize[key]<=100) state.boxSize[key]=patch.boxSize[key];
      followBoxOrigin(state,previousBox);
      if (typeof patch.indifferenceOpposite === 'boolean') state.indifferenceOpposite = patch.indifferenceOpposite;
      emit();
    },
    setToolMode(mode) {
      if (!Object.hasOwn(TOOL_MODES, mode)) return false;
      enterToolMode(mode); emit(); return true;
    },
    /** Tool buttons toggle their mode; leaving any mode returns to selection. */
    toggleToolMode(mode) {
      return this.setToolMode(toolModeOf(state) === mode ? 'hand' : mode);
    },
    /**
     * Without points: the default line of earlier versions. With two points: the line
     * tool's result, anchored at the first point, as a line, ray or segment.
     */
    addLine(from, to, { kind = state.lineKind, style = state.lineStyle } = {}) {
      if (from !== undefined || to !== undefined) {
        if (!validPoint(from) || !validPoint(to)) return null;
        const geometry = lineFromPoints(from, to, LINE_KINDS.includes(kind) ? kind : 'line');
        if (!geometry) return null;
        const index = nextId - 1, label = { line: '직선', ray: '반직선', segment: '선분' }[lineKindOf(geometry)];
        const line = { id: `line-${nextId}`, type: 'line', name: `${label} ${String(nextId++).padStart(2, '0')}`,
          anchor: geometry.anchor, slope: geometry.slope, color: lineColor(index, style) };
        if (geometry.extent) line.extent = geometry.extent;
        if (style === 'dashed') line.style = 'dashed';
        return add('lines', line);
      }
      const index = nextId - 1;
      const box = state.quadrantMode === 'edgeworth' ? state.boxSize : null;
      return add('lines', {
        id: `line-${nextId}`, type: 'line', name: `직선 ${String(nextId++).padStart(2, '0')}`,
        slope: [1, -1, 0.5, -0.5, 0, 2][(box ? state.lines.length : index) % 6] * (box ? box.height / box.width : 1),
        anchor: box ? { x: box.width / 2, y: box.height / 2 } : { x: state.quadrantMode === 'first' ? 3 : 0, y: (state.quadrantMode === 'all' ? 0 : 3) + (index % 5) * 0.6 }, color: lineColor(index, 'solid'),
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
    addIndifference(family, placement={}) {
      if (!Object.hasOwn(INDIFFERENCE_FAMILIES,family)) return null;
      const index=nextCurveId++,preset=INDIFFERENCE_FAMILIES[family];
      const anchor=validPoint(placement.anchor)?{x:Math.max(0.1,placement.anchor.x),y:Math.max(0.1,placement.anchor.y)}:{x:3,y:3};
      const curve={id:`curve-${index}`,type:'curve',family,name:`${preset.label} ${String(index).padStart(2,'0')}`,color:preset.color,anchor,shape:1,linearAxis:'y'};
      // A mirrored curve is drawn from the opposite origin; its own coordinates set the default shape.
      const opposite=Boolean(placement.opposite)&&supportsOpposite(curve)&&orientCurve(curve,true,validPoint(placement.oppositeOrigin)?placement.oppositeOrigin:defaultOppositeOrigin(state,anchor));
      const ownX=opposite?curve.oppositeOrigin.x-anchor.x:anchor.x;
      if (family==='quasilinear') curve.shape=Math.max(0.2,Math.min(20,ownX*0.7));
      return add('curves',curve);
    },
    addSketch(start, end, anchor, { lineId=null, tangent=null, mode=state.sketchMode } = {}) {
      if (![start,end,anchor].every(validPoint)) return null;
      const target=state.lines.find(line=>line.id===lineId);
      const projection=target ? projectOnLine(anchor,target) : null;
      const curve={ start:{...start}, end:{...end}, anchor:projection?.point ?? {...anchor},
        tangent:unitVector(tangent ?? (mode==='horizontal' ? {x:1,y:0} : mode==='vertical' ? {x:0,y:1} : {x:end.x-start.x,y:end.y-start.y})), leftReach:0.5, rightReach:0.5 };
      if (!validSketch(curve)) return null;
      const index=nextSketchId++;
      return add('sketches',{...curve,id:`sketch-${index}`,type:'sketch',name:`자유 곡선 ${String(index).padStart(2,'0')}`,color:ROLE_COLORS.sketch,
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
      source.showMinimum = true; emit(); return source.id;
    },
    lineThroughSelectedPoint({follow=true,slope=1}={}) {
      const point=state.points.find(point=>point.id===state.selectedId);
      if (!point) return null;
      const index=nextId++;
      return add('lines',{id:`line-${index}`,type:'line',name:`통과 직선 ${index}`,color:lineColor(index-1,'solid'),anchor:{...point.anchor},slope:normalizeSlope(slope),binding:follow ? {kind:'through-point',sourceId:point.id}:null});
    },
    /** Graphs a link from the selected point would reach (same column for 'x', same row for 'y'). */
    linkPartners(axis) {
      syncDiagram();
      return alignedPartners(layout, diagrams, activeDiagramId, axis).map(({ diagram }) => diagram.id);
    },
    /**
     * A vertical ('x') or horizontal ('y') link through the selected point: a line here that
     * reaches toward the partner graphs, and a full line at the same coordinate in each of them.
     */
    linkThroughSelectedPoint({ axis = 'x', follow = true } = {}) {
      const point = state.points.find(point => point.id === state.selectedId);
      if (!point || !isLinkAxis(axis)) return null;
      syncDiagram();
      const partners = alignedPartners(layout, diagrams, activeDiagramId, axis);
      if (!partners.length) return null;
      endHistory();
      const index = nextLinkId++, link = { id: `link-${index}`, axis }, name = `${LINK_AXES[axis].label} ${String(index).padStart(2, '0')}`;
      const slope = LINK_AXES[axis].slope, zoom = zooms.get(activeDiagramId) ?? 1;
      const source = { diagram: diagrams.find(d => d.id === activeDiagramId), slot: layout.slots[diagrams.findIndex(d => d.id === activeDiagramId)] };
      for (const { diagram } of partners) {
        const anchor = axis === 'x' ? { x: point.anchor.x, y: 0 } : { x: 0, y: point.anchor.y };
        const line = { id: `line-${nextId++}`, type: 'line', name, color: ROLE_COLORS.dashedLine, anchor, slope, style: 'dashed', link: { ...link }, parentId: null, collapsed: false };
        diagram.lines.push(line); diagram.objectOrder.push(line.id);
        zooms.set(diagram.id, zoom);
      }
      const extent = sourceExtent(source, partners, axis);
      return add('lines', { id: `line-${nextId++}`, type: 'line', name, color: ROLE_COLORS.dashedLine, anchor: { ...point.anchor }, slope, style: 'dashed',
        ...(extent ? { extent } : {}), link, binding: follow ? { kind: 'through-point', sourceId: point.id } : null });
    },
    addSum(sourceIds, { direction = 'vertical', nonnegative = true } = {}) {
      if (!Array.isArray(sourceIds) || new Set(sourceIds).size !== sourceIds.length) return null;
      const sources = sourceIds.map(id => [...state.lines, ...state.curves].find(source => source.id === id));
      if (sumError(sources, direction)) return null;
      endHistory();
      const index = nextSumId++;
      return add('sums', { id: `sum-${index}`, type: 'sum', name: `${direction === 'vertical' ? '수직합' : '수평합'} ${String(index).padStart(2, '0')}`,
        direction, nonnegative: Boolean(nonnegative), sourceIds: [...sourceIds], color: sumColor(index - 1) });
    },
    addPoint(anchor) {
      if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) return null;
      const index = nextPointId++;
      return add('points', {
        id: `point-${index}`, type: 'point', name: `점 ${String(index).padStart(2, '0')}`,
        color: ROLE_COLORS.point, anchor: { x: anchor.x === 0 ? 0 : anchor.x, y: anchor.y === 0 ? 0 : anchor.y },
        showCoordinates: state.pointCoordinates,
      });
    },
    addRuler(anchor, end) {
      if (!validPoint(anchor) || !validPoint(end)) return null;
      const length = rulerMetrics({ anchor, end }).length;
      if (!Number.isFinite(length) || length < 1e-8) return null;
      const index = nextRulerId++;
      return add('rulers', { id: `ruler-${index}`, type: 'ruler', name: `자 ${String(index).padStart(2, '0')}`,
        anchor: { ...anchor }, end: { ...end }, color: ROLE_COLORS.ruler, style: 'solid', showMeasurement: true });
    },
    addGroup() {
      const index = nextGroupId++;
      return add('groups', { id: `group-${index}`, type: 'group', name: `폴더 ${String(index).padStart(2, '0')}`, color: ROLE_COLORS.group });
    },
    addFill(region) {
      if (!validFill(region)) return null;
      const key = fillKey(region), existing = state.fills.find(fill => fillKey(fill) === key);
      if (existing) {
        if (!state.fillAutoColor) existing.color = state.fillColor;
        existing.opacity = state.fillOpacity;
        state.fillAutoColor = true;
        enterToolMode('hand'); setSelection([existing.id]); emit(); return existing.id;
      }
      const index = nextFillId++;
      const color = state.fillAutoColor ? nextFillColor(state.fills) : state.fillColor, label = nextFillLabel(state.fills);
      state.fillAutoColor = true;
      return add('fills', { id: `fill-${index}`, type: 'fill', name: `구역 ${label}`, label,
        color, opacity: state.fillOpacity, rings: structuredClone(region.rings), anchor: { ...region.rings[0][0] } });
    },
    selectObjects(ids) {
      if (!Array.isArray(ids)) return false;
      setSelection(ids);
      if (state.selectedIds.length && !state.duplicatePanel) enterToolMode('hand');
      emit();
      return true;
    },
    selectObject(id,{toggle=false}={}) {
      const object = objectsOf(state).find(item => item.id === id);
      if (id === null || object) {
        if (object && !state.duplicatePanel) enterToolMode('hand');
        setSelection(id===null?[]:toggle?(state.selectedIds.includes(id)?state.selectedIds.filter(selected=>selected!==id):[...state.selectedIds,id]):[id]);
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
      let copies = originals.filter(object => selected.has(object.id)).map(object => {
        if (object.id === source.id) return prepared.object;
        return prepareDuplicate(object).object;
      });
      if (copies.some(object => !object)) return null;
      copies=placeCopiesNearby(copies,originals,source.id);
      if (!copies) return null;
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
      for (const object of copies) {
        const previous = object.id;
        object.id = object.type === 'line' ? `line-${nextId++}` : object.type === 'curve' ? `curve-${nextCurveId++}` : object.type === 'sketch' ? `sketch-${nextSketchId++}` : object.type === 'point' ? `point-${nextPointId++}` : `group-${nextGroupId++}`;
        ids.set(previous, object.id);
      }
      for (const object of copies) {
        object.parentId = ids.get(object.parentId) ?? object.parentId;
        state[OBJECT_TYPES[object.type].collection].push(object); state.objectOrder.push(object.id);
      }
      enterToolMode('hand');
      setSelection([ids.get(source.id)]);
      historyRevision++;
      emit();
      return state.selectedId;
    },
    updateSelected(patch) {
      const object = objectsOf(state).find((item) => item.id === state.selectedId);
      if (!object) return;
      objectModel(object).applyPatch(patch, state);
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
      const selected=new Set(state.selectedIds),removed=objectsOf(state).filter(object=>selected.has(object.id));
      if (!removed.length) return false;
      endHistory();
      const deleted = new Set([...selected, ...state.sums.filter(sum => sum.sourceIds.some(id=>selected.has(id))).map(sum => sum.id)]);
      // Freeze the current geometry when its relation source is deleted.
      for (const object of objectsOf(state)) if (deleted.has(dependencyId(object))) object.binding=null;
      // Retain children of both the deleted source and its dependent sums.
      const byId = new Map(objectsOf(state).map(object => [object.id, object]));
      const survivingParent = id => {
        while (deleted.has(id)) id = byId.get(id)?.parentId ?? null;
        return id;
      };
      for (const object of byId.values()) object.parentId = survivingParent(object.parentId);
      for (const collection of OBJECT_COLLECTIONS) state[collection] = state[collection].filter((item) => !deleted.has(item.id));
      state.objectOrder = state.objectOrder.filter((id) => !deleted.has(id));
      const next=removed.length===1?(survivingParent(removed[0].parentId) ?? state.objectOrder.at(-1) ?? null):null;
      setSelection(next?[next]:[]);
      historyRevision++;
      emit();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
