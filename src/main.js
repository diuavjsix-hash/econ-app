import { mountEditorUI } from './editor-ui.js';
import { mountHandTool } from './tools/hand.js';
import { mountSketchTool } from './tools/sketch.js';
import { mountSumTool } from './tools/sum.js';
import { mountDuplicateTool } from './tools/duplicate.js';
import { mountDashedTool } from './tools/dashed.js';
import { createStore } from './state.js';
import { mountWorkspace } from './workspace.js';
import { mountLineTool } from './tools/line.js';
import { mountExport } from './export.js';
import { mountQuadrants } from './quadrants.js';
import { mountAxes } from './axes.js';
import { mountCurveTool } from './tools/curve.js';
import { mountObjectList } from './tools/objects.js';
import { mountPointTool } from './tools/point.js';
import { mountHistory } from './history.js';

const icons = {
  hand: '<path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-2 8-6 8h-2c-2 0-3-1-5-4l-3-5a2 2 0 0 1 3-2l3 3"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
  graph: '<path d="M5 4v15h15M9 15l4-5 6-4"/>',
  line: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  curve: '<path d="M4 5c2 10 6 14 16 14"/>',
  point: '<circle cx="12" cy="12" r="4"/>',
  ruler: '<path d="m3 16 13-13 5 5-13 13zM6 13l3 3M10 9l3 3M14 5l3 3"/>',
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
      <button id="undo-action" class="icon-button" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled>${icon('undo')}</button><button id="redo-action" class="icon-button" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z / Ctrl+Y)" disabled>${icon('redo')}</button>
    </div>
    <div class="document-actions">
      <button id="choose-quadrants" class="export-button" aria-label="작업 영역 설정">배치 · 1개</button>
      <button id="graph-settings-action" class="export-button" aria-label="그래프 설정" title="축·사분면·축 방향 설정" aria-haspopup="dialog">${icon('grid')}<span>그래프 설정</span></button>
      <button id="export-json" class="export-button">${icon('export')}<span>저장</span></button>
    </div>
  </header>
  <main class="app-layout">
    <section class="workspace" aria-label="그래프">
      <div class="editor-toolbar" role="group" aria-label="그리기 도구">
        <button id="hand-tool" class="tool-button" aria-pressed="true" aria-label="선택 도구" title="선택·이동 (Esc)"><span class="tool-icon">${icon('hand')}</span><strong>선택</strong></button><button id="line-tool" class="tool-button" aria-label="직선 추가"><span class="tool-icon">${icon('line')}</span><strong>직선</strong>${icon('plus', 'add-icon')}</button>
        <div class="curve-tool-group"><button id="sketch-tool" aria-label="세 점 곡선 그리기" title="시작점·끝점·지나는 점" class="tool-button" aria-pressed="false" aria-expanded="false" aria-controls="sketch-options"><span class="tool-icon">${icon('curve')}</span><strong>곡선</strong></button><details id="curve-menu" class="curve-menu"><summary aria-label="다른 곡선 추가" title="기본 곡선 추가">⌄</summary><div class="curve-menu-content">
          <button id="curve-tool" data-add-curve="descending">우하향 곡선 추가</button>
          <button id="ascending-curve-tool" data-add-curve="ascending">우상향 곡선 추가</button>
        </div></details></div>
        <button id="mouse-tool" class="tool-button" aria-pressed="false" aria-expanded="false" aria-controls="mouse-settings"><span class="tool-icon">${icon('point')}</span><strong>점</strong></button><button id="dashed-tool" class="tool-button" aria-pressed="false" aria-expanded="false" aria-controls="dashed-options"><span class="tool-icon"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3 3" aria-hidden="true"><path d="M4 20 20 4"/></svg></span><strong>점선</strong></button>
        <span class="toolbar-separator" aria-hidden="true"></span><button id="sum-tool" aria-label="수직합·수평합 열기" title="수직합·수평합" class="export-button sum-command" aria-pressed="false" aria-expanded="false" aria-controls="sum-options"><span class="tool-icon">${icon('plus')}</span><strong>합치기</strong></button>
        <div class="toolbar-end"><button id="grid-toggle" class="icon-button grid-toggle" aria-label="격자 표시" aria-pressed="true" title="격자 표시 전환">${icon('grid')}</button></div>
      </div>
      <div class="editor-status" role="status"><span id="editor-mode">선택·이동</span><span id="editor-status-detail"></span></div>
      <div class="canvas-card"><div class="diagram-grid" id="graph"></div></div>
    </section>
    <aside class="tools-panel" aria-labelledby="inspector-title">
      <section class="inspector">
        <div class="inspector-heading"><h2 id="inspector-title">선택 항목</h2><button id="finish-tool" class="icon-button" aria-label="작업 닫고 선택 도구로" title="선택으로 돌아가기 (Esc)" hidden>${icon('close')}</button></div>
        <p id="inspector-empty" class="inspector-empty">도형을 선택하면 여기서 편집합니다.</p>
        <div id="creation-inspector" hidden><section id="sketch-options" aria-label="자유 곡선 그리기" hidden>
        <label class="setting-row" for="sketch-mode">가운데 방향<select id="sketch-mode"><option value="auto">자동</option><option value="horizontal">수평 · ∪ ∩</option><option value="vertical">수직 · 옆으로</option></select></label>
        <p id="sketch-step" class="mouse-hint" role="status">시작점 → 끝점 → 지나는 점</p>
        <p class="mouse-hint">세 번째 점을 직선 위에 찍으면 접합니다. Alt: 자유 배치 · Esc: 취소</p>
      </section><section id="mouse-settings" aria-label="점 도구 설정" hidden>
        <label class="point-snap-setting" for="point-snap-toggle"><span>마우스 조정</span><input id="point-snap-toggle" type="checkbox" role="switch" checked /><span class="switch-track" aria-hidden="true"></span></label>
        <details class="editor-details"><summary>추가 설정</summary><label class="point-snap-setting" for="point-tool"><span>점 생성</span><input id="point-tool" type="checkbox" role="switch" checked aria-describedby="point-create-hint" /><span class="switch-track" aria-hidden="true"></span></label>
        <p id="point-create-hint" class="mouse-hint">활성화 시 좌클릭하면 점이 생성됩니다.</p>
        <label class="point-snap-setting" for="point-coordinates-toggle"><span>좌표 함께 표시</span><input id="point-coordinates-toggle" type="checkbox" role="switch" /><span class="switch-track" aria-hidden="true"></span></label>
      </details></section><section id="dashed-options" aria-label="점선 도구 설정" hidden>
        <label class="point-snap-setting" for="dashed-snap-toggle"><span>마우스 보정</span><input id="dashed-snap-toggle" type="checkbox" role="switch" checked /><span class="switch-track" aria-hidden="true"></span></label>
        <label class="setting-row" for="dashed-mode">방향<select id="dashed-mode"><option value="free">자유</option><option value="horizontal">수평</option><option value="vertical">수직</option></select></label>
        <p class="mouse-hint">두 곳을 클릭하거나 드래그하세요. Shift: 수평·수직</p>
      </section></div>
        <div id="operation-inspector" hidden><section id="duplicate-options" aria-label="복제 설정" hidden>
        <label class="copy-target-label" for="duplicate-target">대상<select id="duplicate-target"><option value="">도형 선택</option></select></label>
        <div id="duplicate-slope-options" hidden>
          <h3 class="copy-caption">기울기</h3>
          <div class="copy-factors" role="group" aria-label="복제 기울기">
            <button data-copy-factor="1" aria-pressed="true"><strong>그대로</strong><span>×1 · 평행</span></button>
            <button data-copy-factor="2" aria-pressed="false"><strong>더 가파르게</strong><span>×2</span></button>
            <button data-copy-factor="0.5" aria-pressed="false"><strong>더 완만하게</strong><span>×½</span></button>
          </div>
        </div>
        <p id="duplicate-preview" class="copy-preview"></p>
        <details class="copy-details"><summary>복제 옵션</summary>
          <label id="duplicate-pivot-row" class="setting-row" for="duplicate-pivot">기준<select id="duplicate-pivot"><option value="intercept">세로축 절편 유지</option><option value="anchor">현재 기준점 유지</option></select></label>
          <label class="setting-row" for="duplicate-placement">배치<select id="duplicate-placement"><option value="same">같은 위치</option><option value="right">가로축 +1</option><option value="up">세로축 +1</option></select></label>
          <label id="duplicate-children-row" class="copy-children" for="duplicate-children"><input id="duplicate-children" type="checkbox" checked />하위 항목 함께</label>
        </details>
        <button id="duplicate-action" class="export-button primary-button copy-action" disabled>복제</button>
        <p id="duplicate-status" class="mouse-hint" role="status" aria-live="polite"></p>
      </section><section id="sum-options" aria-label="수직합·수평합 설정" hidden>
        <label class="setting-row" for="sum-direction">방향<select id="sum-direction"><option value="vertical">수직합 · y를 더하기</option><option value="horizontal">수평합 · x를 더하기</option></select></label>
        <div id="sum-sources" class="sum-sources" role="group" aria-label="합에 사용할 직선·곡선"></div>
        <label class="copy-children" for="sum-nonnegative"><input id="sum-nonnegative" type="checkbox" checked />음수 기여분은 0으로</label>
        <p class="mouse-hint">원본 수정 시 자동 갱신 · 원본 삭제 시 합도 삭제</p>
        <button id="sum-action" class="export-button primary-button copy-action" disabled>합 추가</button>
        <p id="sum-status" class="mouse-hint" role="status" aria-live="polite"></p>
      </section></div>
        <div id="selection-inspector" hidden><section id="object-settings" class="object-settings" aria-label="도형 설정" hidden>
        <div class="name-heading"><label for="object-name">이름</label><button id="duplicate-tool" class="export-button compact-action" aria-pressed="false" aria-expanded="false" aria-controls="duplicate-options"><span class="tool-icon">${icon('duplicate')}</span><strong>복제</strong></button><button id="delete-object" class="icon-button reset-button" aria-label="선택한 항목 삭제" title="삭제">${icon('trash')}</button></div>
        <input id="object-name" type="text" maxlength="80" autocomplete="off" />
        <details class="editor-details"><summary>분류</summary><label class="setting-row" for="object-parent">상위 항목<select id="object-parent"><option value="">최상위</option></select></label>
        </details><div id="binding-settings" hidden><p id="binding-description" class="mouse-hint"></p><button id="detach-binding" class="export-button copy-action">연결 해제</button></div>
        <div id="sum-selected-settings" hidden>
          <p id="sum-selected-description" class="mouse-hint"></p>
          <label class="copy-children" for="sum-selected-nonnegative"><input id="sum-selected-nonnegative" type="checkbox" />음수 기여분은 0으로</label>
          <p id="sum-selected-status" class="mouse-hint" role="status"></p>
        </div>
      </section><section id="line-settings" aria-label="직선 설정" hidden>
        <div class="equation-row"><div id="equation-value" class="equation-value" aria-label="직선의 식">y = x</div><div class="line-actions"><button class="icon-button reset-button" id="reset-line" aria-label="기울기 초기화" title="기울기 초기화">${icon('reset')}</button></div></div>
        <div class="slope-heading"><label for="slope-slider">기울기 <span>m</span></label><input id="slope-input" type="number" step="any" value="1" aria-label="기울기 직접 입력" /></div>
        <input id="slope-slider" type="range" min="-90" max="90" step="0.01" value="45" />
        <div class="range-labels" aria-hidden="true"><span>−∞</span><span>0</span><span>+∞</span></div>
        <div class="slope-presets"><button data-slope="-1" aria-label="기울기 −1" title="기울기 −1" aria-pressed="false"><span class="preset-line negative"></span><strong>−1</strong></button><button data-slope="0" aria-label="기울기 0" title="기울기 0" aria-pressed="false"><span class="preset-line horizontal"></span><strong>0</strong></button><button data-slope="1" aria-label="기울기 1" title="기울기 1" aria-pressed="true"><span class="preset-line positive"></span><strong>1</strong></button><button data-slope="vertical" aria-label="수직선" title="수직선" aria-pressed="false"><span class="preset-line vertical"></span><strong>수직</strong></button></div>
      </section><section id="curve-settings" aria-label="곡선 설정" hidden>
        <div class="equation-row"><div id="curve-title" class="curve-title">우하향</div><div class="line-actions"><button id="reset-curve" class="icon-button reset-button" aria-label="휘어짐 초기화" title="휘어짐 초기화">${icon('reset')}</button></div></div>
        <div class="curve-presets"><button data-curve-variant="ascending" aria-pressed="false">우상향</button><button data-curve-variant="descending" aria-pressed="true">우하향</button></div>
        <div class="slope-heading"><label for="bend-slider">휘어짐</label><output id="bend-value" for="bend-slider">71%</output></div>
        <input id="bend-slider" type="range" min="0" max="100" step="1" value="71" />
        <div class="range-labels" aria-hidden="true"><span>0</span><span>100</span></div>
      </section><section id="sketch-settings" aria-label="자유 곡선 설정" hidden>
        <div class="sketch-shapes" role="group" aria-label="자유 곡선 모양"><button data-sketch-shape="cup">∪</button><button data-sketch-shape="cap">∩</button><button data-sketch-shape="left">⊂</button><button data-sketch-shape="right">⊃</button></div>
        <details class="editor-details"><summary>휘어짐 조절</summary><div class="slope-heading"><label for="sketch-left">시작 쪽 휘어짐</label></div><input id="sketch-left" type="range" min="5" max="200" step="1" value="50" />
        <div class="slope-heading"><label for="sketch-right">끝 쪽 휘어짐</label></div><input id="sketch-right" type="range" min="5" max="200" step="1" value="50" />
        </details><details class="editor-details"><summary>직선에 접하기</summary><label class="setting-row" for="sketch-line">접할 직선<select id="sketch-line"><option value="">직선 선택</option></select></label>
        <button id="sketch-attach" class="export-button copy-action">가운데 점에서 접하게</button>
        </details><button id="sketch-minimum" class="export-button copy-action">최저점 표시</button>
        <p id="sketch-status" class="mouse-hint" role="status"></p>
      </section><section id="point-settings" class="point-settings" aria-label="점 설정" hidden>
        <label class="point-snap-setting" for="point-show-coordinates"><span>좌표 표시</span><input id="point-show-coordinates" type="checkbox" role="switch" /><span class="switch-track" aria-hidden="true"></span></label>
        <label class="copy-children" for="point-line-follow"><input id="point-line-follow" type="checkbox" checked />점을 따라가기</label>
        <button id="point-through-line" class="export-button copy-action">이 점을 지나는 직선</button>
      </section></div>
      </section>
      <section class="object-section" aria-label="도형 목록">
        <div class="object-heading"><h2>도형 <span id="object-count">0</span></h2><button id="add-group" class="icon-button" aria-label="폴더 추가" title="폴더 추가">${icon('folder')}</button></div>
        <p id="objects-empty" class="inspector-empty">아직 도형이 없습니다.</p><div id="object-list" class="object-list" role="tree" aria-label="그래프 목록"></div>
        <div id="object-root-drop" class="root-drop-zone" hidden>최상위로 이동</div>
      </section>
    </aside>
  </main>
  <dialog id="graph-settings-dialog" class="json-dialog graph-settings-dialog" aria-labelledby="graph-dialog-title">
    <div class="json-heading"><h2 id="graph-dialog-title">그래프 설정</h2><button id="close-graph-settings" class="icon-button" aria-label="그래프 설정 닫기">${icon('close')}</button></div>
    <section class="diagram-settings axis-settings" aria-labelledby="diagram-settings-title">
        <h2 id="diagram-settings-title">선택한 그래프</h2>
        <label for="diagram-name">이름<input id="diagram-name" type="text" maxlength="80" autocomplete="off" /></label>
        <label class="setting-row" for="diagram-quadrant">사분면<select id="diagram-quadrant"><option value="first">1사분면</option><option value="upper">1·2사분면</option><option value="all">전체 사분면</option></select></label>
        <label class="setting-row" for="diagram-x-direction">x 증가<select id="diagram-x-direction"><option value="right">오른쪽 →</option><option value="left">왼쪽 ←</option></select></label>
        <label class="setting-row" for="diagram-y-direction">y 증가<select id="diagram-y-direction"><option value="up">위쪽 ↑</option><option value="down">아래쪽 ↓</option></select></label>
      </section>
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
    <div class="graph-dialog-footer"><button id="clear-all" class="export-button danger-action" aria-label="선택한 그래프의 도형 전체 삭제" disabled>${icon('trash')}도형 전체 삭제</button><button id="done-graph-settings" class="export-button primary-button">완료</button></div>
  </dialog>
  <dialog id="quadrant-dialog" class="quadrant-dialog" aria-labelledby="quadrant-title">
    <div class="json-heading"><h2 id="quadrant-title">작업 영역</h2><button id="close-workspace" class="icon-button" aria-label="작업 영역 닫기">${icon('close')}</button></div>
    <h3>배치</h3>
    <div id="layout-choices" class="layout-choices"></div>
    <details id="custom-layout"><summary>직접 배치</summary><div id="custom-layout-grid" class="custom-layout-grid" role="group" aria-label="최대 3행 3열 배치"></div></details>
    <h3>사분면</h3>
    <div class="quadrant-choices">
      <button data-quadrants="first" aria-pressed="true"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="32" y="6" width="26" height="26" rx="4" class="quadrant-fill"/><path d="M6 32h52M32 6v52"/></svg><span>1사분면</span></button>
      <button data-quadrants="upper" aria-pressed="false"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="6" width="52" height="26" rx="4" class="quadrant-fill"/><path d="M6 32h52M32 6v52"/></svg><span>1·2사분면</span></button>
      <button data-quadrants="all" aria-pressed="false"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="6" width="52" height="52" rx="4" class="quadrant-fill"/><path d="M6 32h52M32 6v52"/></svg><span>전체 사분면</span></button>
    </div>
    <label class="apply-quadrants"><input id="apply-all-quadrants" type="checkbox" checked />모든 그래프에 적용</label>
    <div class="workspace-dialog-footer"><p>배치를 줄여도 기존 그래프는 보관됩니다.</p><button id="apply-workspace" class="export-button primary-button">시작</button></div>
  </dialog>
  <dialog id="json-dialog" class="json-dialog" aria-labelledby="json-title">
    <div class="json-heading"><h2 id="json-title">그림 저장 · JSON</h2><button id="close-json" class="icon-button" aria-label="JSON 닫기">${icon('close')}</button></div>
    <textarea id="json-output" aria-label="JSON 출력" readonly spellcheck="false"></textarea>
    <div class="json-footer"><button id="copy-json" class="export-button">복사</button><button id="download-json" class="export-button">${icon('export')}다운로드</button></div>
  </dialog>`;

const store = createStore();
mountHistory(app, store);
mountWorkspace(app, store);
mountLineTool(app, store);
mountCurveTool(app, store);
mountSketchTool(app, store);
mountObjectList(app, store);
mountPointTool(app, store);
mountDashedTool(app, store);
mountHandTool(app, store);
mountDuplicateTool(app, store);
mountSumTool(app, store);
mountExport(app, store);
mountAxes(app, store);
mountEditorUI(app, store);
app.querySelector('#grid-toggle').addEventListener('click', () => store.update({ showGrid: !store.getState().showGrid }));
store.subscribe(({ showGrid }) => {
  app.querySelector('#grid-toggle').setAttribute('aria-pressed', String(showGrid));
});
mountQuadrants(app, store);
