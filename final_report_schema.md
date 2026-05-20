# final_report 필드 의미 정리

에이전트 파이프라인이 생성하는 `final_report` JSON의 각 필드 설명.
프론트엔드에서 키를 참조할 때 사용하세요.

---

## 최상위 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `report_type` | string | 리포트 종류. `EXFILTRATION_SUSPECTED`(유출 의심) 또는 `CLEAN_CERTIFICATE`(이상 없음) |
| `verdict` | string | 최종 판정. `HIGH` / `MEDIUM` / `LOW` / `CLEAN` |
| `risk_score` | number | 총 리스크 점수 (숫자가 클수록 위험) |
| `summary` | string | 전체 분석 결과 한 문단 요약 |

---

## `risk_breakdown` — 점수 구성 내역

| 필드 | 타입 | 의미 |
|---|---|---|
| `cross_ref` | number | STEP2(유출채널) × STEP3(민감파일) 교차 매칭 시 부여 (+40) |
| `deleted_files` | number | 분석 기간 내 파일 삭제 이력 발견 시 부여 (+30) |
| `anon_channel` | number | ProtonMail·tmpbox 등 익명 채널 사용 수 × 15점 |
| `anomaly` | number | 행동 이상 점수 0.7 이상인 날짜 존재 시 부여 (+20) |
| `counter_evidence` | number | STEP5 할루시네이션 탐지로 verified=false 항목당 감점 (−20) |

---

## `subject` — 분석 대상자

| 필드 | 타입 | 의미 |
|---|---|---|
| `name` | string | 이름 |
| `position` | string | 직급 |
| `hire_date` | string | 입사일 (YYYY-MM-DD) |
| `resignation_date` | string | 퇴사일 (YYYY-MM-DD) |

---

## `suspicious_emails[]` — 의심 이메일 목록

| 필드 | 타입 | 의미 |
|---|---|---|
| `email_id` | string | DB의 이메일 UUID |
| `channel_type` | string | 채널 유형. `protonmail` / `tmpbox` / `anonymous_channel` |
| `sender` | string | 발신자 이메일 주소 |
| `recipient` | string | 수신자 이메일 주소 |
| `subject` | string | 이메일 제목 |
| `sent_at` | string | 발송 일시 (ISO8601) |
| `has_attachment` | boolean | 첨부파일 존재 여부 |
| `suspicion_reason` | string | 의심으로 분류한 이유 (에이전트 판단) |
| `risk_weight` | number | 이 이메일 한 건의 위험 가중치 점수 |

---

## `suspicious_files[]` — 민감 파일 목록

| 필드 | 타입 | 의미 |
|---|---|---|
| `file_id` | string | DB의 파일 UUID |
| `filename` | string | 파일명 |
| `relative_path` | string | CTF 이미지 내 전체 경로 |
| `sensitivity_score` | number | 민감도 점수 (0.0~1.0, 높을수록 위험) |
| `sensitivity_category` | string | 분류. `단가/계약` / `재무/예산` / `고객·거래처 정보` / `대외비 전략·기획 문서` 등 |
| `matched_keywords` | string[] | 민감도 판단 근거 키워드 목록 |

---

## `behavior_summary` — 행동 이상 요약

| 필드 | 타입 | 의미 |
|---|---|---|
| `highlight_dates` | string[] | 가장 이상 징후가 집중된 날짜 목록 (YYYY-MM-DD) |
| `deleted_files[]` | object[] | 삭제된 파일 목록 |
| `out_of_hours_activity[]` | object[] | 업무 외 시간(22시 이후, 주말) 활동 목록 |
| `notes` | string | 행동 분석 전체 메모 |

### `behavior_summary.deleted_files[]`

| 필드 | 타입 | 의미 |
|---|---|---|
| `original_filename` | string | 삭제된 파일명 |
| `deleted_at` | string | 삭제 일시 (ISO8601) |
| `file_size_bytes` | number | 파일 크기 (bytes) |
| `reason` | string | 삭제 의심 사유 |

### `behavior_summary.out_of_hours_activity[]`

| 필드 | 타입 | 의미 |
|---|---|---|
| `event_type` | string | 이벤트 유형 (예: `파일 실행`, `USB 연결`) |
| `event_at` | string | 발생 일시 (ISO8601) |
| `detail` | string | 상세 내용 |

---

## `timeline[]` — 날짜별 이벤트

| 필드 | 타입 | 의미 |
|---|---|---|
| `date` | string | 날짜 (YYYY-MM-DD) |
| `events[]` | string[] | 해당 날짜에 발생한 의심 이벤트 설명 문자열 목록 |

---

## `evidence_network` — 증거 관계 그래프

### `evidence_network.nodes[]`

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 노드 고유 ID |
| `type` | string | 노드 종류 (아래 표 참고) |
| `label` | string | 화면에 표시할 이름 |

**`type` 값 목록**

| 값 | 의미 |
|---|---|
| `USER` | 분석 대상자 |
| `FILE` | 파일 |
| `EMAIL` | 이메일 이벤트 |
| `CHANNEL` | 이메일 계정 또는 외부 채널 |
| `LOG` | 삭제·접근 로그 |

### `evidence_network.edges[]`

| 필드 | 타입 | 의미 |
|---|---|---|
| `source` | string | 출발 노드 id |
| `target` | string | 도착 노드 id |
| `relation` | string | 관계 유형 (아래 표 참고) |

**`relation` 값 목록**

| 값 | 의미 |
|---|---|
| `USED_CHANNEL` | 해당 계정/채널을 사용함 |
| `SENT_TO` | 해당 채널로 이메일을 발송함 |
| `ATTACHED` | 이메일에 파일을 첨부함 |
| `ACCESSED` | 파일에 접근함 |
| `DELETED` | 파일을 삭제함 |

---

## CLEAN 판정 시 별도 필드

`report_type`이 `CLEAN_CERTIFICATE`일 때는 `suspicious_emails`, `suspicious_files`, `behavior_summary`, `timeline`, `evidence_network` 대신 아래 필드만 존재합니다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `analysis_summary.emails_analyzed` | number | 분석한 이메일 수 |
| `analysis_summary.files_analyzed` | number | 분석한 파일 수 |
| `analysis_summary.anomalies_found` | number | 발견된 이상 징후 수 (CLEAN이면 0) |
| `analysis_summary.false_positives_removed` | number | 할루시네이션으로 제거된 항목 수 |
| `issued_at` | string | 리포트 발급 일시 (ISO8601) |
