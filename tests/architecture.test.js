import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphObject, StrokeObject } from '../src/models/graph-object.js';
import { assertModelContract, assertRegistryContract } from '../src/models/contracts.js';
import { objectModel, OBJECT_MODELS } from '../src/models/objects.js';
import { OBJECT_TYPES } from '../src/models/object-types.js';
import { AnalyticCurveFamily, QuasilinearFamily, CURVE_FAMILIES, assertCurveFamilyContract, registerCurveFamilies } from '../src/models/curve-families.js';

test('registration rejects forgotten edit and visible-geometry hooks before a user gesture', () => {
  class MissingEdit extends GraphObject {}
  class MissingStroke extends StrokeObject { updateGeometry() {} }
  assert.throws(() => assertModelContract(MissingEdit), /must implement updateGeometry/);
  assert.throws(() => assertModelContract(MissingStroke), /must implement visiblePieces/);
  assert.throws(() => assertModelContract(class Foreign {}), /extend GraphObject/);
  assert.throws(() => assertRegistryContract({ ...OBJECT_MODELS, extra: MissingEdit }, OBJECT_TYPES), /registrations must match/);
  assert.throws(() => assertRegistryContract({ ...OBJECT_MODELS, line: MissingStroke }, OBJECT_TYPES), /visiblePieces/);
});

test('curve registration checks geometry capabilities and required hooks before a new family reaches any tool', () => {
  class Incomplete extends AnalyticCurveFamily {}
  class MissingTangent extends QuasilinearFamily { tangentVector = AnalyticCurveFamily.prototype.tangentVector; }
  class UnknownGeometry extends QuasilinearFamily { get contactGeometry() { return 'unknown'; } }
  const metadata = { label: '검사' };
  assert.throws(() => assertCurveFamilyContract(new Incomplete(metadata)), /must implement value/);
  assert.throws(() => registerCurveFamilies({ broken: new MissingTangent(metadata) }), /must implement tangentVector/);
  assert.throws(() => assertCurveFamilyContract(new UnknownGeometry(metadata)), /Unknown contact geometry/);
  assert.throws(() => assertCurveFamilyContract({}), /must extend/);
  for (const family of Object.values(CURVE_FAMILIES)) assert.equal(assertCurveFamilyContract(family), family);
});

test('unsupported movement fails explicitly while folders keep common rename and independent copying', () => {
  const group = { type: 'group', id: 'group-1', name: '폴더', parentId: null, collapsed: true }, model = objectModel(group);
  assert.throws(() => model.translate({ x: 1, y: 1 }), /does not support translation/);
  assert.throws(() => model.visiblePieces({}, {}), /does not provide a canvas stroke/);
  model.applyPatch({ name: '바꾼 폴더' }); assert.equal(group.name, '바꾼 폴더');
  const copy = model.duplicate().object; assert.equal(copy.name, '바꾼 폴더′'); assert.equal(copy.collapsed, false);
  assert.equal(group.collapsed, true);
  assert.throws(() => objectModel({ type: 'sum', id: 'sum-1' }).translate({ x: 1, y: 1 }), /does not support translation/);
});
