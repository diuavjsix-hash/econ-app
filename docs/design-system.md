# 디자인 시스템

2026-11-08 디자인 개편의 기준입니다. 이전 화면은 보라색 강조(`#6068e8`)가 버튼·선택·슬라이더·도형 기본색에 모두 쓰였습니다. 카드 안에 다시 카드가 들어간 구조였고, 10~11px의 옅은 회색 글씨가 많았습니다. CSS 두 파일에는 같은 버튼을 여러 번 덮어쓴 규칙과 하드코딩 색 100여 개가 섞여 있었습니다. 이번 개편은 **보이는 모양**과 **새 기능이 같은 모양을 물려받는 구조**를 함께 바꿉니다.

## 레퍼런스와 가져온 원칙

| 레퍼런스 | 가져온 것 | 적용한 곳 |
| --- | --- | --- |
| Figma UI3 속성 패널 | 11–12px 라벨, 30px 컨트롤 행, 구분선으로만 나눈 섹션, 회색 트랙 위에 흰 칸이 올라오는 분할 선택 | 오른쪽 편집 패널, `.segmented`, `.field` |
| Linear | 중립 회색 바탕에 강조색 하나, 1px 구분선, 그림자는 떠 있는 요소에만 사용 | 토큰 체계, 헤더·패널 구분 |
| tldraw · Excalidraw | 캔버스가 주인공인 배치, 작은 도구막대 하나, 현재 도구만 진하게 표시 | 작업 영역, `.toolbar`·`.tool[aria-pressed]` |
| Desmos | 연한 격자 위의 진한 축, 구별되는 채도 있는 선 색 | 캔버스 격자·축, 도형 팔레트 |
| 경제학 교과서 도판(수요·공급 그림) | 흰 종이에 잉크 색 선, 우하향(수요)은 파랑·우상향(공급)은 빨강, 수식은 이탤릭 세리프 | `ROLE_COLORS`, 직선 식 표시(`--font-math`) |
| Pretendard(토스 등 한국어 제품 UI) | 한글·라틴 숫자의 균형, 가변 굵기 | `--font-sans` |

방향을 한 줄로 줄이면 **"종이와 잉크"**입니다. 화면 틀은 따뜻한 흑연 회색으로 물러나고, 색은 사용자가 그린 도형이 가집니다.

## 강조 규칙

- **잉크(`--bg-inverse`, gray-900)**: 지금 켜진 도구와 주요 실행 버튼(저장·완료·시작·복제·합 추가)에 씁니다. 한 화면에 두세 개를 넘지 않습니다.
- **강조색(`--accent`, 잉크 파랑)**: 값을 나타내는 상태(스위치 켜짐, 체크, 슬라이더 진행)와 캔버스의 선택·맞춤·드래그 선택 상자에만 씁니다. 버튼 배경으로 쓰지 않습니다.
- **위험(`--danger`)**: 삭제 계열만 씁니다. 빨간 배경은 쓰지 않고 글자·옅은 배경 정도로 표시합니다.
- 슬라이더와 직선 식은 선택한 도형의 색(`--selected-color`)을 따릅니다. 이 값은 도구가 실행 중에 지정합니다.
- **글자 크기(2026-11-08 조정)**: 사용자 의견("글씨가 너무 작다")에 따라 글자 단계를 한 칸씩 키웠습니다. `--text-2xs` 11 · `--text-xs` 12 · `--text-sm` 13 · `--text-md` 14(본문) · `--text-lg` 16 · `--text-xl` 22 · `--text-equation` 19px입니다. 커진 글자에 맞춰 컨트롤 높이(28/32/38px)와 편집 패널 폭(304px)도 늘렸습니다. 글자 크기는 이 토큰으로만 바꿉니다.

## 파일과 책임

| 파일 | 책임 |
| --- | --- |
| `src/ui/tokens.css` | 원시 색·글꼴·크기·간격·모서리·그림자·움직임 값을 쓰는 **유일한 파일**. 의미 토큰(`--text-secondary`, `--border`, `--canvas-axis` 등)을 정의합니다. |
| `src/ui/components.css` | 공통 컴포넌트: `.btn`(secondary/primary/ghost/danger, sm, block), `.icon-btn`, `.toolbar`/`.tool`, `.segmented`/`.segment`, `.field`/`.input`/`.select`, `.range-field`/`.range`, `.switch`, `.check`, `.swatch`, `.disclosure`, `.choice`, `.dialog`, `.panel-stack`/`.panel-section`, `.hint`. |
| `src/graph/snap-feedback.css` | 맞춤 표시 전용(기존 규칙 유지). 색은 `--snap-color` 토큰을 읽습니다. |
| `src/styles.css` | 앱 배치(헤더·작업 영역·패널·도형 트리·대화상자 내용)와 캔버스 SVG 표현 |
| `src/ui/controls.js` | 위 컴포넌트의 마크업 생성기: `button`, `iconButton`, `toolButton`, `segmented`, `switchField`, `checkField`, `selectField`, `textField`, `numberField`, `rangeField`, `hint` |
| `src/ui/icons.js` | 유일한 아이콘 모음(24px 격자·1.75 선)과 도형 트리용 16px 기호 `objectGlyph` |
| `src/ui/shell.js` | 정적 화면 배치. 컨트롤 마크업은 직접 쓰지 않고 위 생성기로만 조합합니다. |
| `src/models/palette.js` | 문서에 저장되는 도형 기본색: `INK`, `STROKE_CYCLE`, `SUM_CYCLE`, `FILL_PALETTE`, `ROLE_COLORS` |

`index.html`은 `tokens → components → snap-feedback → styles` 순서로 불러옵니다. 순서가 바뀌면 덮어쓰기 관계가 달라지므로 검사가 실패합니다.

## 새 기능을 추가할 때

1. 버튼·입력·전환 스위치는 `controls.js` 생성기로 만듭니다. 기존 생성기로 표현할 수 없을 때만 `components.css`에 컴포넌트를 추가하고 생성기도 함께 추가합니다. 도구 전용 버튼 스타일을 `styles.css`에 만들지 않습니다.
2. 아이콘은 `icons.js`의 `PATHS`에 24px 격자로 추가합니다. 마크업에 SVG를 직접 붙여 넣지 않습니다(분할 선택의 32×12 모양 기호는 `shell.js`의 `glyph`).
3. 새 색이 필요하면 의미 토큰을 `tokens.css`에 추가합니다. 도형 기본색은 `palette.js`의 `ROLE_COLORS`에 역할 이름으로 추가하고 코드에서는 역할 이름으로 읽습니다.
4. 편집 패널은 `.panel-stack`(세로 12px 간격) 안에 놓고, 소제목이 필요한 묶음은 `.panel-section` + `.section-title`을 씁니다. 설명은 `.hint` 한 줄을 넘기지 않습니다.
5. 캔버스 SVG 요소의 색·굵기는 `styles.css`의 Canvas 구역에서 `--canvas-*` 토큰과 도형별 실행 변수(`--line-color`, `--point-color`, `--ruler-color`)로 정합니다.

## 강제 검사

`tests/design-system.test.js`가 다음을 확인합니다.

- `tokens.css` 밖의 CSS에 색 리터럴(`#hex`, `rgb()`, `white` 등)이 없습니다.
- CSS가 읽는 모든 `var(--…)`가 토큰·스타일시트에 정의되어 있거나, 도구가 실행 중에 지정하는 변수 목록에 있습니다.
- `palette.js` 밖의 JS에 16진 색이 없습니다. 곡선 종류·프리셋의 기본색은 `ROLE_COLORS`에서 옵니다.
- 토큰의 `--ink-blue`·`--ink-red`가 팔레트 값과 같습니다.
- 스타일시트 불러오는 순서를 검사합니다.
- `appShell()`의 모든 버튼이 공통 컴포넌트 클래스와 `type="button"`을 가지고 ID가 중복되지 않습니다. 이전 임시 클래스(`export-button`, `tool-button` 등)는 다시 쓰지 않습니다.
- 모든 아이콘이 같은 격자·선 굵기를 쓰고, 없는 이름은 오류를 냅니다.

## 알려진 제한

- 어두운 테마는 없습니다. 캔버스를 흰 종이로 보고 문서에 저장된 도형색을 그대로 쓰므로 `color-scheme: light`로 고정했습니다.
- Pretendard는 jsDelivr CDN에서 불러옵니다. 오프라인에서는 시스템 글꼴(Segoe UI·맑은 고딕·Apple SD Gothic Neo)로 대체됩니다.
- 팔레트 변경은 새 도형에만 적용됩니다. 이전에 저장한 JSON의 색은 그대로입니다.
- 비활성화된 자(ruler) UI는 화면에 없으므로 이번 컴포넌트 이전 대상에서 제외했습니다. 캔버스 표시 규칙만 토큰으로 옮겼습니다.
