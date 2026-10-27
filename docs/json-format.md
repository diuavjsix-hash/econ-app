# JSON 출력 형식 · schemaVersion 6

구현 기준은 `src/export.js`의 `serializeDocument(state)`입니다. 현재는 내보내기만 지원하며 JSON 불러오기 API와 UI는 없습니다. 화면에서 가려진 도형도 모두 내보냅니다.

## 최상위 필드

| 필드 | 설명 |
| --- | --- |
| `schemaVersion` | 현재 6. 독립 점선 배열 dashedLines 추가; 이전 rulers 자료는 보존 |
| `activeDiagramId` | 최상위 도형·좌표계 필드가 가리키는 그래프 ID |
| `layout` | `preset`과 `slots`: `{diagramId, row, column}` 배열. 행·열은 0부터 시작 |
| `diagrams` | 숨겨진 그래프를 포함한 모든 그래프. 각각 `id`, `name`, 아래의 좌표계·도형 필드를 보유 |
| `coordinateSystem` | 원점 배치·사분면·방향·축 표시·축 이름 |
| `showGrid` | 격자 표시 여부 |
| `lines` | 모든 직선 |
| `curves` | 모든 곡선 |
| `points` | 모든 점과 이름·좌표 표시 설정 |
| `dashedLines` | 모든 점선의 두 끝점·이름·색상·계층 |
| `rulers` | 비활성화된 이전 자 자료 보존용 배열 |
| `groups` | 도형 없이 분류에 사용하는 폴더 |
| `objectOrder` | 모든 종류를 섞은 생성 순서의 ID 배열 |

기존 최상위 `coordinateSystem`, `showGrid`, `lines`, `curves`, `points`, `dashedLines`, `rulers`, `groups`, `objectOrder`는 선택한 그래프의 사본입니다. 전체 문서는 `diagrams`와 `layout`으로 읽습니다. 배치를 줄여도 `diagrams`에서 삭제하지 않으며 `layout.slots`에 있는 그래프만 표시합니다. 다음 예시는 좌우 대면 배치입니다.

```json
{"preset":"face2","slots":[{"diagramId":"diagram-1","row":0,"column":0},{"diagramId":"diagram-2","row":0,"column":1}]}
```

각 그래프의 기본 `coordinateSystem.origin`과 `quadrants` 조합은 `bottom-left` / `[1]`, `bottom-center` / `[1,2]`, `center` / `[1,2,3,4]`입니다. 좌우 반전 시 `bottom-left`는 `bottom-right`로, 상하 반전 시 `bottom-*`는 `top-*`로 바뀌며 `center`는 유지합니다. `xPositive`는 `right` 또는 `left`, `yPositive`는 `up` 또는 `down`, `axesVisible`은 현재 항상 true입니다. `axisNames`의 x·y는 문자열이며 빈 문자열은 이름만 숨긴다는 뜻입니다.

객체 선택 상태(현재 그래프 ID 제외), 다음 ID 카운터, 화면 크기·배율, UI 입력 포커스, 마우스 선택(`mouseSelected`), 되돌리기·다시 실행 기록과 메타데이터(`canUndo`, `canRedo`, `historyRevision`)는 출력하지 않습니다. 복원 기능을 구현할 경우 사분면 조합에서 내부 `quadrantMode`를 결정하고 ID 카운터 충돌을 방지해야 합니다. 파일의 표시 메타데이터와 기하 데이터를 검증 없이 DOM에 삽입해서는 안 됩니다.

## 이름과 계층

각 직선·곡선·점·점선·이전 자·폴더에는 `parentId`가 있습니다. null은 최상위이며, 다른 항목 ID면 해당 항목 아래에 들어갑니다. 각 계층은 같은 그래프 안에서만 연결하며 다른 그래프의 객체를 상위 항목으로 사용할 수 없습니다. 같은 상위 항목의 자식은 `objectOrder` 순서로 정렬합니다. 모든 종류가 상위 항목이 될 수 있으며 순환은 허용하지 않습니다. 분류는 도형 좌표를 바꾸지 않습니다. `name`은 사용자가 편집한 이름이며 방향과 독립적입니다. 목록 접기 상태·점 찍기 모드·점 보정 토글(`pointSnap`)은 UI 상태라 출력하지 않습니다. 보정된 점의 내부 좌표는 일반 점과 동일하게 출력하며 도형에 계속 부착되는 제약은 기록하지 않습니다.

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

복제본은 별도 객체 타입이 아니라 원본과 같은 line/curve/point/dashed/group 타입의 독립 객체입니다. 새 ID와 이름을 사용하며 함께 복제한 하위 계층의 parentId는 복제본 ID를 가리킵니다. 직선의 선택한 기울기 배율과 기준은 실제 slope/anchor에 반영됩니다. 기본 세로축 절편 유지는 anchor.x를 배율로 나누는 방식이며 수직선 null 표현은 유지합니다. 좌표·형태·이름·계층은 원본과 독립적으로 수정할 수 있습니다.

손·점·점선·복제 탭 선택과 복제 UI 옵션은 출력하지 않습니다. 형식 버전은 6을 유지합니다.

## 예시

아래 예시는 현재 직렬화 함수를 통해 생성한 점과 점선 문서입니다.

```json
{
  "schemaVersion": 6,
  "objectOrder": [
    "point-1",
    "dashed-1"
  ],
  "groups": [],
  "points": [
    {
      "id": "point-1",
      "type": "point",
      "name": "점 01",
      "color": "#59627a",
      "parentId": null,
      "anchor": {
        "x": 1,
        "y": 2
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
        "x": 1,
        "y": 2
      },
      "end": {
        "x": 4,
        "y": 2
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
      "groups": [],
      "points": [
        {
          "id": "point-1",
          "type": "point",
          "name": "점 01",
          "color": "#59627a",
          "parentId": null,
          "anchor": {
            "x": 1,
            "y": 2
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
            "x": 1,
            "y": 2
          },
          "end": {
            "x": 4,
            "y": 2
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
        }
      },
      "showGrid": true,
      "lines": [],
      "curves": []
    }
  ]
}
```
