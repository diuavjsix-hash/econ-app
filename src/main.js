import { createStore } from './state.js';
import { mountGraph } from './graph/canvas.js';
import { mountLineTool } from './tools/line.js';
import { mountExport } from './export.js';
import { mountQuadrants } from './quadrants.js';
import { mountAxes } from './axes.js';
import { mountCurveTool } from './tools/curve.js';
import { mountObjectList } from './tools/objects.js';
import { mountPointTool } from './tools/point.js';
import { mountHistory } from './history.js';

const icons = {
  graph: '<path d="M5 4v15h15M9 15l4-5 6-4"/>',
  line: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  curve: '<path d="M4 5c2 10 6 14 16 14"/>',
  point: '<circle cx="12" cy="12" r="4"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7M6 10h12"/>',
  folder: '<path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo: '<path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
};
const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="app-header">
    <a class="brand" href="./" aria-label="Econ Studio 홈"><span class="brand-symbol">${icon('graph')}</span><span>Econ<span class="brand-light"> Studio</span></span></a>
    <div class="history-actions" role="group" aria-label="편집 기록">
      <button id="undo-action" class="icon-button" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled>${icon('undo')}</button>
      <button id="redo-action" class="icon-button" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z / Ctrl+Y)" disabled>${icon('redo')}</button>
      <button id="clear-all" class="icon-button" aria-label="전체 삭제" title="전체 삭제" disabled>${icon('trash')}</button>
    </div>
    <button id="choose-quadrants" class="export-button" aria-label="사분면 선택">1사분면</button>
    <button id="export-json" class="export-button">${icon('export')}JSON</button>
  </header>
  <main class="app-layout">
    <section class="workspace" aria-label="그래프">
      <div class="canvas-card">
        <button id="grid-toggle" class="icon-button grid-toggle" aria-label="격자 표시" aria-pressed="true" title="격자 표시 전환">${icon('grid')}</button>
        <div class="graph-container" id="graph"></div>
      </div>
    </section>
    <aside class="tools-panel" aria-labelledby="tools-title">
      <section class="axis-settings" aria-labelledby="axes-title">
        <h2 id="axes-title">축</h2>
        <label for="horizontal-axis-name">수평축<input id="horizontal-axis-name" type="text" value="x" placeholder="x" maxlength="80" autocomplete="off" /></label>
        <label for="vertical-axis-name">수직축<input id="vertical-axis-name" type="text" value="y" placeholder="y" maxlength="80" autocomplete="off" /></label>
        <label class="point-snap-setting axis-gap-toggle" for="axis-gap-toggle"><span>축에서 선 띄우기</span><input id="axis-gap-toggle" type="checkbox" role="switch" aria-controls="axis-gap-settings" /><span class="switch-track" aria-hidden="true"></span></label>
        <div id="axis-gap-settings" class="axis-gap-settings" hidden>
          <div class="slope-heading"><label for="axis-gap-slider">간격</label><output id="axis-gap-value" for="axis-gap-slider">0.75</output></div>
          <input id="axis-gap-slider" type="range" min="0.25" max="2" step="0.05" value="0.75" aria-label="축과 선 사이 간격" />
        </div>
      </section>
      <h2 id="tools-title">도구</h2>
      <button id="line-tool" class="tool-button" aria-label="직선 추가"><span class="tool-icon">${icon('line')}</span><strong>직선</strong>${icon('plus', 'add-icon')}</button>
      <button id="curve-tool" class="tool-button" aria-label="곡선 추가"><span class="tool-icon">${icon('curve')}</span><strong>곡선</strong>${icon('plus', 'add-icon')}</button>
      <button id="mouse-tool" class="tool-button" aria-pressed="false" aria-expanded="false" aria-controls="mouse-settings"><span class="tool-icon">${icon('mouse')}</span><strong>마우스</strong><span class="mouse-chevron" aria-hidden="true">⌄</span></button>
      <section id="mouse-settings" aria-label="마우스 설정" hidden>
        <label class="point-snap-setting" for="point-snap-toggle"><span>마우스 조정</span><input id="point-snap-toggle" type="checkbox" role="switch" /><span class="switch-track" aria-hidden="true"></span></label>
        <label class="point-snap-setting" for="point-tool"><span>점 생성</span><input id="point-tool" type="checkbox" role="switch" aria-describedby="point-create-hint" /><span class="switch-track" aria-hidden="true"></span></label>
        <p id="point-create-hint" class="mouse-hint">활성화 시 우클릭하면 점이 생성됩니다.</p>
        <label class="point-snap-setting" for="point-coordinates-toggle"><span>좌표 함께 표시</span><input id="point-coordinates-toggle" type="checkbox" role="switch" /><span class="switch-track" aria-hidden="true"></span></label>
      </section>
      <section class="object-section" aria-label="도형 목록">
        <div class="object-heading"><h2>도형</h2><button id="add-group" class="icon-button" aria-label="폴더 추가" title="폴더 추가">${icon('folder')}</button></div>
        <div id="object-list" class="object-list" role="tree" aria-label="그래프 목록"></div>
        <div id="object-root-drop" class="root-drop-zone" hidden>최상위로 이동</div>
      </section>
      <section id="object-settings" class="object-settings" aria-label="도형 설정" hidden>
        <div class="name-heading"><label for="object-name">이름</label><button id="delete-object" class="icon-button reset-button" aria-label="선택한 항목 삭제" title="삭제">${icon('trash')}</button></div>
        <input id="object-name" type="text" maxlength="80" autocomplete="off" />
        <label class="setting-row" for="object-parent">상위 항목<select id="object-parent"><option value="">최상위</option></select></label>
      </section>
      <section id="line-settings" aria-label="직선 설정" hidden>
        <div class="equation-row"><div id="equation-value" class="equation-value" aria-label="직선의 식">y = x</div><div class="line-actions"><button class="icon-button reset-button" id="reset-line" aria-label="기울기 초기화" title="기울기 초기화">${icon('reset')}</button></div></div>
        <div class="slope-heading"><label for="slope-slider">기울기 <span>m</span></label><input id="slope-input" type="number" step="any" value="1" aria-label="기울기 직접 입력" /></div>
        <input id="slope-slider" type="range" min="-90" max="90" step="0.01" value="45" />
        <div class="range-labels" aria-hidden="true"><span>−∞</span><span>0</span><span>+∞</span></div>
        <div class="slope-presets"><button data-slope="-1" aria-label="기울기 −1" title="기울기 −1" aria-pressed="false"><span class="preset-line negative"></span><strong>−1</strong></button><button data-slope="0" aria-label="기울기 0" title="기울기 0" aria-pressed="false"><span class="preset-line horizontal"></span><strong>0</strong></button><button data-slope="1" aria-label="기울기 1" title="기울기 1" aria-pressed="true"><span class="preset-line positive"></span><strong>1</strong></button><button data-slope="vertical" aria-label="수직선" title="수직선" aria-pressed="false"><span class="preset-line vertical"></span><strong>수직</strong></button></div>
      </section>
      <section id="curve-settings" aria-label="곡선 설정" hidden>
        <div class="equation-row"><div id="curve-title" class="curve-title">우하향</div><div class="line-actions"><button id="reset-curve" class="icon-button reset-button" aria-label="휘어짐 초기화" title="휘어짐 초기화">${icon('reset')}</button></div></div>
        <div class="curve-presets"><button data-curve-variant="ascending" aria-pressed="false">우상향</button><button data-curve-variant="descending" aria-pressed="true">우하향</button></div>
        <div class="slope-heading"><label for="bend-slider">휘어짐</label><output id="bend-value" for="bend-slider">71%</output></div>
        <input id="bend-slider" type="range" min="0" max="100" step="1" value="71" />
        <div class="range-labels" aria-hidden="true"><span>0</span><span>100</span></div>
      </section>
      <section id="point-settings" class="point-settings" aria-label="점 설정" hidden>
        <label class="point-snap-setting" for="point-show-coordinates"><span>좌표 표시</span><input id="point-show-coordinates" type="checkbox" role="switch" /><span class="switch-track" aria-hidden="true"></span></label>
        <h2>보조선</h2>
        <label class="setting-row" for="point-horizontal">수평<select id="point-horizontal"><option value="none">없음</option><option value="dashed">점선</option><option value="solid">실선</option></select></label>
        <label class="setting-row" for="point-vertical">수직<select id="point-vertical"><option value="none">없음</option><option value="dashed">점선</option><option value="solid">실선</option></select></label>
        <label class="setting-row" for="point-guide-extent">범위<select id="point-guide-extent"><option value="axes">축까지</option><option value="full">영역 전체</option></select></label>
      </section>
    </aside>
  </main>
  <dialog id="quadrant-dialog" class="quadrant-dialog" aria-labelledby="quadrant-title">
    <h2 id="quadrant-title">작업 영역</h2>
    <div class="quadrant-choices">
      <button data-quadrants="first" aria-pressed="true"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="32" y="6" width="26" height="26" rx="4" class="quadrant-fill"/><path d="M6 32h52M32 6v52"/></svg><span>1사분면</span></button>
      <button data-quadrants="upper" aria-pressed="false"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="6" width="52" height="26" rx="4" class="quadrant-fill"/><path d="M6 32h52M32 6v52"/></svg><span>1·2사분면</span></button>
      <button data-quadrants="all" aria-pressed="false"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="6" width="52" height="52" rx="4" class="quadrant-fill"/><path d="M6 32h52M32 6v52"/></svg><span>전체 사분면</span></button>
    </div>
  </dialog>
  <dialog id="json-dialog" class="json-dialog" aria-labelledby="json-title">
    <div class="json-heading"><h2 id="json-title">JSON</h2><button id="close-json" class="icon-button" aria-label="JSON 닫기">${icon('close')}</button></div>
    <textarea id="json-output" aria-label="JSON 출력" readonly spellcheck="false"></textarea>
    <div class="json-footer"><button id="copy-json" class="export-button">복사</button><button id="download-json" class="export-button">${icon('export')}다운로드</button></div>
  </dialog>`;

const store = createStore();
mountHistory(app, store);
mountGraph(app.querySelector('#graph'), store);
mountLineTool(app, store);
mountCurveTool(app, store);
mountObjectList(app, store);
mountPointTool(app, store);
mountExport(app, store);
mountAxes(app, store);
app.querySelector('#grid-toggle').addEventListener('click', () => store.update({ showGrid: !store.getState().showGrid }));
store.subscribe(({ showGrid }) => {
  app.querySelector('#grid-toggle').setAttribute('aria-pressed', String(showGrid));
});
mountQuadrants(app, store);
