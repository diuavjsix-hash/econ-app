import { GraphObject } from './graph-object.js';

/** Check the registration boundary, before a missing implementation reaches a gesture. */
export function assertModelContract(Model) {
  if (typeof Model !== 'function' || !(Model.prototype instanceof GraphObject)) throw new TypeError('A registered model must extend GraphObject');
  for (const method of Model.requiredMethods) {
    if (typeof Model.prototype[method] !== 'function' || Model.prototype[method] === GraphObject.prototype[method]) {
      throw new TypeError(`${Model.name} must implement ${method}()`);
    }
  }
  return Model;
}
export function assertRegistryContract(models, types) {
  const expected = Object.keys(types).sort(), actual = Object.keys(models).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new TypeError('Object model and collection registrations must match');
  for (const [type, Model] of Object.entries(models)) {
    if (typeof types[type].collection !== 'string' || typeof types[type].duplicatable !== 'boolean' || typeof types[type].strokeGeometry !== 'boolean') throw new TypeError(`Invalid object capabilities: ${type}`);
    assertModelContract(Model);
  }
  return Object.freeze(models);
}
