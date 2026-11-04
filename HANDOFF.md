# 작업 인계 · Econ Studio

최종 정리: 2026-11-04 (Asia/Seoul). 현재 구현은 이 문서를 기준으로 읽습니다. 반복된 요청·중간 검증·미커밋 표현은 [11월 공통 기반 작업 이력](docs/history/foundation-work-2026-11-04.md)에 보존했습니다.

## 최신 요청과 반영 범위

최신 사용자 요청은 **현재 작업을 꼼꼼히 문서화하고 커밋·푸시**하는 것입니다. 이번 반영에는 PPC·에지워드 상자, 공통 클래스/상속과 조작·UI 기반, 곡선끼리 접점 자석, 접점의 점/점선 누락 수정, 공통화 재점검·회귀 검사·CI 구성을 함께 포함합니다. 배포는 별도 요청 전까지 하지 않습니다.

- 의존성 없는 JavaScript ES module 앱입니다. 수식 입력이나 자동 경제 계산보다 노트처럼 자유롭게 그리는 것이 제품 목표입니다.
- 컴퓨터 전용 `server.cmd`, `start-server.cmd`, `stop-server.cmd`의 로컬 내용·Git 플래그는 유지하고 이번 커밋·푸시에서 제외합니다. 파일을 저장소에서 삭제하지 않습니다.
- `dist/`, `.local/`, node_modules와 로그도 제외합니다. 로컬 검증 자료·서버 PID/시작 시각을 다른 컴퓨터로 복사하지 않습니다.
- 이전 작업의 ‘커밋·푸시하지 않음’은 이력 시점의 기록입니다. 실제 반영 상태는 아래 Git 명령과 원격 커밋으로 확인합니다.

## 저장소와 실행

| 항목 | 현재 기준 |
| --- | --- |
| 저장소 | https://github.com/diuavjsix-hash/econ-app |
| 작업 폴더 | `C:\Users\htt06\OneDrive\바탕 화면\econ-app` |
| 브랜치 | `main`; `git log -1 --oneline`으로 최신 커밋 확인 |
| 동기화 확인 | `git fetch origin`, `git status --short --branch`, `git rev-list --left-right --count HEAD...origin/main` |
| 앱 런타임 | Node.js 20 이상, 별도 패키지 설치 없음 |
| 브라우저 검사 | Node.js 22 이상과 설치된 Chrome/Chromium/Edge |
| 이 컴퓨터의 Node | `C:\Users\htt06\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` |
| 로컬 주소 | http://127.0.0.1:5173/ |
| 저장 형식 | JSON schemaVersion 10; 메모리 상태와 JSON 내보내기 |

일반 PowerShell에서는 `node`가 PATH에 없었으므로 [README 실행 방법](README.md#로컬-실행)의 전체 경로나 현재 컴퓨터의 실행 파일 메뉴를 사용합니다. 다른 컴퓨터에서는 해당 환경의 Node와 실행 파일을 사용합니다.

## 현재 기능과 이동 규칙

- 선택·직선·곡선·점·점선·칠하기 도구와 현재 작업별 단일 편집 패널을 제공합니다. 영역/추가 선택·일괄 삭제, 폴더 계층, 복제·수직합/수평합, 여러 독립 그래프와 undo/redo를 유지합니다.
- PPC는 원점 중심 양의 ¼타원입니다. 기본 원호에서 가로/세로 반지름·양 축 끝점·비율/모양 손잡이로 조절합니다. 몸체는 원점 기준 확대/축소합니다.
- 첫 작업 영역의 **포맷 → 에지워드 상자**에서 총량을 정합니다. A/B 원점과 반대 방향 네 축·총량/축 이름 편집·경계 맞춤/칠하기를 지원합니다. 모든 도형 좌표는 A 기준 수학 좌표입니다. B 방향 곡선은 세 점 자유 곡선으로 그립니다.
- 곡선끼리 몸체를 가까이 이동하면 원본 기하의 위치와 접선 방향이 일치하는 곳에 붙습니다. 기본/자유 곡선은 평행이동하고 해석 곡선은 기존 원점 확대/축소·준선형 축 이동을 유지합니다. 모양을 강제로 바꾸거나 경제적 의미/영구 연결을 부여하지 않습니다.
- 맞춘 곡선 접점은 놓은 뒤에도 **점 생성/이동·점선 생성/끝점/전체 이동**이 같은 위치로 재포착합니다. 접점 문구·두 대상 강조·이중 원, 16px 포착/24px 유지·해제와 Alt 생략을 공유합니다. Shift는 허용 이동 축을 유지하며 곡선 종류의 고유 이동이 우선합니다.
- 자기 도형과 자신을 따라오는 계산 도형은 이동 자석 대상에서 제외합니다. binding/sourceIds의 계산 의존과 parentId의 목록 계층은 서로 다릅니다.

자세한 사용법은 [README](README.md), 저장 필드는 [JSON 형식](docs/json-format.md), 현재 출력 예시는 [전체 예시](docs/examples/editor-v10.json)를 참고합니다.

## 공통 구현과 확장 지점

| 책임 | 공통 구현 |
| --- | --- |
| 편집·복제·선택/강조 기하·직렬화 | `models/graph-object.js`, `models/objects.js`, `object-types.js`, `contracts.js` |
| 곡선 종류 계산·고유 이동·모양/끝점 편집 | `models/curve-families.js`의 상속 계층과 등록 검사 |
| 포인터/키보드 조작·손잡이 | `graph/interactions.js`, `editing-handles.js`; canvas가 기록/피드백 수명 관리 |
| 도구 버튼·숫자/슬라이더 | `ui/controls.js`의 생성 함수와 NumberControl/RangeControl |
| 원본 곡선 접점 기하 | `graph/curve-contacts.js`; 이동과 정지 접점 발견이 공유 |
| 대상 제외·기하 키·점/점선 캐시 | `graph/snap-context.js`, `snap.js`의 SnapTargetCache |
| 포착/유지·맞춤 표시 | `graph/snap-policy.js`, `snap-feedback.js/.css` |
| SVG 획·히트 영역·접근성 | `graph/svg-renderer.js`의 SvgRenderer/StrokeRenderer |

새 도형은 모델·컬렉션·조작을 등록하고 새 곡선은 가장 가까운 종류 클래스를 상속해 `contactGeometry`와 필수 구현을 등록 검사에 통과시킵니다. 클래스 인스턴스·화면 픽셀·자석 캐시는 문서/undo/JSON에 넣지 않습니다. 수직선은 slope null과 방향 벡터를 사용합니다.

**통일성은 표시뿐 아니라 계산·대상 등록·다른 도구의 연속 동작까지 포함합니다.** 새 자석은 맞춤 → 놓기 → 점/점선 재포착, Shift/Alt·설정 OFF·반전·모바일 크기·취소/기록까지 검사합니다. 도구별 필터·캐시 키·SVG/문구를 복제하지 않습니다. 세부 기준은 [공통 UI 규칙](docs/ui-consistency.md)과 [구조 문서](docs/architecture.md)에 있습니다.

## 최신 검증과 재현

| 검사 | 결과/범위 |
| --- | --- |
| 앱 자동 검사 | **313개 통과**; Windows 서버 3개 제외 |
| 브라우저 검사 | **572개 통과**; 실제 별도 headless Chrome, 합성 포인터/키/터치 입력 |
| 구문/의존 경계 | **106개 모듈 통과** |
| 정적 빌드 | 통과; 앱 자산만 dist에 복사 |
| 기하/저장 호환 | 리팩터링 전 기준 결과와 정확히 일치; JSON 10 유지 |
| 문서 검증 | 문서 14개·로컬 링크 86개·JSON 블록 6개·전체 예시 재생성 일치 |

`node scripts/check.mjs`, `node scripts/test.mjs`, `node scripts/build.mjs`, `node scripts/browser-test.mjs`로 재현합니다. 상세 사례·이전 실제 조작과 합성 검사의 구분은 [검증 문서](docs/testing.md)를 따릅니다. 문서화 단계에서 재실행한 로컬 자료는 `.local/commit-foundation-node-result.txt`, `.local/commit-foundation-browser-result.json`에 있습니다.

`.github/workflows/check.yml`은 push/PR/수동 실행에서 같은 검사를 수행하며 배포 단계가 없습니다. 로컬 통과와 원격 Actions 결과를 구분하고 원격 실행 상태는 해당 커밋의 Actions에서 확인합니다.

## 알려진 제한

- 새로고침하면 메모리 작업이 초기화됩니다. JSON 불러오기·자동 저장은 없습니다.
- PPC는 양의 ¼타원만 지원하며 중심 이동·회전·합산은 없습니다. 에지워드 상자의 B 전용 해석 곡선 생성·계약곡선/배분/최적화 계산은 없습니다.
- 곡선 접점 자석은 L자 꺾임·전체 일치·겹친 평평한 두 구간을 제외합니다. 기존 이동을 유지해 도달할 수 없는 접점은 보정하지 않습니다. 48구간/64단계 유한 탐색이므로 극도로 좁거나 특이한 해를 놓칠 수 있습니다.
- 곡선끼리 일반 교점과 일부 최근접점은 표시 근사입니다. 영구 곡선↔곡선 binding, 자유 곡선/그래프 간 합산, 기존 기본 곡선의 최저점 명령은 없습니다.
- Windows 서버 3개·물리 모바일 입력·모든 브라우저 조합·장시간 대량 도형 성능·실배포는 이번 수정에서 검증하지 않았습니다. 10,000단계 의존 그래프 검사는 전체 앱 성능 보장을 뜻하지 않습니다.

## 문서 안내

- [구현 구조](docs/architecture.md): 클래스 책임·모듈·확장 지점·상태/기록/관계.
- [검증과 재현](docs/testing.md): 현재 결과·테스트 목록·실행 방법·미검증 범위.
- [변경 기록](docs/CHANGELOG.md): 기능/유지보수 변경과 각 시점 검증.
- [공통 UI 규칙](docs/ui-consistency.md), [자유 곡선 설계](docs/tangency-design.md), [무차별곡선 설계](docs/indifference-design.md): 재사용 기준과 기하.
- [11월 작업 이력](docs/history/foundation-work-2026-11-04.md), [이전 구현 기록](docs/history/implementation-log.md): 당시 상태 보존용이며 현재 명세가 아닙니다.

## 커밋·푸시 인계

이번 커밋 대상은 앱 소스·모델/UI/자석 공통 기반·PPC/상자·회귀/브라우저 검사·CI·최신 문서입니다. 컴퓨터 전용 실행 파일 세 개와 로컬 생성물은 제외합니다. 강제 푸시는 사용하지 않고 원격 main의 실제 커밋 일치까지 확인합니다. 별도 배포는 하지 않습니다.
