// Static application shell. Every control is built with ui/controls.js and every icon
// comes from ui/icons.js; tool modules find their elements by id and data attributes,
// so this file only decides arrangement and wording.
import { rangeField, numberField, textField, selectField, switchField, checkField, hint, button, iconButton, toolButton, segmented } from './controls.js';
import { icon } from './icons.js';
import { fillControls } from '../tools/fill.js';

// Glyphs inside segmented choices share one 32×12 frame so every option row aligns.
const glyph = path => `<svg viewBox="0 0 32 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const curveGlyph = path => `<svg class="curve-glyph" viewBox="0 0 48 32" fill="none" aria-hidden="true"><path d="${path}"/></svg>`;

// One control set for the line tool and a selected line: kind (line/ray/segment) and style.
const lineShapeControls = () => segmented({ label: '선 종류', items: [
  { data: { 'line-kind': 'line' }, label: '직선', title: '양쪽으로 뻗는 직선', glyph: glyph('<path d="M2 6H30M5 3 2 6l3 3M27 3l3 3-3 3"/>') },
  { data: { 'line-kind': 'ray' }, label: '반직선', title: '첫 점에서 한쪽으로 뻗는 반직선', glyph: glyph('<path d="M5 6H30M27 3l3 3-3 3"/><circle cx="4" cy="6" r="2" fill="currentColor"/>') },
  { data: { 'line-kind': 'segment' }, label: '선분', title: '두 점 사이의 선분', glyph: glyph('<path d="M5 6H27"/><circle cx="4" cy="6" r="2" fill="currentColor"/><circle cx="28" cy="6" r="2" fill="currentColor"/>') },
] }) + segmented({ label: '선 모양', items: [
  { data: { 'line-style': 'solid' }, label: '실선', glyph: glyph('<path d="M3 6H29"/>') },
  { data: { 'line-style': 'dashed' }, label: '점선', glyph: glyph('<path d="M3 6H29" stroke-dasharray="4 3" stroke-linecap="butt"/>') },
] });

const libraryItem = ({ attr, value, label, path, id, ariaLabel }) =>
  `<button type="button" class="library-item" ${attr}="${value}"${id ? ` id="${id}"` : ''}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}>${curveGlyph(path)}<span class="library-label">${label}</span>${icon('plus', 'library-add')}</button>`;
const panelSection = (title, body, attributes = '') => `<section class="panel-section"${attributes}><h3 class="section-title">${title}</h3>${body}</section>`;
const choice = (mode, label, art, pressed = false) =>
  `<button type="button" class="choice" data-quadrants="${mode}" aria-pressed="${pressed}"><svg viewBox="0 0 64 64" aria-hidden="true">${art}</svg><span class="choice-label">${label}</span></button>`;

const header = () => `
  <header class="app-header">
    <a class="brand" href="./" aria-label="Econ Studio 홈"><span class="brand-mark">${icon('brand')}</span><span class="brand-name">Econ Studio</span></a>
    <div class="history-actions" role="group" aria-label="편집 기록">
      ${iconButton({ id: 'undo-action', icon: icon('undo'), label: '되돌리기', title: '되돌리기 (Ctrl+Z)', disabled: true })}${iconButton({ id: 'redo-action', icon: icon('redo'), label: '다시 실행', title: '다시 실행 (Ctrl+Shift+Z / Ctrl+Y)', disabled: true })}
    </div>
    <div class="document-actions">
      ${button({ id: 'choose-quadrants', label: '포맷', icon: icon('layout'), variant: 'ghost', ariaLabel: '작업 영역 설정', popup: 'dialog' })}
      ${button({ id: 'graph-settings-action', label: '그래프 설정', icon: icon('settings'), variant: 'ghost', ariaLabel: '그래프 설정', title: '축·사분면·축 방향 설정', popup: 'dialog' })}
      ${button({ id: 'export-json', label: '저장', icon: icon('export'), popup: 'dialog' })}
    </div>
  </header>`;

const toolbar = () => `
      <div class="workbar">
        <div class="editor-toolbar toolbar" role="group" aria-label="그리기 도구">
          ${toolButton({ id: 'hand-tool', label: '선택', ariaLabel: '선택 도구', title: '선택·이동 (Esc)', pressed: 'true', icon: icon('select') })}${toolButton({ id: 'line-tool', label: '직선', ariaLabel: '직선 그리기', title: '두 점을 찍어 직선·반직선·선분 그리기', pressed: 'false', controls: 'line-options', icon: icon('line') })}${toolButton({ id: 'sketch-tool', label: '곡선', ariaLabel: '곡선 그리기', title: '시작점·끝점·지나는 점', pressed: 'false', controls: 'sketch-options', icon: icon('curve') })}${toolButton({ id: 'mouse-tool', label: '점', pressed: 'false', controls: 'mouse-settings', icon: icon('point') })}${toolButton({ id: 'fill-tool', label: '칠하기', ariaLabel: '구역 칠하기', pressed: 'false', controls: 'fill-options', icon: icon('fill') })}
          <span class="toolbar-separator" aria-hidden="true"></span>
          ${toolButton({ id: 'duplicate-tool', label: '복제', pressed: 'false', controls: 'duplicate-options', command: true, icon: icon('duplicate') })}${toolButton({ id: 'sum-tool', label: '합치기', ariaLabel: '수직합·수평합 열기', title: '수직합·수평합', pressed: 'false', controls: 'sum-options', command: true, icon: icon('sum') })}
          <button type="button" id="delete-selection" class="tool tool-command tool-danger" aria-label="선택한 도형 삭제" title="선택한 도형 삭제 (Delete)" disabled><span class="tool-icon">${icon('trash')}</span><span id="delete-selection-label" class="tool-label">삭제</span></button>
        </div>
        <div class="editor-status" role="status"><span id="editor-mode" class="status-mode">선택·이동</span><span id="editor-status-detail" class="status-detail"></span></div>
        ${iconButton({ id: 'grid-toggle', icon: icon('grid'), label: '격자 표시', title: '격자 표시 전환', pressed: true, className: 'grid-toggle' })}
      </div>`;

const creationInspector = () => `
        <div id="creation-inspector" hidden><section id="line-options" class="panel-stack" aria-label="직선 그리기 설정" hidden>
          ${lineShapeControls()}
          ${switchField({ id: 'line-snap-toggle', label: '마우스 보정', checked: true })}
          ${hint('Shift: 수평·수직 · Alt: 보정 생략')}
        </section><section id="sketch-options" class="panel-stack" aria-label="자유 곡선 그리기" hidden>
          ${selectField({ id: 'sketch-mode', label: '가운데 방향', options: [['auto', '자동'], ['horizontal', '수평 · ∪ ∩'], ['vertical', '수직 · 옆으로']] })}
          ${hint('시작점 → 끝점 → 지나는 점', { id: 'sketch-step', live: true })}
          ${hint('세 번째 점을 직선 위에 찍으면 접합니다. Alt: 자유 배치 · Esc: 취소')}
          ${panelSection('무차별곡선', `${checkField({ id: 'indifference-opposite-new', label: '반대 방향' })}<div class="library indifference-library">
            ${libraryItem({ attr: 'data-add-indifference', value: 'cobb-douglas', label: '콥더글라스', path: 'M7 3C8 20 17 24 43 26' })}
            ${libraryItem({ attr: 'data-add-indifference', value: 'substitutes', label: '완전대체재', path: 'M6 4L43 27' })}
            ${libraryItem({ attr: 'data-add-indifference', value: 'complements', label: '완전보완재', path: 'M12 3V24H44' })}
            ${libraryItem({ attr: 'data-add-indifference', value: 'quasilinear', label: '준선형효용', path: 'M5 3Q12 19 43 26M5 10Q12 26 43 33' })}
          </div>`, ' role="group" aria-label="무차별곡선 모음"')}
          ${panelSection('기본 곡선', `<div class="library">
            ${libraryItem({ attr: 'data-add-indifference', value: 'ppc', label: 'PPC', path: 'M6 5C28 5 42 13 42 28' })}
            ${libraryItem({ attr: 'data-add-indifference', value: 'rectangular-hyperbola', label: '직각 쌍곡선', path: 'M7 3C8 20 17 24 43 26' })}
            ${libraryItem({ attr: 'data-add-curve', value: 'descending', label: '우하향', path: 'M5 5Q13 26 43 27', id: 'curve-tool', ariaLabel: '우하향 곡선 추가' })}
            ${libraryItem({ attr: 'data-add-curve', value: 'ascending', label: '우상향', path: 'M5 27Q27 26 43 5', id: 'ascending-curve-tool', ariaLabel: '우상향 곡선 추가' })}
          </div>`, ' role="group" aria-label="기본 곡선 빠른 추가"')}
        </section><section id="mouse-settings" class="panel-stack" aria-label="점 도구 설정" hidden>
          ${switchField({ id: 'point-snap-toggle', label: '마우스 조정', checked: true })}
          <details class="disclosure"><summary>추가 설정</summary><div class="panel-stack">
            ${switchField({ id: 'point-tool', label: '점 생성', checked: true, describedBy: 'point-create-hint' })}
            ${hint('활성화 시 좌클릭하면 점이 생성됩니다.', { id: 'point-create-hint' })}
            ${switchField({ id: 'point-coordinates-toggle', label: '좌표 함께 표시' })}
          </div></details>
        </section><section id="fill-options" class="panel-stack" aria-label="구역 칠하기 설정" hidden>
          ${fillControls('paint')}
        </section></div>`;

const operationInspector = () => `
        <div id="operation-inspector" hidden><section id="duplicate-options" class="panel-stack" aria-label="복제 설정" hidden>
          ${selectField({ id: 'duplicate-target', label: '대상', options: [['', '도형 선택']] })}
          <div id="duplicate-slope-options" class="panel-stack" hidden>
            <h3 class="section-title">기울기</h3>
            ${segmented({ label: '복제 기울기', className: 'segmented-list', items: [
              { data: { 'copy-factor': '1' }, label: '그대로', meta: '×1 · 평행', pressed: true },
              { data: { 'copy-factor': '2' }, label: '더 가파르게', meta: '×2' },
              { data: { 'copy-factor': '0.5' }, label: '더 완만하게', meta: '×½' },
            ] })}
          </div>
          <p id="duplicate-preview" class="hint"></p>
          ${checkField({ id: 'duplicate-children', label: '하위 항목 함께', checked: true, rowId: 'duplicate-children-row', hidden: true })}
          ${button({ id: 'duplicate-action', label: '복제', variant: 'primary', block: true, disabled: true })}
          ${hint('', { id: 'duplicate-status', live: true })}
        </section><section id="sum-options" class="panel-stack" aria-label="수직합·수평합 설정" hidden>
          ${selectField({ id: 'sum-direction', label: '방향', options: [['vertical', '수직합 · y를 더하기'], ['horizontal', '수평합 · x를 더하기']] })}
          <div id="sum-sources" class="sum-sources" role="group" aria-label="합에 사용할 직선·곡선"></div>
          ${checkField({ id: 'sum-nonnegative', label: '음수 기여분은 0으로', checked: true })}
          ${hint('원본 수정 시 자동 갱신 · 원본 삭제 시 합도 삭제')}
          ${button({ id: 'sum-action', label: '합 추가', variant: 'primary', block: true, disabled: true })}
          ${hint('', { id: 'sum-status', live: true })}
        </section></div>`;

const slopePresets = () => segmented({ label: '기울기 프리셋', className: 'slope-presets', items: [
  { data: { slope: '-1' }, ariaLabel: '기울기 −1', title: '기울기 −1', label: '−1', glyph: glyph('<path d="M8 1.5 24 10.5"/>') },
  { data: { slope: '0' }, ariaLabel: '기울기 0', title: '기울기 0', label: '0', glyph: glyph('<path d="M6 6H26"/>') },
  { data: { slope: '1' }, ariaLabel: '기울기 1', title: '기울기 1', label: '1', glyph: glyph('<path d="M8 10.5 24 1.5"/>'), pressed: true },
  { data: { slope: 'vertical' }, ariaLabel: '수직선', title: '수직선', label: '수직', glyph: glyph('<path d="M16 1V11"/>') },
] });

const sketchShapes = () => segmented({ label: '자유 곡선 모양', className: 'sketch-shapes', items: [
  { data: { 'sketch-shape': 'cup' }, ariaLabel: '아래로 볼록 ∪', title: '∪', glyph: glyph('<path d="M8 1.5c0 5.5 3.5 9 8 9s8-3.5 8-9"/>') },
  { data: { 'sketch-shape': 'cap' }, ariaLabel: '위로 볼록 ∩', title: '∩', glyph: glyph('<path d="M8 10.5c0-5.5 3.5-9 8-9s8 3.5 8 9"/>') },
  { data: { 'sketch-shape': 'left' }, ariaLabel: '왼쪽으로 볼록 ⊂', title: '⊂', glyph: glyph('<path d="M21 1.5h-4.5a4.5 4.5 0 0 0 0 9H21"/>') },
  { data: { 'sketch-shape': 'right' }, ariaLabel: '오른쪽으로 볼록 ⊃', title: '⊃', glyph: glyph('<path d="M11 1.5h4.5a4.5 4.5 0 0 1 0 9H11"/>') },
] });

const selectionInspector = () => `
        <div id="selection-inspector" hidden><section id="object-settings" class="object-settings panel-stack" aria-label="도형 설정" hidden>
          <div class="name-heading"><label for="object-name" class="field-label">이름</label>${button({ id: 'delete-object', label: '삭제', icon: icon('trash'), variant: 'danger', size: 'sm', ariaLabel: '선택한 항목 삭제', title: '삭제 (Delete)' })}</div>
          <input id="object-name" class="input" type="text" maxlength="80" autocomplete="off" />
          <details class="disclosure"><summary>분류</summary><div class="panel-stack">${selectField({ id: 'object-parent', label: '상위 항목', options: [['', '최상위']] })}</div></details>
          <div id="binding-settings" class="panel-stack" hidden><p id="binding-description" class="hint"></p>${button({ id: 'detach-binding', label: '연결 해제', block: true })}</div>
          <div id="sum-selected-settings" class="panel-stack" hidden>
            <p id="sum-selected-description" class="hint"></p>
            ${checkField({ id: 'sum-selected-nonnegative', label: '음수 기여분은 0으로' })}
            ${hint('', { id: 'sum-selected-status', live: true })}
          </div>
        </section><section id="line-settings" class="panel-stack" aria-label="직선 설정" hidden>
          <div class="equation-row"><div id="equation-value" class="equation-value" aria-label="직선의 식">y = x</div>${iconButton({ id: 'reset-line', icon: icon('reset'), label: '기울기 초기화' })}</div>
          <div class="range-field"><div class="range-head"><label for="slope-slider">기울기 <i class="math">m</i></label><input id="slope-input" class="input input-number value-input" type="number" step="any" value="1" aria-label="기울기 직접 입력" /></div>
          <input id="slope-slider" class="range" type="range" min="-90" max="90" step="0.01" value="45" />
          <div class="range-labels" aria-hidden="true"><span>−∞</span><span>0</span><span>+∞</span></div></div>
          ${slopePresets()}
          <div id="line-shape-selected" class="panel-stack">${lineShapeControls()}</div>
        </section><section id="curve-settings" class="panel-stack" aria-label="곡선 설정" hidden>
          <div class="equation-row"><div id="curve-title" class="curve-title">우하향</div>${iconButton({ id: 'reset-curve', icon: icon('reset'), label: '휘어짐 초기화' })}</div>
          ${segmented({ label: '곡선 방향', className: 'curve-presets', items: [
            { data: { 'curve-variant': 'ascending' }, label: '우상향' },
            { data: { 'curve-variant': 'descending' }, label: '우하향', pressed: true },
          ] })}
          ${rangeField({ id: 'bend-slider', label: '휘어짐', min: 0, max: 100, step: 1, value: 71, outputId: 'bend-value', output: '71%' })}
        </section><section id="indifference-settings" class="panel-stack" aria-label="곡선 설정" hidden>
          <div id="indifference-title" class="curve-title"></div>
          <p id="indifference-movement" class="hint"></p>
          ${checkField({ id: 'indifference-opposite', label: '반대 방향', rowId: 'indifference-opposite-row' })}
          ${selectField({ id: 'indifference-axis', label: '선형 축', rowId: 'indifference-axis-row', options: [['y', 'y축 · 세로 이동'], ['x', 'x축 · 가로 이동']] })}
          <div id="indifference-shape-row">${rangeField({ id: 'indifference-shape', label: '휘어짐', labelId: 'indifference-shape-label', min: 0, max: 100, step: 0.1, value: 50 })}</div>
          <div id="ppc-radii" class="panel-stack" hidden>
            ${numberField({ id: 'ppc-radius-x', label: '가로 반지름', min: 0.1, max: 100, step: 0.1 })}
            ${numberField({ id: 'ppc-radius-y', label: '세로 반지름', min: 0.1, max: 100, step: 0.1 })}
          </div>
        </section><section id="sketch-settings" class="panel-stack" aria-label="자유 곡선 설정" hidden>
          ${sketchShapes()}
          <details class="disclosure"><summary>휘어짐 조절</summary><div class="panel-stack">${rangeField({ id: 'sketch-left', label: '시작 쪽 휘어짐', min: 5, max: 200, step: 1, value: 50 })}
          ${rangeField({ id: 'sketch-right', label: '끝 쪽 휘어짐', min: 5, max: 200, step: 1, value: 50 })}</div></details>
          ${checkField({ id: 'sketch-minimum', label: '최저점 표시' })}
        </section><section id="fill-settings" class="panel-stack" aria-label="구역 설정" hidden>
          ${fillControls('edit')}${hint('선과 별도로 이동·삭제할 수 있습니다.')}
        </section><section id="point-settings" class="point-settings panel-stack" aria-label="점 설정" hidden>
          ${switchField({ id: 'point-show-coordinates', label: '좌표 표시' })}
          ${checkField({ id: 'point-line-follow', label: '점을 따라가기', checked: true })}
          ${button({ id: 'point-through-line', label: '이 점을 지나는 직선', icon: icon('line'), block: true })}
        </section></div>`;

const inspector = () => `
    <aside class="tools-panel" aria-labelledby="inspector-title">
      <section class="inspector">
        <div class="inspector-heading"><h2 id="inspector-title" class="panel-title">선택 항목</h2>${iconButton({ id: 'finish-tool', icon: icon('close'), label: '작업 닫고 선택 도구로', title: '선택으로 돌아가기 (Esc)', hidden: true })}</div>
        <p id="inspector-empty" class="empty-state">빈 공간을 드래그해 여러 도형을 선택합니다.</p>
        <section id="multi-selection-inspector" class="panel-stack" aria-label="여러 도형 선택" hidden>
          <ul id="multi-selection-list" class="multi-selection-list"></ul>
          ${hint('Ctrl+클릭: 선택 추가·해제')}
          <button type="button" id="delete-multiple" class="btn btn-danger btn-block">선택한 도형 삭제</button>${button({ id: 'clear-selection', label: '선택 해제', block: true })}
        </section>${creationInspector()}${operationInspector()}${selectionInspector()}
      </section>
      <section class="object-section" aria-label="도형 목록">
        <div class="object-heading"><h2 class="panel-title">도형 <span id="object-count" class="count">0</span></h2>${iconButton({ id: 'add-group', icon: icon('folder'), label: '폴더 추가' })}</div>
        <p id="objects-empty" class="empty-state">아직 도형이 없습니다.</p><div id="object-list" class="object-list" role="tree" aria-multiselectable="true" aria-label="그래프 목록"></div>
        <div id="object-root-drop" class="root-drop-zone" hidden>최상위로 이동</div>
      </section>
    </aside>`;

const dialogs = () => `
  <dialog id="graph-settings-dialog" class="dialog graph-settings-dialog" aria-labelledby="graph-dialog-title">
    <div class="dialog-heading"><h2 id="graph-dialog-title">그래프 설정</h2>${iconButton({ id: 'close-graph-settings', icon: icon('close'), label: '그래프 설정 닫기' })}</div>
    <section class="dialog-section panel-stack" aria-labelledby="diagram-settings-title">
      <h3 id="diagram-settings-title" class="section-title">선택한 그래프</h3>
      ${textField({ id: 'diagram-name', label: '이름' })}
      ${selectField({ id: 'diagram-quadrant', label: '포맷', options: [['first', '1사분면'], ['upper', '1·2사분면'], ['all', '전체 사분면'], ['face', '대면'], ['stacked', '상하 2단'], ['edgeworth', '에지워드 상자']] })}
      ${selectField({ id: 'diagram-x-direction', label: 'x 증가', options: [['right', '오른쪽 →'], ['left', '왼쪽 ←']] })}
      ${selectField({ id: 'diagram-y-direction', label: 'y 증가', options: [['up', '위쪽 ↑'], ['down', '아래쪽 ↓']] })}
    </section>
    <section class="dialog-section panel-stack" aria-labelledby="axes-title">
      <h3 id="axes-title" class="section-title">축</h3>
      ${textField({ id: 'horizontal-axis-name', label: '수평축', value: 'x', placeholder: 'x' })}
      ${textField({ id: 'vertical-axis-name', label: '수직축', value: 'y', placeholder: 'y' })}
      <div id="face-settings" class="panel-stack" hidden>${textField({ id: 'face-axis-name', label: '맞은편 수평축', value: 'x′' })}</div>
      <div id="stacked-settings" class="panel-stack" hidden>
        ${numberField({ id: 'lower-height', label: '아래 그래프 높이', min: 2, max: 40, step: 0.5 })}
        ${textField({ id: 'lower-axis-x', label: '아래 수평축' })}
        ${textField({ id: 'lower-axis-y', label: '아래 수직축' })}
      </div>
      <div id="edgeworth-settings" class="panel-stack" hidden>
        ${numberField({ id: 'box-width', label: '가로 총량', min: 1, max: 100, step: 0.5 })}
        ${numberField({ id: 'box-height', label: '세로 총량', min: 1, max: 100, step: 0.5 })}
        ${textField({ id: 'box-axis-x', label: 'B 수평축' })}
        ${textField({ id: 'box-axis-y', label: 'B 수직축' })}
      </div>
      ${switchField({ id: 'axis-gap-toggle', label: '축에서 선 띄우기', controls: 'axis-gap-settings' })}
      <div id="axis-gap-settings" class="axis-gap-settings" hidden>
        ${rangeField({ id: 'axis-gap-slider', label: '간격', min: 0.25, max: 2, step: 0.05, value: 0.75, outputId: 'axis-gap-value', output: '0.75', ariaLabel: '축과 선 사이 간격' })}
      </div>
    </section>
    <div class="dialog-footer">${button({ id: 'clear-all', label: '도형 전체 삭제', icon: icon('trash'), variant: 'danger', ariaLabel: '선택한 그래프의 도형 전체 삭제', disabled: true })}<span class="footer-spacer"></span>${button({ id: 'done-graph-settings', label: '완료', variant: 'primary' })}</div>
  </dialog>
  <dialog id="quadrant-dialog" class="dialog quadrant-dialog" aria-labelledby="quadrant-title">
    <div class="dialog-heading"><h2 id="quadrant-title">작업 영역</h2>${iconButton({ id: 'close-workspace', icon: icon('close'), label: '작업 영역 닫기' })}</div>
    <section class="dialog-section">
      <h3 class="section-title">포맷</h3>
      <div class="quadrant-choices">
        ${choice('first', '1사분면', '<rect x="32" y="8" width="24" height="24" class="quadrant-fill"/><path d="M8 32h48M32 8v48"/>', true)}
        ${choice('upper', '1·2사분면', '<rect x="8" y="8" width="48" height="24" class="quadrant-fill"/><path d="M8 32h48M32 8v48"/>')}
        ${choice('all', '전체 사분면', '<rect x="8" y="8" width="48" height="48" class="quadrant-fill"/><path d="M8 32h48M32 8v48"/>')}
        ${choice('face', '대면', '<rect x="8" y="8" width="48" height="24" class="quadrant-fill"/><path d="M8 32h48M32 32V8M12 28l-4 4 4 4M52 28l4 4-4 4"/>')}
        ${choice('stacked', '상하 2단', '<path d="M12 6v22h44M12 36v22h44M9 9l3-3 3 3M9 39l3-3 3 3"/><path d="M34 14v40" stroke-dasharray="3 3"/>')}
        ${choice('edgeworth', '에지워드 상자', '<rect x="10" y="14" width="44" height="36" class="quadrant-fill"/><path d="M10 14h44v36H10zM10 42v8h8M46 14h8v8"/>')}
      </div>
      <div id="workspace-box-size" class="box-size-fields" hidden>
        ${numberField({ id: 'workspace-box-width', label: '가로 총량', min: 1, max: 100, step: 0.5, value: 10, required: true })}
        ${numberField({ id: 'workspace-box-height', label: '세로 총량', min: 1, max: 100, step: 0.5, value: 8, required: true })}
      </div>
    </section>
    <div class="dialog-footer"><span class="footer-spacer"></span>${button({ id: 'apply-workspace', label: '시작', variant: 'primary' })}</div>
  </dialog>
  <dialog id="json-dialog" class="dialog json-dialog" aria-labelledby="json-title">
    <div class="dialog-heading"><h2 id="json-title">그림 저장 · JSON</h2>${iconButton({ id: 'close-json', icon: icon('close'), label: 'JSON 닫기' })}</div>
    <textarea id="json-output" class="code-output" aria-label="JSON 출력" readonly spellcheck="false"></textarea>
    <div class="dialog-footer"><span class="footer-spacer"></span>${button({ id: 'copy-json', label: '복사' })}${button({ id: 'download-json', label: '다운로드', icon: icon('export'), variant: 'primary' })}</div>
  </dialog>`;

export function appShell() {
  return `${header()}
  <main class="app-layout">
    <section class="workspace" aria-label="그래프">${toolbar()}
      <div class="canvas-card"><div class="diagram-grid" id="graph"></div></div>
    </section>${inspector()}
  </main>${dialogs()}`;
}
