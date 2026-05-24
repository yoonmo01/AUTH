# 시스템 Q&A — HYENA 퇴사자 데이터 유출 탐지 시스템

> 코드베이스 및 개발 과정에서 확인된 사실만 기재.
> 확인되지 않은 항목은 **"확인 불가"** 로 명시.

---

## ① 시스템 전체 구조

### 1-1. 아키텍처 구성요소

| 레이어 | 기술 스택 |
|---|---|
| **Frontend** | React + TypeScript (Vite 빌드), `@tanstack/react-query` |
| **Backend** | FastAPI (Python), uvicorn, SSE(Server-Sent Events)로 실시간 진행 이벤트 전달 |
| **RDB** | PostgreSQL (Docker 컨테이너 `hyena_clean_postgres`, port 55432) |
| **Vector DB** | Qdrant (http://127.0.0.1:6333), 컬렉션명 `hyena_content_chunks` |
| **Graph DB** | Neo4j (bolt://localhost:7687) |
| **배포 환경** | Docker Compose 기반 로컬/온프레미스 |

### 1-2. 사용한 AI 모델

| 용도 | 모델 | 방식 |
|---|---|---|
| Main Agent / Sub-Agent LLM | `gpt-5.1` (환경변수 `AGENT_MODEL`) | OpenAI API 호출 |
| 관리자 Narrative 생성 | `gpt-4o` (환경변수 `NARRATIVE_MODEL`) | OpenAI API 호출 |
| 파일 내용 임베딩 (RAG) | Upstage `solar-embedding-1-large-passage` (환경변수 `UPSTAGE_API_KEY`) | Upstage API 호출 |

- **RAG 사용 여부**: 사용함. Qdrant(`hyena_content_chunks`)에 파일 내용 청크를 Upstage 임베딩으로 적재, STEP 3(민감 파일 분류) 시 벡터 유사도 검색으로 민감 키워드 매칭

### 1-3. 사용한 포렌식 도구·라이브러리

| 항목 | 내용 |
|---|---|
| 디스크 이미지 처리 | **확인 불가** (Autopsy, Sleuth Kit 등 사용 여부 코드에서 미확인) |
| 아티팩트 추출 도구 | **확인 불가** (Plaso, RegRipper 등 사용 여부 코드에서 미확인) |
| DB 적재 방식 | ETL 스크립트(`load_scenario.py`)가 포렌식 아티팩트를 PostgreSQL·Qdrant·Neo4j에 사전 적재 |
| 데이터 출처 | HYENA CTF 데이터셋 (무역회사 구매팀 퇴사자 C드라이브 이미지 기반) |
| 해시·무결성 | **확인 불가** |

---

## ② Multi-Agent 구조

### 2-1. Agent 구성

**총 5개의 Sub-Agent + 1개의 Main Supervisor + 3개의 결정론적 코드 노드**

| 구분 | 이름 | 역할 |
|---|---|---|
| Main Supervisor | `graph.py` | 전체 오케스트레이션, 각 Sub-Agent에 수사 지침(task) 생성·전달, 교차 대조·스코어링 실행 |
| STEP 1 | `baseline_node` | 기준선 수립 — 분석 대상자의 평소 이메일·파일 접근·활동 패턴 프로파일링 |
| STEP 2 | `exfiltration_node` | 유출 채널 탐지 — 외부 이메일·익명 채널(ProtonMail, Tmpbox 등) 발신 탐지 |
| STEP 3 | `sensitive_files_node` | 민감 파일 분류 — Qdrant 벡터 검색 + Neo4j 그래프로 기밀 파일 식별 |
| STEP 4 | `behavior_node` | 행동 패턴 분석 — 퇴사 전 비정상 행동(파일 삭제, 업무 외 시간 활동) 탐지 |
| STEP 5 | `counter_evidence_node` | 반증 검증 — 탐지된 의심 항목이 정상 업무 행위인지 재검토 |
| 교차 대조 | `cross_ref_node` | 결정론적 코드 — 유출 이메일 첨부파일과 민감 파일 목록 매핑 |
| 리스크 스코어링 | `scoring_node` | 결정론적 코드 — 가중치 테이블로 최종 위험 점수 산출 |
| 최종 리포트 | `report_node` | LLM 1회 호출 — 전체 분석 결과를 JSON 리포트로 구조화 |

**Agent 간 협업 방식**

```
STEP 1 (순차)
  ↓
STEP 2 / STEP 3 / STEP 4 (3개 병렬, ThreadPoolExecutor max_workers=3)
  ↓
교차 대조 (결정론적 코드)
  ↓
STEP 5 반증 검증 (순차)
  ↓
리스크 스코어링 (결정론적 코드)
  ↓
최종 리포트 생성 (LLM 1회)
```

### 2-2. Agent 오케스트레이션

- **프레임워크**: LangGraph (`StateGraph`) — Supervisor 패턴
- **통신 방식**: Main Supervisor가 각 Sub-Agent에 `task dict`를 명시적으로 전달하고 결과를 `InvestigationState`(TypedDict)에 수집
- **진행 이벤트**: 각 노드 시작·완료 시 SSE로 프론트엔드에 실시간 전달 (`api/progress.py`)
- **LLM 호출 전략**: Sub-Agent 실행 전, Main Supervisor가 LLM을 1회 호출해 해당 STEP의 수사 지침을 생성한 뒤 task에 포함 (`supervisor_instructions`)

### 2-3. Counter-evidence 메커니즘

- **담당**: `counter_evidence_node` (STEP 5 Sub-Agent)
- **입력**: STEP 2·3·4 탐지 결과 전체 + 교차 대조 결과
- **사용 Tool**: `get_email_history`, `get_email_attachments`, `get_deleted_files`, `get_messenger_logs` (PostgreSQL 직접 쿼리)
- **로직**: Sub-Agent가 각 의심 항목에 대해 DB를 재조회해 정상 업무 행위 여부를 판단, `verified_findings` 목록 반환 (`verified: true/false` + 판단 근거)
- **스코어 반영**: `verified: false` 항목 1건당 리스크 점수 **-20점** 감산

---

## ③ 분석 파이프라인

### 3-1. 입력 단계

| 입력 항목 | 설명 |
|---|---|
| `subject_name` | 분석 대상자 이름 |
| `subject_position` | 직급 |
| `hire_date` | 입사일 |
| `resignation_date` | 퇴사일 |
| 분석 기간 | 퇴사 전 90일 (또는 DB 내 해당 인물 최초 데이터 날짜부터 자동 설정) |

포렌식 아티팩트는 ETL 단계에서 사전 적재되어 있으며, 파이프라인 실행 시점에는 DB 조회만 수행.

### 3-2. 처리 단계별 아티팩트

| STEP | 주요 아티팩트 | 데이터 소스 |
|---|---|---|
| STEP 1 기준선 | 이메일 발신 이력, 파일 접근 이력, 활동 이벤트 | PostgreSQL (`email_messages`, `file_access_logs`, `activity_events`) |
| STEP 2 유출 채널 | 외부 도메인 이메일, 익명 채널(ProtonMail·Tmpbox) 발신, 첨부파일 목록 | PostgreSQL (`email_messages`), `messenger_logs` |
| STEP 3 민감 파일 | 파일명·내용 벡터 유사도, 민감 키워드 매칭 | Qdrant (`hyena_content_chunks`), Neo4j |
| STEP 4 행동 패턴 | 퇴사 직전 파일 삭제 기록, 업무 외 시간 이상 활동 | PostgreSQL (`file_access_logs`, `activity_events`) |
| 교차 대조 | 유출 이메일 첨부파일 ↔ 민감 파일 목록 매핑 | 결정론적 코드 (STEP 2·3 결과) |
| STEP 5 반증 | 의심 항목별 정상 업무 근거 재검토 | PostgreSQL 전체 재조회 |

### 3-3. 출력 단계

**최종 산출물 형식**: JSON (`report_json` JSONB 컬럼 DB 저장) + React 웹 대시보드 표시 + PDF 다운로드(브라우저 print)

**판정 기준 (결정론적 가중치 합산)**

| 조건 | 점수 |
|---|---|
| 기밀 파일이 익명 채널로 발신됨 (교차 대조 hit) | +40 |
| 퇴사 직전 파일 삭제 행위 탐지 | +30 |
| 기준선 대비 이상 행동 (anomaly_score ≥ 0.7) | +20 |
| 익명 채널 사용 (파일 매칭 없음, 건당) | +15 |
| 반증 인정 항목 (정상 업무 확인, 건당) | -20 |

**위험 등급 임계값**

| 점수 구간 | 판정 |
|---|---|
| 81점 이상 | HIGH |
| 61~80점 | MEDIUM |
| 41~60점 | LOW |
| 40점 이하 | CLEAN |

---

## ④ 차별성·특장점

### 4-1. 기존 솔루션 대비 차별점

**Single Agent(단일 LLM) 대비 Multi-Agent 장점**

- 각 STEP이 독립된 전문 Agent로 분리되어 컨텍스트 오염 없이 집중 분석 가능
- STEP 2·3·4 병렬 실행으로 분석 시간 단축
- STEP 5 반증 검증으로 단일 LLM의 단정적 판단을 구조적으로 검토
- 교차 대조·스코어링을 결정론적 코드로 분리해 판정 재현성 보장

**직원 소명(설명 요청) 워크플로우 내장**

- 분석 완료 후 직원이 직접 각 항목에 소명 제출
- 관리자가 소명 + 분석 결과를 함께 검토하는 2단계 리뷰 구조
- 관리자용 Narrative(개조체 줄글 요약)를 LLM이 별도 생성 및 DB 캐싱

**외주 포렌식 / 상시 DLP 대비**

- 확인 불가 (비용·시간 비교 데이터 없음)

### 4-2. 기술적 난점과 해결 방법

| 난점 | 해결 방법 |
|---|---|
| STEP 2·3·4 병렬 실행 시 Sub-Agent 간 상태 충돌 | LangGraph `InvestigationState` TypedDict로 읽기 전용 상태 공유, 각 Agent는 자신의 출력 키만 반환 |
| 판정 결과 재현성 부재 | 교차 대조·리스크 스코어링을 LLM이 아닌 결정론적 코드로 분리 구현 |
| agent_trace 소멸 (세션 종료 시 중간 상태 유실) | `agent_trace` JSONB 컬럼 추가, 파이프라인 완료 시 DB에 함께 저장 |
| Narrative LLM 첫 호출 지연 | `admin_narrative` JSONB 컬럼 캐싱, 이후 호출은 DB에서 즉시 반환 |
| Qdrant 벡터와 임베딩 모델 불일치 위험 | ETL 적재·쿼리 모두 Upstage `solar-embedding-1-large-passage` 고정 |

---

## ⑤ 실험·검증 데이터

### 5-1. 성능 측정

| 지표 | 값 |
|---|---|
| PC 1대당 분석 시간 | **확인 불가** |
| 분류 정확도 (Precision/Recall/F1) | **확인 불가** |
| 외주 대비 비용 절감률 | **확인 불가** |

### 5-2. 테스트 시나리오

| 항목 | 내용 |
|---|---|
| 데이터셋 | HYENA CTF 데이터셋 (무역회사 구매팀 퇴사자 C드라이브 이미지 기반 시나리오) |
| 검증 시나리오 | 강수민, 이지수, 장국주 3인 (각각 서로 다른 유출 패턴) |
| 시나리오 성격 | CTF 경쟁용으로 설계된 가상 시나리오 (실제 피의자 데이터 아님) |
| 데이터 적재 | `load_scenario.py` ETL 스크립트로 PostgreSQL·Qdrant·Neo4j에 사전 적재 |
