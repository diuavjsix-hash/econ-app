// The app's only icon library. Every icon is drawn on the same 24px grid with a
// 1.75 stroke, round caps and joins, so toolbar, inspector and tree icons read as
// one family. Icon markup is static; never build it from document data.

const PATHS = Object.freeze({
  brand: '<path d="M4 4v16h16"/><path d="M7.5 16.5C9.5 9 13 7 19 6.5"/>',
  select: '<path d="M5 3.5 18.5 10l-6 1.8-2.7 5.7z"/><path d="m12.6 11.9 5 5"/>',
  line: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>',
  curve: '<path d="M4.5 4.5c1.5 9 6 14.5 15 15"/>',
  point: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
  fill: '<path d="M4 20 14.5 4.5 20 20z" fill="currentColor" fill-opacity=".18"/><path d="M4 20 14.5 4.5 20 20z"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  sum: '<path d="M17.5 5h-11l6 7-6 7h11"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l.8 13h9.4l.8-13M10 10.5v5.5M14 10.5v5.5"/>',
  grid: '<path d="M4 9h16M4 15h16M9 4v16M15 4v16"/><rect x="4" y="4" width="16" height="16" rx="2"/>',
  layout: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M4 12h8"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  export: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  undo: '<path d="M9 6 4.5 10.5 9 15"/><path d="M4.5 10.5h9a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 6 4.5 4.5L15 15"/><path d="M19.5 10.5h-9a5.5 5.5 0 0 0 0 11H13"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  grip: '<circle cx="9" cy="7" r=".9"/><circle cx="15" cy="7" r=".9"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="17" r=".9"/><circle cx="15" cy="17" r=".9"/>',
});

// Object-tree glyphs, drawn in the object's own color on a 16px grid.
const GLYPHS = Object.freeze({
  line: '<path d="M2.5 13.5 13.5 2.5"/>',
  curve: '<path d="M2.5 2.5c1 6.5 4.5 10.5 11 11"/>',
  sketch: '<path d="M2 11c2-6 4.5-6 6-3s4 3 6-3"/>',
  sum: '<path d="M12 3H4l4.5 5L4 13h8"/>',
  point: '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>',
  fill: '<path d="M2.5 13.5 9 3l4.5 10.5z" fill="currentColor" fill-opacity=".3"/>',
  ruler: '<path d="M2 8h12M2 5.5v5M14 5.5v5"/>',
  group: '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
});

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

/** A 16px glyph for an object type; unknown types fall back to the line glyph. */
export function objectGlyph(type) {
  const path = GLYPHS[type] ?? GLYPHS.line;
  return `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/** SVG markup for a named icon; unknown names fail loudly instead of rendering blank. */
export function icon(name, className = '') {
  if (!Object.hasOwn(PATHS, name)) throw new TypeError(`Unknown icon: ${name}`);
  return `<svg class="icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
