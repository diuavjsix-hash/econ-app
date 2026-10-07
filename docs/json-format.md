# JSON 출력 형식 · schemaVersion 3

구현 기준은 `src/export.js`의 `serializeDocument(state)`입니다. 현재는 내보내기만 지원하며 JSON 불러오기 API와 UI는 없습니다. 화면에서 가려진 도형도 모두 내보냅니다.

## 최상위 필드

| 필드 | 설명 |
| --- | --- |
| `schemaVersion` | 현재 3. 점·폴더·계층 및 우상향/우하향 방향 코드를 포함 |
| `coordinateSystem` | 원점 배치·사분면·방향·축 표시·축 이름 |
| `showGrid` | 격자 표시 여부 |
| `lines` | 모든 직선 |
| `curves` | 모든 곡선 |
| `points` | 모든 점과 이름·보조선 설정 |
| `groups` | 도형 없이 분류에 사용하는 폴더 |
| `objectOrder` | 모든 종류를 섞은 생성 순서의 ID 배열 |

`coordinateSystem.origin`과 `quadrants` 조합은 `bottom-left` / `[1]`, `bottom-center` / `[1,2]`, `center` / `[1,2,3,4]`입니다. `xPositive`는 `right`, `yPositive`는 `up`, `axesVisible`은 현재 항상 true입니다. `axisNames`의 x·y는 문자열이며 빈 문자열은 이름만 숨긴다는 뜻입니다.

선택 상태, 다음 ID 카운터, 화면 크기·배율, UI 입력 포커스, 마우스 선택(`mouseSelected`), 되돌리기·다시 실행 기록과 메타데이터(`canUndo`, `canRedo`, `historyRevision`)는 출력하지 않습니다. 복원 기능을 구현할 경우 사분면 조합에서 내부 `quadrantMode`를 결정하고 ID 카운터 충돌을 방지해야 합니다. 파일의 표시 메타데이터와 기하 데이터를 검증 없이 DOM에 삽입해서는 안 됩니다.

## 이름과 계층

각 직선·곡선·점·폴더에는 `parentId`가 있습니다. null은 최상위이며, 다른 항목 ID면 해당 항목 아래에 들어갑니다. 같은 상위 항목의 자식은 `objectOrder` 순서로 정렬합니다. 모든 종류가 상위 항목이 될 수 있으며 순환은 허용하지 않습니다. 분류는 도형 좌표를 바꾸지 않습니다. `name`은 사용자가 편집한 이름이며 방향과 독립적입니다. 목록 접기 상태·점 찍기 모드·점 보정 토글(`pointSnap`)은 UI 상태라 출력하지 않습니다. 보정된 점의 내부 좌표는 일반 점과 동일하게 출력하며 도형에 계속 부착되는 제약은 기록하지 않습니다.

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

점은 `type: 'point'`, `id`, `name`, `color`, `parentId`, 내부 좌표 `anchor: {x,y}`, `guides`, `showCoordinates`를 포함합니다. 이름을 비우면 그래프의 이름만 숨깁니다. `showCoordinates`는 그래프의 좌표 표시 여부이며 이전 출력에서 이 필드가 없으면 false로 취급합니다. 표시값은 소수 둘째 자리 반올림이지만 anchor는 원래 정밀도를 유지합니다. 새 점의 좌표 표시 생성 옵션(`pointCoordinates`) 자체는 UI 상태라 출력하지 않습니다. schemaVersion 3에 선택적인 표시 필드를 추가했습니다.

`guides.horizontal`과 `guides.vertical`은 각각 `none`/`dashed`/`solid`입니다. `guides.extent`가 `axes`면 점에서 y축으로 수평 투영, x축으로 수직 투영하며, `full`이면 현재 표시 영역 전체에 수평·수직 보조선을 표시합니다. 보조선 좌표는 점과 표시 영역에서 계산하며 픽셀이나 큰 유한 기울기를 저장하지 않습니다.

폴더는 `type: 'group'`, `id`, `name`, `parentId`만 포함합니다. 그래프 도형이나 좌표가 없습니다. v2의 수요·공급 방향 코드 `demand`/`supply`는 v3에서 각각 `descending`/`ascending`으로 바뀌었습니다. JSON 불러오기는 아직 지원하지 않습니다.

## 예시

수직선·우하향 곡선·점이 한 폴더에 들어 있는 유효한 출력 예시입니다. 내부 좌표이며 현재 화면 크기와 무관합니다.

```json
{
  "schemaVersion": 3,
  "objectOrder": ["group-1", "line-1", "curve-1", "point-1"],
  "groups": [{"id": "group-1", "type": "group", "name": "시장", "parentId": null}],
  "points": [{
    "id": "point-1", "type": "point", "name": "E", "color": "#59627a", "parentId": "group-1",
    "anchor": {"x": 3, "y": 4}, "showCoordinates": true,
    "guides": {"horizontal": "dashed", "vertical": "solid", "extent": "axes"}
  }],
  "coordinateSystem": {
    "origin": "bottom-left",
    "quadrants": [1],
    "xPositive": "right",
    "yPositive": "up",
    "axesVisible": true,
    "axisNames": {"x": "수량 Q", "y": "가격 P"}
  },
  "showGrid": true,
  "lines": [{
    "id": "line-1", "type": "line", "name": "직선 01", "color": "#6068e8", "parentId": "group-1",
    "slope": null, "intercept": null,
    "anchor": {"x": 3, "y": 3},
    "vertical": true, "xIntercept": 3,
    "implicit": {"a": -1, "b": 0, "c": 3}
  }],
  "curves": [{
    "id": "curve-1", "type": "curve", "name": "곡선 01", "color": "#6068e8", "parentId": "group-1",
    "variant": "descending", "anchor": {"x": 4, "y": 4},
    "span": 3, "slope": -0.75, "bend": 0.25,
    "geometry": {
      "type": "quadratic-bezier",
      "controlPoints": [{"x": 1, "y": 7}, {"x": 4, "y": 3.25}, {"x": 7, "y": 2.5}],
      "extensions": {
        "type": "tangent-rays",
        "rays": [
          {"anchor": {"x": 1, "y": 7}, "direction": {"x": -1, "y": 1.25}},
          {"anchor": {"x": 7, "y": 2.5}, "direction": {"x": 1, "y": -0.25}}
        ]
      }
    }
  }]
}
```

이 문서는 인계 시점의 출력 형식을 기록합니다. 형식을 변경할 때는 실제 직렬화 코드와 이 문서를 함께 갱신하십시오.
