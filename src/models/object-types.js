// One inventory for document collections, names and duplication capabilities.
export const OBJECT_TYPES = Object.freeze({
  line: { collection: 'lines', label: '직선', duplicatable: true },
  curve: { collection: 'curves', label: '곡선', duplicatable: true },
  sketch: { collection: 'sketches', label: '자유 곡선', duplicatable: true },
  sum: { collection: 'sums', label: '합', duplicatable: false },
  point: { collection: 'points', label: '점', duplicatable: true },
  dashed: { collection: 'dashedLines', label: '점선', duplicatable: true },
  fill: { collection: 'fills', label: '구역', duplicatable: false },
  ruler: { collection: 'rulers', label: '자', duplicatable: false },
  group: { collection: 'groups', label: '폴더', duplicatable: true },
});
for (const spec of Object.values(OBJECT_TYPES)) Object.freeze(spec);
export const OBJECT_LABELS = Object.freeze(Object.fromEntries(Object.entries(OBJECT_TYPES).map(([type, spec]) => [type, spec.label])));
export const OBJECT_COLLECTIONS = Object.freeze(Object.values(OBJECT_TYPES).map(spec => spec.collection));
export const DUPLICATABLE_TYPES = Object.freeze(Object.keys(OBJECT_TYPES).filter(type => OBJECT_TYPES[type].duplicatable));
