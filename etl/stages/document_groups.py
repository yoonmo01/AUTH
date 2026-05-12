# etl/stages/document_groups.py
# 역할: 파이프라인 4단계 — 문서 해시 그룹화
#   sha256이 동일한 파일들을 document_processing_groups로 묶는다.
#   중복 파일을 한 번만 변환/추출 후 전파하기 위한 전처리.
#   is_likely_form 플래그: 서식 파일 패턴 감지.
# 쓰는 테이블: document_processing_groups, document_processing_group_files
# 반환: {processed, success}

from etl.common import psql_csv, psql_run_checked
from etl.document_groups import rebuild_document_processing_groups


GROUP_RESULTS_SQL = """
CREATE TABLE IF NOT EXISTS document_processing_group_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id            UUID NOT NULL REFERENCES document_processing_groups(id) ON DELETE CASCADE,
    source_file_id      UUID REFERENCES files(id) ON DELETE SET NULL,
    converted_path      TEXT,
    processor_name      TEXT,
    processor_version   TEXT,
    extraction_status   TEXT NOT NULL DEFAULT 'pending'
                        CHECK (extraction_status IN ('pending','done','failed','skipped')),
    text_content        TEXT,
    language            VARCHAR(20),
    char_count          INT DEFAULT 0,
    chunk_count         INT DEFAULT 0,
    error               TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (group_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_group_results_group
ON document_processing_group_results(group_id);

CREATE INDEX IF NOT EXISTS idx_doc_group_results_status
ON document_processing_group_results(extraction_status);
"""


def ensure_schema() -> None:
    psql_run_checked(GROUP_RESULTS_SQL)


def run() -> dict:
    ensure_schema()
    rebuild_document_processing_groups()
    groups = psql_csv("SELECT count(*) AS cnt FROM document_processing_groups;")
    files = psql_csv("SELECT count(*) AS cnt FROM document_processing_group_files;")
    return {
        "processed": int(groups[0]["cnt"]) if groups else 0,
        "success": int(files[0]["cnt"]) if files else 0,
    }
