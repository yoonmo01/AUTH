# etl/stages/document_propagate.py
# 역할: 파이프라인 8단계 — 그룹 추출 결과 전파
#   document_processing_groups에서 대표 파일의 텍스트를 같은 그룹 내
#   나머지 중복 파일들의 extracted_contents/content_chunks에 복사.
#   SQL: scripts/propagate_group_results_server_side.sql (서버사이드 실행)
# 쓰는 테이블: extracted_contents, content_chunks, file_derivatives
# 반환: {processed, success, failed}

from pathlib import Path

from etl.common import psql_csv, psql_run_checked


ROOT = Path(__file__).resolve().parents[2]
PROPAGATE_SQL = ROOT / "scripts" / "propagate_group_results_server_side.sql"


def count_scalar(sql: str) -> int:
    rows = psql_csv(sql)
    if not rows:
        return 0
    return int(next(iter(rows[0].values())))


def run(options: dict) -> dict:
    if not PROPAGATE_SQL.exists():
        raise RuntimeError(f"missing propagation SQL: {PROPAGATE_SQL}")

    before_missing = count_scalar(
        "SELECT count(*) FROM document_processing_group_files gf "
        "JOIN document_processing_group_results r "
        "  ON r.group_id=gf.group_id AND r.extraction_status='done' "
        "LEFT JOIN extracted_contents ec "
        "  ON ec.file_id=gf.file_id AND ec.email_message_id IS NULL "
        "WHERE ec.id IS NULL;"
    )
    processed = count_scalar(
        "SELECT count(*) FROM document_processing_group_results "
        "WHERE extraction_status='done' AND text_content IS NOT NULL AND btrim(text_content) <> '';"
    )

    psql_run_checked(PROPAGATE_SQL.read_text(encoding="utf-8"))

    after_missing = count_scalar(
        "SELECT count(*) FROM document_processing_group_files gf "
        "JOIN document_processing_group_results r "
        "  ON r.group_id=gf.group_id AND r.extraction_status='done' "
        "LEFT JOIN extracted_contents ec "
        "  ON ec.file_id=gf.file_id AND ec.email_message_id IS NULL "
        "WHERE ec.id IS NULL;"
    )
    propagated_files = count_scalar(
        "SELECT count(*) FROM document_processing_group_files gf "
        "JOIN document_processing_group_results r "
        "  ON r.group_id=gf.group_id AND r.extraction_status='done';"
    )
    failed = 1 if after_missing else 0
    return {
        "processed": processed,
        "success": propagated_files,
        "failed": failed,
        "skipped": 0,
        "message": f"propagation_missing before={before_missing}, after={after_missing}",
    }
