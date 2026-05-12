# etl/stages/audit.py
# 역할: 파이프라인 16단계 (마지막) — 파이프라인 품질 감사
#   파이프라인 완료 후 DB 상태를 검사하여 누락/불일치를 탐지.
#   실패 카운트가 0이 아니면 pipeline.py에서 done_with_errors로 처리.
# 검사 항목:
#   - 그룹 변환/추출 통계
#   - propagation_missing (전파 누락 파일 수)
#   - done_document_no_content (완료 처리됐으나 콘텐츠 없는 파일)
#   - 이메일 첨부 무결성
#   - HWP/DOC variant 관계 수
# 반환: {processed, success, failed, skipped, message(JSON)}

import json

from etl.common import psql_csv


def scalar(sql: str) -> int:
    rows = psql_csv(sql)
    return int(rows[0]["cnt"]) if rows else 0


def run(options: dict) -> dict:
    checks = {
        "document_groups": scalar("SELECT count(*) AS cnt FROM document_processing_groups;"),
        "groups_converted": scalar("SELECT count(*) AS cnt FROM document_processing_groups WHERE convert_status='done';"),
        "groups_pending_conversion": scalar(
            "SELECT count(*) AS cnt FROM document_processing_groups "
            "WHERE extension IN ('.doc','.hwp') AND convert_status='pending';"
        ),
        "groups_extracted": scalar("SELECT count(*) AS cnt FROM document_processing_group_results WHERE extraction_status='done';"),
        "groups_empty_text": scalar(
            "SELECT count(*) AS cnt FROM document_processing_group_results "
            "WHERE extraction_status='done' AND COALESCE(char_count,0)=0;"
        ),
        "propagation_missing": scalar(
            "SELECT count(*) AS cnt "
            "FROM document_processing_group_files gf "
            "JOIN document_processing_group_results r ON r.group_id=gf.group_id AND r.extraction_status='done' "
            "LEFT JOIN extracted_contents ec ON ec.file_id=gf.file_id AND ec.email_message_id IS NULL "
            "WHERE ec.id IS NULL;"
        ),
        "done_document_no_content": scalar(
            "SELECT count(*) AS cnt FROM ("
            "SELECT f.id FROM files f "
            "LEFT JOIN extracted_contents ec ON ec.file_id=f.id AND ec.email_message_id IS NULL "
            "WHERE f.category='document' AND f.etl_status='done' "
            "GROUP BY f.id HAVING count(ec.id)=0"
            ") missing;"
        ),
        "replacement_char_rows": scalar(
            "SELECT count(*) AS cnt FROM extracted_contents "
            "WHERE email_message_id IS NULL AND text_content LIKE '%�%';"
        ),
        "derivative_missing_for_converted": scalar(
            "SELECT count(*) AS cnt "
            "FROM document_processing_group_files gf "
            "JOIN document_processing_groups g ON g.id=gf.group_id AND g.converted_path IS NOT NULL "
            "JOIN document_processing_group_results r ON r.group_id=gf.group_id AND r.extraction_status='done' "
            "LEFT JOIN file_derivatives fd ON fd.parent_file_id=gf.file_id "
            "AND fd.extracted_path=g.converted_path "
            "WHERE fd.id IS NULL;"
        ),
        "email_attachments": scalar("SELECT count(*) AS cnt FROM email_attachments;"),
        "attachment_without_file": scalar(
            "SELECT count(*) AS cnt FROM email_attachments ea "
            "LEFT JOIN files f ON f.id=ea.file_id WHERE f.id IS NULL;"
        ),
        "attachment_without_email": scalar(
            "SELECT count(*) AS cnt FROM email_attachments ea "
            "LEFT JOIN email_messages em ON em.id=ea.email_id WHERE em.id IS NULL;"
        ),
        "hwp_doc_variant_relations": scalar(
            "SELECT count(*) AS cnt FROM file_relations WHERE relation_type='format_variant';"
        ),
    }
    failed = (
        checks["propagation_missing"]
        + checks["groups_empty_text"]
        + checks["derivative_missing_for_converted"]
        + checks["attachment_without_file"]
        + checks["attachment_without_email"]
    )
    return {
        "processed": checks["document_groups"],
        "success": checks["groups_extracted"],
        "failed": failed,
        "skipped": checks["groups_pending_conversion"],
        "message": json.dumps(checks, ensure_ascii=False),
    }
