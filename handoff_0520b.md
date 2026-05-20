# Handoff — HYENA 프론트엔드 (front 브랜치)

## 한 줄 요약

콘솔 레이아웃 개선(PRD #28) 4슬라이스 중 S1~S3 완료·커밋됨. **남은 건 S4 한 개** — 다음 세션은 #32부터.

## 작업 맥락

- 저장소 `C:\project\2026\capstone\AUTH`, 브랜치 `front`. 작업 디렉터리는 `frontend/`.
- 검증: `frontend`에서 `npm run build`(tsc+vite) + `npm test`(vitest). 현재 테스트 83건 통과.
- 프로젝트 규칙: `CLAUDE.md`. 디자인 시스템: `frontend/src/App.css` 상단 토큰.
- API 클라이언트(`frontend/src/api/client.ts`)는 404/5xx/네트워크오류 시 `frontend/src/fixtures/`로 폴백 — 백엔드 없이 전부 개발·데모 가능.
- git 작업트리 clean, 최신 커밋 `cc1963d [레이아웃개선 S3] 완료`.

## 바로 다음 할 일: #32 (레이아웃개선 S4)

[#32](https://github.com/yoonmo01/AUTH/issues/32) — 판정/네트워크/타임라인 탭 버튼 리스타일. 굵은 검정 테두리 제거, 디자인 토큰 기반 정돈. CSS 위주(`App.css`의 `.zone__tabs`/`.t`/`.t--on`), 동작 불변. 차단 없음. 완료 기준은 이슈 본문 참조.

S4까지 끝나면 PRD #28(콘솔 레이아웃 개선) 전부 완료.

## 진행 중인 이슈 트리 (PRD → 슬라이스)

GitHub 이슈로 전부 관리됨. PRD별 슬라이스는 `[xxx S#] 완료` 커밋으로 진행. 슬라이스 작업 흐름: 사용자가 "S# 작업해줘" → 구현 → build/test → 사용자가 직접 커밋 → 다음.

- **PRD #28 콘솔 레이아웃 개선** — S1 #29 / S2 #30 / S3 #31 완료. **S4 #32 남음.**
- 완료된 PRD: 온보딩 #12, 스키마정합 #18, 콘솔재구성 #23 (전 슬라이스 끝).
- 미착수 기타: #11 폰트 수정, #3 [S8] 백엔드 세션 영속화(다른 사람 담당 — 손대지 말 것).

## 최근 세션에서 한 일 (커밋 완료)

- 레이아웃개선 S1 #29 — focused↔expanded 토글을 헤더 우측으로(`LayoutToggle.tsx`), 판정 패널의 "모두 보기" 버튼 제거.
- 레이아웃개선 S2 #30 — expanded 좌측 열 드래그 리사이즈(`Console.tsx`의 `ResizeHandle`, 200~520px 클램프).
- 레이아웃개선 S3 #31 — 네트워크 그래프 방향 전환. `graphLayout.ts` 순수 모듈(`layoutGraphNodes`), expanded→탑-다운/focused→좌→우.
- 그 직전: stru.json(실제 디렉토리 구조 15,600파일)을 `fixtures/directory-structure.json`으로, `directoryTree.ts`를 평면→중첩 입력으로 재작성. coverage는 경로 해시 기반 데모값.
- 폼 증거경로 입력 — 텍스트→파일→폴더 변천 후, `InvestigationForm.tsx`의 `USE_REAL_FOLDER_PICKER` 상수로 데모(목 드롭다운)/실제(webkitdirectory) 전환. 현재 `false`(데모).

## 주의할 점 / 알려진 사항

- 번들 1.35MB(gzip 219KB) — `directory-structure.json`(3.3MB) 픽스처 eager import 때문. vite chunk-size 경고 뜨지만 동작 정상. 실 백엔드 `/files/structure` 붙으면 픽스처 불필요. 의도적 — 건드릴 필요 없음.
- 순수 모듈 + vitest 테스트가 이 코드베이스의 규약. 새 순수 로직은 `*.ts` + `*.test.ts`로. DOM 쓰는 테스트는 파일 상단 `// @vitest-environment jsdom` 필요(기본 env는 node).
- 데모 플로우: landing→form→etl→loading→console. loading/etl은 순수 타이머 연출(`PipelineScreen`), 백엔드 분석 실제 실행 아님.

## 권장 스킬

- 슬라이스 구현은 일반 작업 — 별도 스킬 불필요.
- 새 PRD/이슈 분할 요청 시 `/to-prd`, `/to-issues`.
- 사용자가 캐브맨 모드(`/caveman`)를 켠 상태일 수 있음 — 채팅 응답이 압축체. 이어받으면 그대로 유지하거나 사용자가 "normal mode"로 해제.
