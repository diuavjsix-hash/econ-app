// One inventory for the mutually exclusive tool modes. The store keeps the boolean
// flags for readers, but every write goes through these entries so a new tool is
// registered once instead of being added to each exclusion branch.
const keepNone = () => false;
const keepSingle = selected => selected.length <= 1;

export const TOOL_MODES = Object.freeze({
  hand: { flag: 'handSelected', kind: 'selection' },
  point: {
    flag: 'mouseSelected', kind: 'creation', drawingPointer: true,
    keepSelection: selected => selected.length === 1 && ['point', 'fill', 'group'].includes(selected[0].type),
    context: state => ({ title: '점 찍기', mode: '점', detail: state.activeTool === 'point' ? '클릭해서 점을 찍습니다.' : '점 생성이 꺼져 있습니다.' }),
  },
  dashed: {
    flag: 'dashedSelected', kind: 'creation', drawingPointer: true,
    keepSelection: selected => selected.length === 1 && selected[0].type === 'dashed',
    context: () => ({ title: '점선 그리기', mode: '점선', detail: '두 점을 클릭하거나 드래그하세요.' }),
  },
  sketch: {
    flag: 'sketchSelected', kind: 'creation', drawingPointer: true, keepSelection: keepNone,
    context: () => ({ title: '곡선 그리기', mode: '곡선', detail: '시작점 → 끝점 → 지나는 점' }),
  },
  fill: {
    flag: 'fillSelected', kind: 'creation', keepSelection: keepNone,
    enter: state => { state.fillAutoColor = true; },
    context: () => ({ title: '구역 칠하기', mode: '칠하기', detail: '닫힌 구역을 클릭하세요.' }),
  },
  duplicate: {
    flag: 'duplicatePanel', kind: 'operation', keepSelection: keepSingle,
    context: () => ({ title: '복제', mode: '복제', detail: '원본을 고르고 복제합니다.' }),
  },
  sum: {
    flag: 'sumPanel', kind: 'operation', keepSelection: keepSingle,
    context: () => ({ title: '수직합 · 수평합', mode: '합치기', detail: '직선·기본 곡선을 두 개 이상 선택하세요.' }),
  },
});
for (const spec of Object.values(TOOL_MODES)) Object.freeze(spec);

export const TOOL_MODE_FLAGS = Object.freeze(Object.values(TOOL_MODES).map(spec => spec.flag));
// When a patch names several modes, the later entry wins; hand stays last as the reset.
const REQUEST_ORDER = Object.freeze(['fill', 'point', 'dashed', 'duplicate', 'sketch', 'sum', 'hand']);

/** The active mode of a store snapshot, or null for an inactive diagram view. */
export function toolModeOf(state) {
  for (const [mode, spec] of Object.entries(TOOL_MODES)) if (mode !== 'hand' && state?.[spec.flag]) return mode;
  return state?.handSelected ? 'hand' : null;
}

/** Flags for one mode; `null` clears every mode, as in an inactive diagram. */
export function toolModeFlags(mode) {
  if (mode !== null && !Object.hasOwn(TOOL_MODES, mode)) throw new TypeError(`Unknown tool mode: ${mode}`);
  return Object.fromEntries(Object.entries(TOOL_MODES).map(([name, spec]) => [spec.flag, name === mode]));
}

/** Translate the boolean flags of a store patch into one requested mode. */
export function requestedToolMode(patch, current) {
  let requested = null;
  for (const mode of REQUEST_ORDER) if (patch[TOOL_MODES[mode].flag] === true) requested = mode;
  if (requested) return requested;
  return current && patch[TOOL_MODES[current].flag] === false ? 'hand' : null;
}

export const usesDrawingPointer = state => Boolean(TOOL_MODES[toolModeOf(state)]?.drawingPointer);
export const isOperationMode = state => TOOL_MODES[toolModeOf(state)]?.kind === 'operation';
