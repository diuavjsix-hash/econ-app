import { mkdir, writeFile } from 'node:fs/promises';
import { createStore } from '../src/state.js';
import { serializeDocument } from '../src/export.js';

// A deterministic documentation fixture; does not access a running editor's memory.
const store = createStore();
store.configureLayout('face2');
const [first, second] = store.getState().diagrams;
store.updateDiagram({ name: '합산과 접점' });
const budget = store.addLine();
store.updateSelected({ name: '예산선', slope: -1, anchor: { x: 0, y: 8 } });
store.addFill({ rings: [[{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }]] });
store.updateSelected({ name: '칠한 구역' });
const demand = store.addCurve({ variant: 'descending', anchor: { x: 4, y: 4 }, span: 3 });
store.updateSelected({ name: '기본 곡선' });
store.addSum([budget, demand], { direction: 'horizontal', nonnegative: true });
store.addSketch({ x: 1, y: 8 }, { x: 8, y: 2 }, { x: 4, y: 4 }, { lineId: budget });
store.updateSelected({ name: '직선에 접한 자유 곡선' });

store.selectDiagram(second.id);
store.updateDiagram({ name: '최저점 표시와 일반 점' });
const group = store.addGroup();
store.updateSelected({ name: '자유 도식' });
const cup = store.addSketch({ x: 1, y: 6 }, { x: 7, y: 6 }, { x: 4, y: 2 }, { mode: 'horizontal' });
store.updateSelected({ name: 'U자 곡선' });
store.moveObject(cup, group);
store.markMinimum();
const point = store.addPoint({ x: 5, y: 3 });
store.moveObject(point, group);
const through = store.lineThroughSelectedPoint({ slope: 1 });
store.moveObject(through, point);
store.addDashedLine({ x: 4, y: 0 }, { x: 4, y: 2 });
store.updateSelected({ name: '독립 점선' });
for (const family of ['cobb-douglas','substitutes','complements','quasilinear']) store.addIndifference(family);
store.addIndifference('rectangular-hyperbola', { anchor: { x: 3, y: 4 } });
// A kinked line: two lines that each stop at the shared kink, plus a dashed ray.
store.addLine();
store.updateSelected({ name: '꺾인 선 (왼쪽)', slope: -2, anchor: { x: 2, y: 4 }, extent: [null, 0] });
store.addLine();
store.updateSelected({ name: '꺾인 선 (오른쪽)', slope: -0.5, anchor: { x: 2, y: 4 }, extent: [0, null] });
store.addLine();
store.updateSelected({ name: '점선 반직선', slope: 0, anchor: { x: 2, y: 4 }, extent: [0, null], style: 'dashed' });
store.selectDiagram(first.id);

const output = new URL('../docs/examples/editor-v11.json', import.meta.url);
await mkdir(new URL('../docs/examples/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(serializeDocument(store.getState()), null, 2)}\n`);
console.log('Generated docs/examples/editor-v11.json');
