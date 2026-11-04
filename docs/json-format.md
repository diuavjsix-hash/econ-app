# JSON 출력 형식 · schemaVersion 10

구현 기준은 `src/export.js`의 `serializeDocument(state)`입니다. 현재는 내보내기만 지원하며 JSON 불러오기 API와 UI는 없습니다. 화면에서 가려진 도형도 모두 내보냅니다.

구역 칠하기의 `fills` 컬렉션을 추가해 schemaVersion을 10으로 올렸습니다. 영역 선택의 `selectedIds`·단일 편집용 `selectedId`·드래그 사각형·선택 강조와 칠하기 도구/미리보기는 UI 상태이며 출력하지 않습니다.

공통 클래스 리팩터링 후에도 문서·undo·JSON은 일반 객체입니다. 클래스 인스턴스·contactGeometry 능력·접점 후보/강조·기하 캐시 키·입력 컴포넌트 상태는 저장하지 않습니다. 곡선끼리 이동 자석은 허용 이동으로 보정한 실제 곡선 좌표만 반영하며 새 binding을 만들지 않습니다. 점/점선을 그 접점에 배치하면 최종 수학 좌표를 저장하고 이후 곡선 이동을 따라가는 관계는 만들지 않습니다. 기존 직선↔자유 곡선의 명시적 접점 유지 binding은 별도 기능으로 유지합니다.

## 최상위 필드

### PPC·에지워드 상자의 추가 필드

기존 버전 10의 곡선·좌표계에 선택 필드를 추가하며 기존 종류의 출력은 유지합니다. `curves[].family='ppc'`는 원점 중심 양의 ¼타원입니다. `anchor`는 매개각 π/4인 점이고 `shape=1`은 공통 객체 형식 보존용입니다. `geometry`는 `{type:'ellipse-arc',center:{x:0,y:0},radii:{x:a,y:b},angleRange:[0,Math.PI/2],domain:'nonnegative',movement:...}`이며 a=anchor.x×√2, b=anchor.y×√2입니다. 실제 JSON의 angleRange에는 숫자가 출력됩니다. 표시 근사 선분은 출력하지 않습니다.

에지워드 포맷에서 `coordinateSystem.type='edgeworth'`, `totals:{width,height}`, `oppositeOrigin:{x:width,y:height}`, `oppositeAxisNames:{x,y}`, `oppositeXPositive`, `oppositeYPositive`를 추가합니다. 기본 A 원점/축 필드는 그대로이고 B 방향은 A와 반대입니다. 모든 도형은 A 기준 수학 좌표이며 B 기준 좌표가 필요하면 `{x:width-p.x,y:height-p.y}`로 계산할 수 있습니다. 화면 크기·상자 픽셀 크기는 저장하지 않습니다. 복원 구현 시 `[1]` 사분면만으로 일반 그래프와 구분하지 말고 type을 먼저 읽어야 합니다. 현재 앱은 JSON 불러오기를 제공하지 않습니다.

### 공통 필드

| 필드 | 설명 |
| --- | --- |
| `schemaVersion` | 현재 10. 독립된 칠한 구역 fills 추가; 기존 도형 자료 보존 |
| `activeDiagramId` | 최상위 도형·좌표계 필드가 가리키는 그래프 ID |
| `layout` | `preset`과 `slots`: `{diagramId, row, column}` 배열. 행·열은 0부터 시작 |
| `diagrams` | 숨겨진 그래프를 포함한 모든 그래프. 각각 `id`, `name`, 아래의 좌표계·도형 필드를 보유 |
| `coordinateSystem` | 원점 배치·사분면·방향·축 표시·축 이름 |
| `showGrid` | 격자 표시 여부 |
| `lines` | 모든 직선 |
| `curves` | 기본 곡선과 family가 있는 무차별곡선; 자유 곡선은 sketches에 별도 저장 |
| `sums` | 수직합·수평합의 방향·음수 처리·같은 그래프 원본 ID |
| `sketches` | 세 점 자유 곡선의 시작·끝·가운데 점·접선·양쪽 휘어짐·접점 관계 |
| `points` | 모든 점과 이름·좌표 표시 설정 |
| `dashedLines` | 모든 점선의 두 끝점·이름·색상·계층 |
| `fills` | 칠한 구역의 수학 좌표 다각형 rings·색·진하기·이동 기준점·계층 |
| `rulers` | 비활성화된 이전 자 자료 보존용 배열 |
| `groups` | 도형 없이 분류에 사용하는 폴더 |
| `objectOrder` | 모든 종류를 섞은 생성 순서의 ID 배열 |

최상위 `coordinateSystem`, `showGrid`, `lines`, `curves`, `sketches`, `sums`, `points`, `dashedLines`, `fills`, `rulers`, `groups`, `objectOrder`는 선택한 그래프의 사본입니다. 전체 문서는 `diagrams`와 `layout`으로 읽습니다. 배치를 줄여도 `diagrams`에서 삭제하지 않으며 `layout.slots`에 있는 그래프만 표시합니다. 다음 예시는 좌우 대면 배치입니다.

```json
{"preset":"face2","slots":[{"diagramId":"diagram-1","row":0,"column":0},{"diagramId":"diagram-2","row":0,"column":1}]}
```

각 그래프의 기본 `coordinateSystem.origin`과 `quadrants` 조합은 `bottom-left` / `[1]`, `bottom-center` / `[1,2]`, `center` / `[1,2,3,4]`입니다. 좌우 반전 시 `bottom-left`는 `bottom-right`로, 상하 반전 시 `bottom-*`는 `top-*`로 바뀌며 `center`는 유지합니다. `xPositive`는 `right` 또는 `left`, `yPositive`는 `up` 또는 `down`, `axesVisible`은 현재 항상 true입니다. `axisNames`의 x·y는 문자열이며 빈 문자열은 이름만 숨긴다는 뜻입니다.

객체 선택 상태(현재 그래프 ID 제외), 다음 ID 카운터, 화면 크기·배율, UI 입력 포커스, 마우스 선택(`mouseSelected`), 되돌리기·다시 실행 기록과 메타데이터(`canUndo`, `canRedo`, `historyRevision`)는 출력하지 않습니다. 복원 기능을 구현할 경우 사분면 조합에서 내부 `quadrantMode`를 결정하고 ID 카운터 충돌을 방지해야 합니다. 파일의 표시 메타데이터와 기하 데이터를 검증 없이 DOM에 삽입해서는 안 됩니다.

점·접선·절편 자석은 드래그 중 임시 위치 보정입니다. 자석 후보·강조·포착 상태는 내보내지 않으며 새 binding도 생성하지 않습니다. 이동을 마친 도형의 수학 좌표만 저장하고 드래그 전용 자료를 추가하지 않습니다. 현재 형식은 구역 칠하기를 포함한 10입니다.

## 칠한 구역 · 버전 10

최상위와 각 diagrams에 `fills` 배열을 저장합니다. 각 도형은 아래와 같습니다.

```json
{"id":"fill-1","type":"fill","name":"구역 A","label":"A","color":"#6068e8","opacity":0.24,"parentId":null,"anchor":{"x":0,"y":0},"rings":[[{"x":0,"y":0},{"x":6,"y":0},{"x":0,"y":6}]]}
```

rings는 유한한 수학 좌표로 된 닫힌 다각형들의 배열이며 각 배열은 마지막 점을 첫 점에 암묵적으로 잇습니다. 내부 구멍은 추가 ring으로 저장하고 SVG evenodd 규칙을 사용합니다. anchor는 모든 ring을 함께 옮기는 기준점이며 opacity는 0.1~0.6, color는 6자리 hex입니다. 같은 그래프의 objectOrder·parentId·이름·기록을 공유합니다. 경계 선/곡선에 대한 sourceIds/binding은 저장하지 않으며 **칠한 당시 모양을 독립적으로 유지**합니다. 선을 옮기거나 삭제해도 칠한 구역은 그대로 남습니다. 곡선 경계는 수학 좌표의 다각형 근사이며 정확한 면적 데이터나 픽셀 마스크가 아닙니다. `fillSelected`·자동 색/다음 글자·새 진하기·면 캐시·hover·열린 곳 안내는 내보내지 않습니다. fills가 없는 과거 문서는 빈 배열에 해당하지만 불러오기 기능은 아직 제공하지 않습니다.

선택적 `label`은 새 구역에 자동 부여하는 영어 대문자(A…Z→AA)이며 이름과 독립적입니다. 색과 글자를 생성 시 저장하므로 삭제/이동·이름 편집·undo/redo에서 유지됩니다. 다음 구역의 색/글자는 활성 그래프의 남은 구역에서 계산하되 선택한 결과만 실제 객체에 저장합니다. 글자의 내부 위치·폰트 크기는 화면에 맞춰 계산하며 출력하지 않습니다. label이 없는 이전 버전 10 도형은 표시 글자가 없는 구역으로 해석할 수 있습니다. 추가 필드는 기존 버전 10 도형 필드를 변경하지 않습니다.

## 축 간격

각 coordinateSystem.lineAxisGap은 `{enabled, distance}`입니다. 기본은 enabled=false, distance=0.75이고 거리 범위는 0.25~2 내부 좌표 단위입니다. 이 필드는 직선·곡선의 축 주변 표시만 자르는 설정이며 anchor/slope/제어점은 원본을 유지합니다. 축·점·독립 점선은 자르지 않습니다. 이전 출력에 이 필드가 없으면 기본값을 사용합니다.

## 이름과 계층

직선·기본/자유 곡선·합산·점·점선·칠한 구역·이전 자·폴더에는 `parentId`가 있습니다. null은 최상위이며 다른 항목 ID면 그 아래에 들어갑니다. 계층은 같은 그래프 안에서만 연결하고 순환을 허용하지 않습니다. 같은 상위 항목의 자식은 `objectOrder` 순서로 정렬합니다. 분류는 좌표를 바꾸지 않으며 `name`은 방향과 독립적입니다. 목록 접기·그리기 모드·점 보정 토글은 UI 상태여서 출력하지 않습니다. 일반 스냅은 보정된 좌표만 출력합니다. 명시적인 따라가기는 별도의 binding으로 아래에 기록합니다.

## 무차별곡선 · 버전 9

무차별곡선은 curves 배열의 type=curve 객체이며 family는 `cobb-douglas`, `substitutes`, `complements`, `quasilinear` 중 하나입니다. 기본 곡선 목록의 직각 쌍곡선도 같은 저장 형식을 공유하며 family는 `rectangular-hyperbola`입니다. 공통 id·name·color·parentId와 내부 좌표 anchor, shape를 저장합니다. 준선형에는 linearAxis(x/y)가 추가됩니다. geometry는 `{type:"indifference",domain:"nonnegative",movement:"이동 방식 표시"}`이며 기본 곡선의 variant/span/slope/bend·이차 제어점·접선 연장을 출력하지 않습니다. movement는 표시용이고 실제 기하는 family와 anchor/shape/linearAxis로 복원합니다.

`rectangular-hyperbola`는 `shape:1`을 유지하고 `x*y=anchor.x*anchor.y`, x,y>0으로 복원합니다. 두 축이 점근선이며 anchor는 곡선 위의 기준점입니다. 크기 조절·몸체 이동·복제는 anchor를 원점 기준으로 확대/축소하고 `shape`를 바꾸지 않습니다. 음수 가지나 점근선 이동은 저장하지 않습니다. JSON 10의 기존 객체 형식을 확장한 family 값이며 별도 컬렉션은 없습니다.

shape는 0.15~20이며 완전보완재의 기하는 shape 대신 꺾임 anchor의 비율을 사용합니다. 콥더글라스·완전보완재 anchor는 양수, 준선형의 비선형 축 anchor는 양수이고 선형 축 anchor는 음수도 가능합니다. 실제 표시 영역은 비음수 좌표입니다. 기하식과 이동·클리핑 명세는 [무차별곡선 설계](indifference-design.md)를 참고하십시오. 표시 근사·픽셀·자석 후보·효용/가격/소득 수치는 저장하지 않습니다.

## 자유 곡선과 따라가기 관계

각 그래프와 최상위 사본에 `sketches`를 기록합니다. 각 객체는 id·type='sketch'·name·color·parentId, 내부 좌표 start/end/anchor, 단위 방향 벡터 tangent, leftReach/rightReach, binding, geometry를 포함합니다. geometry.type='piecewise-quadratic-bezier'이고 controlPoints는 두 개의 [시작, 제어, 끝] 배열입니다. 렌더용 픽셀·근사 선분과 생성 도구 옵션은 출력하지 않습니다. 새 문서 형식에서 sketches가 없는 이전 출력은 빈 배열로 처리합니다(불러오기 기능은 아직 없음).

`showMinimum`은 선택적 boolean 표시 필드이며 생략하면 false입니다. true이면 원본 유한 곡선의 최저점 마커를 렌더합니다. 별도 points 항목·파생 좌표·최저점 binding은 만들지 않으며 현재 생성 문서에서 `kind:'minimum'` 관계는 지원하지 않습니다. JSON 버전은 10을 유지합니다.

start/end/anchor는 유한한 수학 좌표이고 서로 다른 점입니다. tangent는 단위 방향 벡터, leftReach/rightReach는 0.05~2입니다. 제어점 거리는 가운데 점부터 해당 끝점까지 거리 × reach이며, 두 구간은 가운데의 접선 방향을 공유합니다. 미분 크기의 일치·단조성·경제적 최적성은 저장 형식의 보장 조건이 아닙니다.

binding은 연결이 없을 때 null 또는 생략하고 다음 종류를 지원합니다. 모든 sourceId는 같은 그래프의 객체를 참조하며 parentId와 독립적이고 순환하지 않습니다.

```json
{"kind":"tangent","sourceId":"line-1","parameter":1.5,"direction":{"x":1,"y":0}}
```

자유 곡선의 tangent 관계는 원본 직선의 기준점 + 정규화 방향 × parameter를 가운데 점으로 사용합니다. direction은 마지막 평가 때의 원본 방향입니다. 수직선을 넘는 회전에서 정규화 방향 부호가 뒤집히면 parameter 부호도 뒤집어 접점이 반대편으로 튀지 않게 합니다. 직선이 수직일 때도 기울기 null을 그대로 읽습니다. 원본 방향과 같은 접선 직선을 공유하며 기존 tangent와 연속적인 방향 부호를 선택합니다. 시작점·끝점은 원래 좌표를 유지합니다.

```json
[
  {"kind":"through-point","sourceId":"point-1"}
]
```

line의 through-point 관계는 일반 점의 anchor를 기준점으로 사용하며 slope는 독립적으로 보존합니다. 원본 삭제나 연결 해제는 마지막 좌표·방향을 유지하고 관계만 제거합니다. 내보낸 anchor와 제어점은 관계를 평가한 현재 결과도 포함하므로 연결을 구현하지 않는 소비자도 해당 순간의 그림을 복원할 수 있습니다. 최저점은 곡선의 표시 옵션이며 이 관계의 원본 점을 생성하지 않습니다.

## 수직합·수평합

최상위와 각 diagrams에 `sums` 배열을 포함합니다. 객체는 아래처럼 저장합니다.

```json
{"id":"sum-1","type":"sum","name":"수평합 01","color":"#b67836","parentId":null,"direction":"horizontal","nonnegative":true,"sourceIds":["line-1","curve-1"]}
```

direction은 vertical(같은 x에서 y를 더함) 또는 horizontal(같은 y에서 x를 더함)입니다. sourceIds는 같은 그래프의 서로 다른 직선·기본 곡선 두 개 이상(무차별곡선 제외)을 참조하며, 합을 다시 원본으로 참조할 수 없습니다. 원본은 같은 문서의 lines/curves에서 복원합니다. nonnegative=true는 독립 변수를 0 이상으로 제한하고 각각의 음수 기여분을 0으로 처리합니다. false는 음수까지 그대로 더합니다. 기울기·절편·anchor·제어점·화면 근사 선분은 합에 저장하지 않습니다. 표시 시 원본을 평가해 계산하므로 원본의 이후 변경을 반영합니다.

원본 삭제 시 의존하는 합도 함께 삭제됩니다. 원본이 수직합에 사용할 수 없는 수직선 또는 수평합에 사용할 수 없는 수평선으로 변경된 경우 합의 참조를 유지하며 표시만 중단합니다. 상위 항목(parentId)과 계산 원본(sourceIds)은 별개의 관계입니다. 합 이름·분류·nonnegative 변경과 삭제는 일반 도형처럼 undo/redo 대상입니다. 6 이하 문서에는 sums가 없으므로 향후 불러오기 구현 시 빈 배열로 처리합니다.

## 직선

| 필드 | 값 / 의미 |
| --- | --- |
| `id`, `type`, `name`, `color` | ID, `'line'`, 표시 이름, 색상 |
| `anchor` | 직선 위 기준점 `{x,y}` |
| `slope` | 유한 숫자 또는 수직선의 null |
| `intercept` | y절편; 수직이거나 계산이 숫자 범위를 넘으면 null |
| `vertical` | 수직선 여부 |
| `xIntercept` | 수직선의 x값; 일반 직선에서는 null (일반 직선의 실제 x절편을 계산한 필드가 아님) |
| `implicit` | `{a,b,c}` · `a*x + b*y + c = 0` |

축 반전은 화면 투영만 바꾸며 `anchor`, `slope`, 곡선 제어점과 수직선 표현을 변환하지 않습니다. 좌표는 각 그래프의 축 증가 방향을 기준으로 해석합니다.

일반 직선은 `y - anchor.y = slope * (x - anchor.x)`이고 수직선은 `x = anchor.x`입니다. `implicit`은 정규화된 방향으로 계산하여 수직선과 매우 큰 유한 기울기도 표현합니다. 계수의 상수배는 동일한 직선을 나타냅니다. null 기울기를 0이나 큰 유한 값으로 바꾸지 마십시오.

## 곡선

| 필드 | 값 / 의미 |
| --- | --- |
| `id`, `type`, `name`, `color` | ID, `'curve'`, 표시 이름, 색상 |
| `variant` | `'descending'`(우하향) 또는 `'ascending'`(우상향) |
| `anchor` | 곡선의 t=0 기준점 `{x,y}` |
| `span` | 가운데 이차 구간의 양의 반폭; 해당 구간의 x 범위는 anchor.x ± span |
| `slope` | 중심 기울기; 현재 우하향 −0.75 / 우상향 +0.75 |
| `bend` | 0~0.35; 기본 0.25 |
| `geometry.type` | `'quadratic-bezier'` |
| `geometry.controlPoints` | 수학 좌표의 시작점·제어점·끝점 순서 |
| `geometry.extensions` | 양 끝을 이어 그리는 반직선 정보; `type: 'tangent-rays'`, `rays`는 왼쪽·오른쪽 순서 |

곡선 가운데 구간은 `-1 ≤ t ≤ 1`에서 다음과 같습니다.

```text
x(t) = anchor.x + span * t
y(t) = anchor.y + span * (slope * t + bend * t²)
```

제어점 배열 `[A,B,C]`는 다음과 같습니다.

```text
A = (anchor.x - span, anchor.y + span * (-slope + bend))
B = (anchor.x,        anchor.y - span * bend)
C = (anchor.x + span, anchor.y + span * ( slope + bend))
```

이 제어점을 사용한 이차 베지어 `P(u) = (1-u)²A + 2u(1-u)B + u²C`, `0 ≤ u ≤ 1`은 `t = 2u - 1`인 위 곡선과 같습니다. 화면에서 SVG를 재현할 때는 y축 방향을 뒤집는 좌표 변환을 적용합니다. 슬라이더 표시값은 `round(bend / 0.35 * 100)`이므로 기본 0.25는 71%로 보입니다.

양 끝은 해당 끝점의 접선 방향으로 이어집니다. `geometry.extensions.rays`의 각 항목은 `{anchor, direction}`이며 `anchor + λ * direction`, `λ ≥ 0`인 반직선을 뜻합니다.

```text
왼쪽: anchor = A, direction = (-1, 2*bend - slope)
오른쪽: anchor = C, direction = (1, slope + 2*bend)
```

중앙의 이차 구간과 두 반직선은 위치와 기울기가 이어집니다. 표시할 때 세 구간을 작업 영역 경계에서 잘라 연결합니다. 기존 schemaVersion 2의 제어점 필드는 유지하며 `extensions`를 추가했습니다. 이 필드가 없는 이전 출력은 가운데의 유한 이차 구간만 기록한 문서입니다.

## 점과 폴더

점은 `type: 'point'`, `id`, `name`, `color`, `parentId`, 내부 좌표 `anchor: {x,y}`, `showCoordinates`를 포함합니다. 이름을 비우면 그래프의 이름만 숨깁니다. `showCoordinates`는 그래프의 좌표 표시 여부이며 이전 출력에서 이 필드가 없으면 false로 취급합니다. 표시값은 소수 둘째 자리 반올림이지만 anchor는 원래 정밀도를 유지합니다. 새 점의 좌표 표시 생성 옵션(`pointCoordinates`) 자체는 UI 상태라 출력하지 않습니다. schemaVersion 3에 선택적인 표시 필드를 추가했습니다.

schemaVersion 5에서 점 보조선 기능과 `guides` 필드를 제거했습니다.

폴더는 `type: 'group'`, `id`, `name`, `parentId`만 포함합니다. 그래프 도형이나 좌표가 없습니다. v2의 수요·공급 방향 코드 `demand`/`supply`는 v3에서 각각 `descending`/`ascending`으로 바뀌었습니다. JSON 불러오기는 아직 지원하지 않습니다.

## 점선

`dashedLines`의 각 항목은 `id`, `type: 'dashed'`, `name`, `color`, `parentId`, `anchor`(시작점), `end`(끝점)를 포함합니다. 두 끝점은 내부 좌표이며 유한한 선분입니다. 항상 점선으로 표시하므로 실선 전환용 style 필드나 측정·길이 표시 필드가 없습니다. 좌표 반전·화면 크기 변경은 원본 좌표를 바꾸지 않습니다.

점선 탭 선택·방향 제한·마우스 보정 설정·미완성 미리보기는 출력하지 않습니다. 완성한 점선만 `dashedLines`와 `objectOrder`에 포함합니다. 기존 점과의 스냅은 생성/편집 당시 좌표 보정이며 점을 나중에 옮겨도 자동으로 따라가지 않습니다.

## 비활성화된 이전 자 자료

`rulers` 배열은 이전 자료 보존용으로 유지합니다. 각 항목의 기존 id/type/name/color/parentId/anchor/end/style/showMeasurement 형식은 보존하지만 현재 UI는 자 활성화·그리기·측정·렌더를 제공하지 않습니다. 새 점선은 rulers에 저장하지 않습니다.

## 복제와 UI 상태

복제본은 원본과 같은 line/curve/sketch/point/dashed/group 타입의 독립 객체입니다. sum과 ruler는 복제 대상이 아닙니다. 새 ID와 이름을 사용하고 함께 복제한 계층의 parentId는 새 ID를 가리킵니다. 직선은 현재 기준점에서 기울기 배율을 적용한 뒤 자동으로 옆에 띄우며 결과를 실제 slope/anchor에 반영합니다. 기준·절편 유지·배치 선택은 없고 수직선 null을 유지합니다. 자유 곡선은 start/anchor/end를 함께 이동합니다. binding은 같은 계층을 함께 복제해도 모두 끊어 독립 사본으로 만듭니다.

선택·점·점선·자유 곡선·칠하기·복제·합산의 UI 플래그와 생성/복제 옵션은 출력하지 않습니다. 현재 형식 버전은 **10**입니다. 6은 독립 점선, 7은 원본 참조 합산, 8은 자유 곡선·따라가기 관계, 9는 무차별곡선, 10은 칠한 구역을 추가한 버전입니다. JSON 불러오기는 현재 제공하지 않으므로 과거 버전의 자동 마이그레이션을 약속하는 형식은 아닙니다.

## 예시

[두 그래프의 전체 예시](examples/editor-v10.json)는 `node scripts/generate-doc-example.mjs`로 재생성합니다. 칠한 구역, 합산, 직선에 접한 자유 곡선, 최저점을 표시한 U자 곡선과 별도 일반 점의 통과 직선, 폴더와 독립 점선, 네 종류의 무차별곡선과 직각 쌍곡선을 포함합니다. 실행 스크립트는 새 메모리 store에서 문서만 생성하며 실제 브라우저 작업을 읽거나 변경하지 않습니다. 아래 인라인 예시는 fills 추가 전의 버전 9 점/점선 예시로 보존합니다.

버전 9 당시 직렬화 함수로 생성한 점과 점선 문서입니다. 축 간격 기본 설정도 함께 포함합니다.

```json
{
  "schemaVersion": 9,
  "objectOrder": [
    "point-1",
    "dashed-1"
  ],
  "sketches": [],
  "sums": [],
  "groups": [],
  "points": [
    {
      "id": "point-1",
      "type": "point",
      "name": "점 01",
      "color": "#59627a",
      "parentId": null,
      "anchor": {
        "x": 1.25,
        "y": 2.5
      },
      "showCoordinates": false
    }
  ],
  "dashedLines": [
    {
      "id": "dashed-1",
      "type": "dashed",
      "name": "점선 01",
      "color": "#7b879c",
      "parentId": null,
      "anchor": {
        "x": 1.25,
        "y": 2.5
      },
      "end": {
        "x": 4.5,
        "y": 2.5
      }
    }
  ],
  "rulers": [],
  "coordinateSystem": {
    "origin": "bottom-left",
    "quadrants": [
      1
    ],
    "xPositive": "right",
    "yPositive": "up",
    "axesVisible": true,
    "axisNames": {
      "x": "x",
      "y": "y"
    },
    "lineAxisGap": {
      "enabled": false,
      "distance": 0.75
    }
  },
  "showGrid": true,
  "lines": [],
  "curves": [],
  "activeDiagramId": "diagram-1",
  "layout": {
    "preset": "single",
    "slots": [
      {
        "diagramId": "diagram-1",
        "row": 0,
        "column": 0
      }
    ]
  },
  "diagrams": [
    {
      "id": "diagram-1",
      "name": "그래프 1",
      "objectOrder": [
        "point-1",
        "dashed-1"
      ],
      "sketches": [],
      "sums": [],
      "groups": [],
      "points": [
        {
          "id": "point-1",
          "type": "point",
          "name": "점 01",
          "color": "#59627a",
          "parentId": null,
          "anchor": {
            "x": 1.25,
            "y": 2.5
          },
          "showCoordinates": false
        }
      ],
      "dashedLines": [
        {
          "id": "dashed-1",
          "type": "dashed",
          "name": "점선 01",
          "color": "#7b879c",
          "parentId": null,
          "anchor": {
            "x": 1.25,
            "y": 2.5
          },
          "end": {
            "x": 4.5,
            "y": 2.5
          }
        }
      ],
      "rulers": [],
      "coordinateSystem": {
        "origin": "bottom-left",
        "quadrants": [
          1
        ],
        "xPositive": "right",
        "yPositive": "up",
        "axesVisible": true,
        "axisNames": {
          "x": "x",
          "y": "y"
        },
        "lineAxisGap": {
          "enabled": false,
          "distance": 0.75
        }
      },
      "showGrid": true,
      "lines": [],
      "curves": []
    }
  ]
}
```
