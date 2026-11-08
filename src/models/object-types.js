// One inventory for document collections, names and capabilities.
// strokeGeometry: the object's visible geometry is a magnet target and a fill wall,
// so it belongs to the shared snap/fill cache key (see tests/registry-contract.test.js).
export const OBJECT_TYPES = Object.freeze({
  line: { collection: 'lines', label: '직선', duplicatable: true, strokeGeometry: true },
  curve: { collection: 'curves', label: '곡선', duplicatable: true, strokeGeometry: true },
  sketch: { collection: 'sketches', label: '자유 곡선', duplicatable: true, strokeGeometry: true },
  sum: { collection: 'sums', label: '합', duplicatable: false, strokeGeometry: true },
  point: { collection: 'points', label: '점', duplicatable: true, strokeGeometry: false },
  fill: { collection: 'fills', label: '구역', duplicatable: false, strokeGeometry: false },
  ruler: { collection: 'rulers', label: '자', duplicatable: false, strokeGeometry: false },
  group: { collection: 'groups', label: '폴더', duplicatable: true, strokeGeometry: false },
});
for (const spec of Object.values(OBJECT_TYPES)) Object.freeze(spec);
export const OBJECT_LABELS = Object.freeze(Object.fromEntries(Object.entries(OBJECT_TYPES).map(([type, spec]) => [type, spec.label])));
export const OBJECT_COLLECTIONS = Object.freeze(Object.values(OBJECT_TYPES).map(spec => spec.collection));
export const STROKE_GEOMETRY_COLLECTIONS = Object.freeze(Object.values(OBJECT_TYPES).filter(spec => spec.strokeGeometry).map(spec => spec.collection));
export const DUPLICATABLE_TYPES = Object.freeze(Object.keys(OBJECT_TYPES).filter(type => OBJECT_TYPES[type].duplicatable));
