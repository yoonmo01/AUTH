# HYENA — Multi-Agent 기반 자동 증거 분석 시스템

한림대학교 캡스톤 디자인 프로젝트  
디지털 포렌식 증거를 자동으로 수집·분석하여 수사 단서를 도출하는 시스템입니다.

---

## 시스템 구성

```
data/HYENA CTF/          ← 증거 파일 (git 제외)
      │
      ▼
ETL 파이프라인 (etl/)
  scan → classify → email_pst → document_groups
  → document_convert → document_extract → hwp_doc_variant
  → document_propagate → entity_extract → graphdb_load
  → audit_findings → audit
      │
      ▼
PostgreSQL (hyena_clean_postgres:55432)
Neo4j      (hyena_clean_neo4j:7687)      ← AI 스테이지 활성화 시
Qdrant     (hyena_clean_qdrant:6333)     ← 임베딩 스테이지 활성화 시
      │
      ▼
FastAPI (api/)  ←  http://localhost:8000
```

---

## 설치 및 실행

### 사전 요구사항

| 항목 | 버전 | 확인 방법 |
|------|------|-----------|
| Python | 3.11 이상 | `python --version` |
| Docker Desktop | 최신 | `docker --version` |
| Git | 최신 | `git --version` |

> Docker Desktop이 실행 중인 상태여야 합니다.

---

### 1단계 — 저장소 복제

```powershell
git clone https://github.com/yoonmo01/AUTH.git
cd AUTH
```

---

### 2단계 — 가상환경 생성 및 패키지 설치

```powershell
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
```

> 설치 후 터미널을 `.venv` 환경에서 실행합니다.
> ```powershell
> .venv\Scripts\Activate.ps1
> ```

---

### 3단계 — 환경변수 설정

```powershell
copy .env.example .env
```

`.env` 파일을 열어 필요한 키를 입력합니다.

```env
# 필수 (기본값으로 동작하지만 변경 가능)
POSTGRES_PASSWORD=hyena_pw
NEO4J_PASSWORD=hyena_pw

# AI 스테이지 사용 시 필수
OPENAI_API_KEY=sk-...
UPSTAGE_API_KEY=up-...
NCLOUD_ACCESS_KEY=...
NCLOUD_SECRET_KEY=...
```

AI 스테이지(이미지 설명, STT, 임베딩, 개체명 추출)를 사용하지 않는 경우 API 키 없이도 실행 가능합니다.

---

### 4단계 — 증거 데이터 배치

```
repo/
  data/
    HYENA CTF/              ← 원본 증거 파일을 여기에
    converted_documents/    ← 변환 캐시 (있으면 재사용, 없으면 재변환)
      docx/
      hwpx/
      manifest.jsonl
```

---

### 5단계 — 인프라 초기화

```powershell
.\scripts\clean_rebuild.ps1
```

이 스크립트가 하는 것:
1. Docker 컨테이너 기동 (`hyena_clean_postgres`)
2. DB 스키마 초기화 (`schema.sql` 적용)

Neo4j·Qdrant가 필요한 경우 (그래프DB, 임베딩 스테이지):

```powershell
docker compose -f docker\docker-compose.yml --profile ai up -d
```

---

### 6단계 — API 서버 실행

새 터미널을 열어서:

```powershell
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

서버가 뜨면 `http://localhost:8000/docs` 에서 Swagger UI를 확인할 수 있습니다.

---

### 7단계 — 파이프라인 실행

또 다른 터미널에서:

```powershell
python scripts\run_pipeline.py --drive-root-path ".\data\HYENA CTF"
```

완료까지 약 10~30분 소요됩니다. 완료 후 자동으로 품질 검사 결과가 출력됩니다.

정상 완료 기준:
```
content_chunks : 26,485
audit_findings :     20
```

---

## 컨테이너 정보

| 서비스 | 컨테이너명 | 포트 | 프로파일 |
|--------|-----------|------|---------|
| PostgreSQL | hyena_clean_postgres | 55432 | 기본 |
| Neo4j | hyena_clean_neo4j | 7474 / 7687 | ai |
| Qdrant | hyena_clean_qdrant | 6333 | ai |

---

## API 주요 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/ingest/drive` | 파이프라인 실행 시작 |
| `GET` | `/ingest/jobs/{job_id}` | 파이프라인 진행 상황 조회 |
| `GET` | `/summary` | 전체 데이터 규모 요약 |
| `GET` | `/search/emails?q=키워드` | 이메일 본문·제목·발신자 검색 |
| `GET` | `/search/files?q=키워드` | 파일명·경로 검색 |
| `GET` | `/search/content?q=키워드` | 추출 텍스트 전문 검색 |
| `GET` | `/graph/nodes` | 그래프 노드 조회 |
| `GET` | `/graph/edges/email` | 이메일 발신-수신 관계 조회 |
| `GET` | `/entities` | 추출된 개체명 목록 |
| `GET` | `/cases` | 수사 사건 목록 |
| `GET` | `/sessions` | 수사 세션 목록 |

전체 목록: `http://localhost:8000/docs`

---

## 파이프라인 스테이지

| 순서 | 스테이지 | 설명 | 옵션 |
|------|---------|------|------|
| 1 | scan | 파일시스템 스캔 및 해시 계산 | |
| 2 | classify | 확장자 기반 파일 분류 | |
| 3 | email_pst | .pst/.msg 이메일 파싱 및 첨부파일 추출 | |
| 4 | document_groups | SHA256 기반 중복 파일 그룹화 | |
| 5 | document_convert | .hwp/.doc → .hwpx/.docx 변환 | |
| 6 | document_extract | 문서 텍스트 추출 및 청킹 | |
| 7 | hwp_doc_variant | HWP/DOC 동일 서식 쌍 처리 | |
| 8 | document_propagate | 그룹 내 추출 결과 전파 | |
| 9 | pending_documents | 미처리 문서 재시도 | `process_pending_documents` |
| 10 | audio_stt | 음성 파일 STT (CLOVA Speech) | `process_audio` |
| 11 | image_vision | 이미지 설명 생성 (GPT Vision) | `process_images` |
| 12 | upstage_embeddings | 벡터 임베딩 → Qdrant | `process_embeddings` |
| 13 | entity_extract | 개체명 추출 (정규식 + LLM) | `process_entities` |
| 14 | graphdb_load | Neo4j 그래프 적재 | `process_graphdb` |
| 15 | audit_findings | 이메일 이상 행위 탐지 | `process_audit_findings` |
| 16 | audit | 파이프라인 품질 검사 | |

---

## 감사 탐지 항목

`audit_findings` 스테이지가 탐지하는 의심 행위:

| 탐지 유형 | 심각도 | 설명 |
|-----------|--------|------|
| `anonymous_recipient` | high | 프로톤메일·튜타노타 등 익명 서비스 발송 |
| `external_email_with_attachment` | medium | 외부 수신자에 첨부파일 발송 |
| `bulk_external_send` | medium | 외부 수신자에 5건 이상 대량 발송 |

---

## 이메일 정책

- **PST**: 기본 파싱 대상. `email_messages` 테이블에 적재.
- **OST**: 로컬 캐시로 취급. `files` 테이블에는 등록되지만 이메일 파싱은 건너뜀.
- **MSG**: 개별 이메일 파일. PST와 동일하게 파싱.

첨부파일 처리 흐름:

```
PST → email_messages → email_attachments → files → 문서 추출
```

---

## HWP-DOC 서식 변형 정책

일부 HWP 파일은 HWPX 변환 시 텍스트가 비어있는 경우가 있습니다.  
같은 폴더에 동일 서식의 DOC 파일이 있으면 해당 DOC 텍스트를 대체 사용합니다.

- `file_relations.relation_type = 'format_variant'` 관계 생성
- 원본 HWP 파일 행은 유지
- 바이트 중복이 아닌 동일 서식 파일 쌍으로 처리

---

## 품질 검사 단독 실행

```powershell
python scripts\audit_rdb_quality.py
```

정상 기준:
- `traceability` 항목 전부 0
- `state_mismatches` 항목 전부 0
- `propagation_missing` 0

---

## 재현 원칙

이 저장소는 기존 DB를 패치하는 것이 아닌 **완전한 재구축**을 목표로 합니다.

재현에 필요한 것:
- `data/HYENA CTF/` 아래 원본 증거 파일
- `data/converted_documents/` 아래 변환 캐시 (없으면 재변환)
- `.env` 파일 (API 키)
- Docker Desktop
- 이 코드베이스
