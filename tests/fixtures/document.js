import { serializeDocument } from '../../src/export.js';

/** The exported document with the active diagram's fields spread on top: most tests read one graph. */
export function serializeActive(state) {
  const document = serializeDocument(state);
  return { ...document, ...document.diagrams.find(diagram => diagram.id === document.activeDiagramId) };
}
