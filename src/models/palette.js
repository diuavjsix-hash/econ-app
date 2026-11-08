// The one source of default drawing colors. Documents store the resolved hex value,
// so changing this palette affects new objects only. UI chrome colors live in
// src/ui/tokens.css; drawing colors live here because they are saved in JSON.
// Each ink keeps at least 3:1 contrast on the white sheet (WCAG 1.4.11).

export const INK = Object.freeze({
  blue: '#2a5db0',
  red: '#c43d32',
  green: '#2b7a4b',
  ochre: '#b06f12',
  plum: '#7445a8',
  teal: '#17808a',
  graphite: '#3f3f3b',
  pencil: '#77776f',
  muted: '#9a9a92',
});

/** Lines and other repeated strokes cycle through this order. */
export const STROKE_CYCLE = Object.freeze([INK.blue, INK.red, INK.green, INK.ochre, INK.plum, INK.teal]);
/** Sums use a separate cycle so a sum rarely shares its sources' color. */
export const SUM_CYCLE = Object.freeze([INK.ochre, INK.plum, INK.teal, INK.red]);

/** Region fills; the names are the accessible labels of the swatches. */
export const FILL_PALETTE = Object.freeze([
  [INK.blue, '파랑'], [INK.red, '빨강'], [INK.green, '초록'],
  [INK.ochre, '황토'], [INK.plum, '보라'], [INK.teal, '청록'],
].map(entry => Object.freeze(entry)));

/** Defaults by object role; new object kinds add a role here instead of a literal. */
export const ROLE_COLORS = Object.freeze({
  point: INK.graphite,
  ruler: INK.pencil,
  group: INK.muted,
  sketch: INK.teal,
  // Textbook convention: a falling (demand-like) curve in blue, a rising (supply-like) one in red.
  descending: INK.blue,
  ascending: INK.red,
  ppc: INK.green,
  hyperbola: INK.teal,
  cobbDouglas: INK.plum,
  substitutes: INK.green,
  complements: INK.ochre,
  quasilinear: INK.teal,
});

export const strokeColor = index => STROKE_CYCLE[((index % STROKE_CYCLE.length) + STROKE_CYCLE.length) % STROKE_CYCLE.length];
export const sumColor = index => SUM_CYCLE[((index % SUM_CYCLE.length) + SUM_CYCLE.length) % SUM_CYCLE.length];
