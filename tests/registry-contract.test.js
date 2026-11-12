import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { OBJECT_TYPES, OBJECT_COLLECTIONS } from '../src/models/object-types.js';
import { objectModel, OBJECT_MODELS, SumObject } from '../src/models/objects.js';
import { StrokeObject } from '../src/models/graph-object.js';
import { TOOL_MODES, TOOL_MODE_FLAGS, toolModeOf, toolModeFlags, requestedToolMode } from '../src/tool-modes.js';
import { editorContext } from '../src/editor-ui.js';
import { diagramState } from '../src/workspace.js';
import { serializeActive } from './fixtures/document.js';
import { createViewport } from '../src/graph/viewport.js';
import { buildSnapTargets } from '../src/graph/snap.js';
import { geometryKey } from '../src/graph/snap-context.js';
import { drawSegment, segmentEnds } from './fixtures/segments.js';

const activeFlags = state => TOOL_MODE_FLAGS.filter(flag => state[flag]);

test('every registered tool mode is exclusive, toggles back to selection and drives the inspector', () => {
  const store = createStore();
  assert.deepEqual(activeFlags(store.getState()), ['handSelected']);
  for (const [mode, spec] of Object.entries(TOOL_MODES)) {
    assert.equal(store.setToolMode(mode), true, mode);
    const state = store.getState();
    assert.deepEqual(activeFlags(state), [spec.flag], mode);
    assert.equal(toolModeOf(state), mode);
    assert.equal(state.canUndo, false, `${mode} changes no document`);
    if (mode !== 'hand') {
      assert.equal(typeof spec.context, 'function', `${mode} needs inspector text`);
      assert.equal(editorContext(state).kind, spec.kind, mode);
      store.toggleToolMode(mode);
      assert.equal(toolModeOf(store.getState()), 'hand', `${mode} toggles off`);
    }
  }
  assert.equal(store.setToolMode('missing'), false);
  assert.throws(() => toolModeFlags('missing'), /Unknown tool mode/);
});

test('legacy flag patches map to one mode with the same precedence and exit rule', () => {
  assert.equal(requestedToolMode({ lineSelected: true }, 'hand'), 'line');
  assert.equal(requestedToolMode({ mouseSelected: true, handSelected: true }, 'fill'), 'hand');
  assert.equal(requestedToolMode({ fillSelected: false }, 'fill'), 'hand');
  assert.equal(requestedToolMode({ fillSelected: false }, 'point'), null, 'closing another mode keeps the current one');
  assert.equal(requestedToolMode({ pointSnap: false }, 'point'), null);
  const store = createStore();
  store.update({ fillSelected: true, mouseSelected: true });
  assert.deepEqual(activeFlags(store.getState()), ['mouseSelected']);
});

test('each mode keeps or clears the selection through its own registered rule', () => {
  const store = createStore();
  const line = store.addLine(), point = store.addPoint({ x: 1, y: 1 }), dashed = drawSegment(store,{ x: 1, y: 2 }, { x: 3, y: 2 });
  const selectThen = (id, mode) => { store.selectObject(id); store.setToolMode(mode); return store.getState().selectedIds; };
  assert.deepEqual(selectThen(line, 'point'), []);
  assert.deepEqual(selectThen(point, 'point'), [point]);
  assert.deepEqual(selectThen(dashed, 'line'), [], 'the line tool starts without a selection');
  assert.deepEqual(selectThen(line, 'sketch'), []);
  assert.deepEqual(selectThen(line, 'duplicate'), [line]);
  store.setToolMode('hand'); store.selectObjects([line, point]); store.setToolMode('sum');
  assert.deepEqual(store.getState().selectedIds, [], 'operations start from a single source');
  store.setToolMode('fill'); assert.equal(store.getState().fillAutoColor, true);
});

test('inactive diagrams show no tool mode, including operations', () => {
  const store = createStore(); store.configureLayout('custom', [{ row: 0, column: 0, flipX: true }, { row: 0, column: 1 }]);
  const [first, second] = store.getState().diagrams;
  for (const mode of Object.keys(TOOL_MODES)) {
    store.setToolMode(mode);
    const state = store.getState();
    assert.equal(toolModeOf(diagramState(state, first.id)), mode);
    assert.deepEqual(activeFlags(diagramState(state, second.id)), [], mode);
  }
});

function storeWithEveryStroke() {
  const store = createStore();
  const line = store.addLine(); store.addCurve();
  store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 });
  store.addSum([line, store.addLine()]);
  drawSegment(store,{ x: 1, y: 3 }, { x: 6, y: 3 });
  store.addPoint({ x: 2, y: 2 }); store.addGroup();
  return store;
}

test('every document collection is part of history, deletion and the JSON document', () => {
  const store = storeWithEveryStroke(), state = store.getState(), json = serializeActive(state);
  for (const collection of OBJECT_COLLECTIONS) {
    assert.ok(Array.isArray(state[collection]), collection);
    assert.ok(Array.isArray(json[collection]), `${collection} is serialized`);
    assert.ok(json.diagrams.every(diagram => Array.isArray(diagram[collection])), `${collection} per diagram`);
  }
  store.configureLayout('custom', [{ row: 0, column: 0, flipX: true }, { row: 0, column: 1 }]);
  assert.ok(OBJECT_COLLECTIONS.every(collection => Array.isArray(store.getState().diagrams[1][collection])), 'new diagrams start empty');
  store.selectObjects(store.getState().objectOrder); store.removeSelected();
  assert.ok(OBJECT_COLLECTIONS.every(collection => store.getState()[collection].length === 0));
  store.undo();
  assert.equal(store.getState().objectOrder.length, state.objectOrder.length);
});

// A visible stroke that is not a magnet/fill source must say why here.
const STROKE_EXCLUSIONS = { ruler: 'The ruler tool is disabled and creates no objects.' };

test('visible stroke models declare stroke geometry or an explicit exclusion', () => {
  for (const [type, Model] of Object.entries(OBJECT_MODELS)) {
    const stroke = Model.prototype instanceof StrokeObject || Model === SumObject;
    if (Object.hasOwn(STROKE_EXCLUSIONS, type)) assert.equal(OBJECT_TYPES[type].strokeGeometry, false, type);
    else assert.equal(OBJECT_TYPES[type].strokeGeometry, stroke, `${type}: strokeGeometry must match its model`);
  }
});

test('every stroke-geometry type reaches the shared magnet targets and cache key', () => {
  const store = storeWithEveryStroke(), state = store.getState();
  const { bounds } = createViewport(800, 600, state.quadrantMode, state);
  const ids = new Set(buildSnapTargets(state, bounds).shapes.map(shape => shape.id));
  for (const [type, spec] of Object.entries(OBJECT_TYPES)) {
    const sample = state[spec.collection][0];
    if (!spec.strokeGeometry) continue;
    assert.ok(sample, `register a ${type} sample here before adding a stroke type`);
    assert.ok(ids.has(sample.id), `${type} is a magnet target`);
    if (type === 'sum') continue; // A sum follows its sources and has no own position.
    const moved = structuredClone(state);
    moved[spec.collection][0] = objectModel(sample).translate({ x: 0.5, y: 0.25 });
    assert.notEqual(geometryKey(moved, bounds), geometryKey(state, bounds), `${type} invalidates the shared cache`);
  }
});

test('every creation mode registers one pointer controller with a draft layer contract', async () => {
  const { CREATION_TOOLS, CreationTool, assertCreationTools } = await import('../src/graph/creation-tools.js');
  const creation = Object.keys(TOOL_MODES).filter(mode => TOOL_MODES[mode].kind === 'creation').sort();
  assert.deepEqual(Object.keys(CREATION_TOOLS).sort(), creation);
  class Silent extends CreationTool {}
  class Undrawn extends CreationTool { get slot() { return 'lines'; } pointerDown() { return true; } }
  assert.throws(() => assertCreationTools({ ...CREATION_TOOLS, extra: new Silent() }), /must register/);
  assert.throws(() => assertCreationTools({ ...CREATION_TOOLS, point: new Silent() }), /pointerDown/);
  assert.throws(() => assertCreationTools({ ...CREATION_TOOLS, point: new Undrawn() }), /draw its draft layer/);
  assert.throws(() => assertCreationTools({ ...CREATION_TOOLS, point: {} }), /Invalid creation tool/);
});
