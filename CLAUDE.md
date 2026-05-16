# CLAUDE.md — 퇴사자 데이터 유출 탐지 시스템 개발 가이드

## 프로젝트 개요

무역회사 구매팀 퇴사자(HYENA CTF 데이터셋)의 C드라이브 이미지를 분석해
데이터 유출 여부를 자동 판정하고 수사 보고서를 생성하는 Multi-Agent 시스템.

- 입력: 퇴사자 이름/직급/입사일/퇴사일
- 출력: HIGH / MEDIUM / LOW / CLEAN 판정 + 증거 리포트
- 상세 설계: `agent_system_design.md` (Input/Output/DB쿼리/System Prompt 전부 명시됨)

---

## 아키텍처 원칙 — 반드시 준수

### STEP 실행 순서는 코드에 고정 (절대 변경 금지)

```
STEP 1 (Baseline)
  → STEP 2 / STEP 3 / STEP 4 (병렬)
  → 교차 대조 (코드)
  → STEP 5 (Counter-evidence)
  → 리스크 스코어링 (코드)
  → 최종 리포트
```

이 순서는 LangGraph 코드에 하드코딩. LLM이 순서를 결정하거나 바꾸는 구조 금지.

### Supervisor 패턴 사용 (Graph Edges 자동 라우팅 금지)

Main Agent = Supervisor. 각 Sub-Agent에게 task dict를 명시적으로 전달하고 결과를 수신한다.

```python
# 올바른 방식 — Main이 task를 직접 전달
task = {
    "task": "유출 채널 탐지",
    "subject_name": state["subject_name"],
    "baseline_profile": state["baseline_profile"],
    ...
}
result = exfiltration_agent.invoke(task)

# 금지 — LangGraph 엣지가 자동으로 State를 흘려보내는 방식
graph.add_edge("baseline", "exfiltration")  # 이렇게만 하면 안 됨
```

### Sub-Agent 내부 패턴 (모든 STEP 에이전트 공통)

모든 STEP 에이전트는 반드시 **계획 → 실행 → 반환** 순서로 동작해야 한다.
System Prompt에 아래 지시를 반드시 포함:

```
"분석을 시작하기 전에 수행할 항목을 순서대로 먼저 나열하고,
 완료할 때마다 체크하면서 진행하세요."
```

### 금지 사항

- `pip install deepagents` 사용 금지 — LangGraph + langchain-openai 직접 구현
- Main Agent에 LLM 라우팅 판단 부여 금지 — 교차대조/스코어링은 결정론적 코드
- Qdrant 검색 시 OpenAI 임베딩 사용 금지 — 반드시 Upstage 임베딩 사용

---

## 폴더 구조

```
agent/
├── graph.py               # LangGraph Supervisor 그래프 진입점
├── state.py               # InvestigationState TypedDict
├── nodes/
│   ├── baseline.py        # STEP 1 — 기준선 수립
│   ├── exfiltration.py    # STEP 2 — 유출 채널 탐지
│   ├── sensitive_files.py # STEP 3 — 민감 파일 분류
│   ├── behavior.py        # STEP 4 — 행동 패턴 분석
│   └── counter_evidence.py # STEP 5 — 반증 검증
└── tools/
    ├── rdb_tools.py       # PostgreSQL Tool 함수
    ├── vector_tools.py    # Qdrant 벡터 검색 Tool 함수
    └── graph_tools.py     # Neo4j Cypher Tool 함수
```

---

## 기술 스택

| 항목 | 사용 기술 |
|---|---|
| LLM | GPT-5.1 (`langchain-openai`, `ChatOpenAI(model="gpt-5.1")`) |
| Agent 프레임워크 | LangGraph (`StateGraph`, Supervisor 패턴) |
| PostgreSQL | psycopg2-binary (host=localhost, port=55432) |
| Qdrant | qdrant-client (http://127.0.0.1:6333) |
| Neo4j | neo4j driver (bolt://localhost:7687) |
| 임베딩 | Upstage API (UPSTAGE_API_KEY) — Qdrant 쿼리 시 필수 |

---

## DB 연결 방식 (agent 전용)

ETL 코드의 `docker exec psql` 방식을 agent에서 사용하지 말 것.
Tool 함수는 빈번하게 호출되므로 **직접 psycopg2 연결** 사용.

```python
# tools/rdb_tools.py 기본 패턴
import psycopg2, os

def get_pg_conn():
    return psycopg2.connect(
        host="localhost",
        port=55432,
        dbname=os.getenv("HYENA_POSTGRES_DB", "hyena"),
        user=os.getenv("HYENA_POSTGRES_USER", "hyena"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )
```

---

## 임베딩 주의사항

Qdrant `hyena_content_chunks` 컬렉션의 벡터는 **Upstage `solar-embedding-1-large` 모델**로 생성됨.
`vector_tools.py`에서 검색 쿼리 임베딩 시 반드시 동일 모델 사용:

```python
from openai import OpenAI  # Upstage는 OpenAI 호환 API 사용
client = OpenAI(api_key=os.getenv("UPSTAGE_API_KEY"), base_url="https://api.upstage.ai/v1/solar")

def embed(text: str) -> list[float]:
    resp = client.embeddings.create(model="solar-embedding-1-large-passage", input=text)
    return resp.data[0].embedding
```

---

## 환경변수

```
OPENAI_API_KEY      # GPT-5.1 LLM 호출
UPSTAGE_API_KEY     # 벡터 검색 임베딩 (Qdrant 쿼리 시 필수)
POSTGRES_PASSWORD   # PostgreSQL 접속
NEO4J_PASSWORD      # Neo4j 접속
```

---

## 구현 참조 문서

`agent_system_design.md` — 각 STEP의 Input/Output 구조, DB 쿼리, System Prompt가 전부 명시됨.
새 에이전트 구현 전 반드시 해당 STEP 섹션을 읽고 Output 구조를 그대로 구현할 것.
