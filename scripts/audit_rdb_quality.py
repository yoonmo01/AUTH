# scripts/audit_rdb_quality.py
# 역할: 파이프라인 완료 후 RDB 품질 전체 검사 (독립 실행 가능)
#   파이프라인의 audit 스테이지보다 상세한 11개 항목을 탭 구분 텍스트로 출력.
# 검사 항목:
#   category_status, core_counts, traceability, state_mismatches,
#   email_quality, email_quality_by_store_type, email_attachment_summary,
#   ost_ignored_summary, document_encoding, document_group_pipeline,
#   hwp_doc_pair_summary
# 실행: python scripts/audit_rdb_quality.py
# 출력: 표준출력 (탭 구분 텍스트, ## 섹션 헤더)

import csv
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from etl.common import copy_and_run


CHECKS = [
    (
        "category_status",
        "SELECT category, etl_status, count(*) AS cnt "
        "FROM files GROUP BY category, etl_status ORDER BY category, etl_status;",
    ),
    (
        "core_counts",
        "SELECT 'files' AS table_name, count(*) FROM files "
        "UNION ALL SELECT 'directories', count(*) FROM directories "
        "UNION ALL SELECT 'documents', count(*) FROM documents "
        "UNION ALL SELECT 'extracted_contents', count(*) FROM extracted_contents "
        "UNION ALL SELECT 'content_chunks', count(*) FROM content_chunks "
        "UNION ALL SELECT 'email_messages', count(*) FROM email_messages "
        "UNION ALL SELECT 'email_attachments', count(*) FROM email_attachments "
        "UNION ALL SELECT 'activity_events', count(*) FROM activity_events "
        "UNION ALL SELECT 'entity_canonical', count(*) FROM entity_canonical "
        "UNION ALL SELECT 'entities', count(*) FROM entities "
        "UNION ALL SELECT 'file_relations', count(*) FROM file_relations "
        "ORDER BY table_name;",
    ),
    (
        "traceability",
        "SELECT 'files_without_source' AS check_name, count(*) FROM files f "
        "LEFT JOIN evidence_sources es ON es.id=f.evidence_source_id WHERE es.id IS NULL "
        "UNION ALL SELECT 'documents_without_file', count(*) FROM documents d LEFT JOIN files f ON f.id=d.file_id WHERE f.id IS NULL "
        "UNION ALL SELECT 'emails_without_file', count(*) FROM email_messages em LEFT JOIN files f ON f.id=em.source_file_id WHERE f.id IS NULL "
        "UNION ALL SELECT 'contents_without_file', count(*) FROM extracted_contents ec LEFT JOIN files f ON f.id=ec.file_id WHERE f.id IS NULL "
        "UNION ALL SELECT 'chunks_without_content', count(*) FROM content_chunks cc LEFT JOIN extracted_contents ec ON ec.id=cc.content_id WHERE ec.id IS NULL "
        "UNION ALL SELECT 'relations_bad_source', count(*) FROM file_relations fr LEFT JOIN files f ON f.id=fr.source_file_id WHERE f.id IS NULL "
        "UNION ALL SELECT 'relations_bad_target', count(*) FROM file_relations fr LEFT JOIN files f ON f.id=fr.target_file_id WHERE f.id IS NULL;",
    ),
    (
        "state_mismatches",
        "SELECT 'done_document_no_document_row' AS check_name, count(*) FROM ("
        "SELECT f.id FROM files f LEFT JOIN documents d ON d.file_id=f.id "
        "WHERE f.category='document' AND f.etl_status='done' AND d.id IS NULL) x "
        "UNION ALL SELECT 'done_document_no_extracted_content', count(*) FROM ("
        "SELECT f.id FROM files f LEFT JOIN extracted_contents ec ON ec.file_id=f.id "
        "WHERE f.category='document' AND f.etl_status='done' GROUP BY f.id HAVING count(ec.id)=0) x "
        "UNION ALL SELECT 'done_email_store_no_email', count(*) FROM ("
        "SELECT f.id FROM files f LEFT JOIN email_messages em ON em.source_file_id=f.id "
        "WHERE f.category='email_store' AND f.extension IN ('.pst','.ost') AND f.etl_status='done' "
        "GROUP BY f.id HAVING count(em.id)=0) x "
        "UNION ALL SELECT 'done_file_has_etl_error', count(*) FROM files WHERE etl_status='done' AND etl_error IS NOT NULL;",
    ),
    (
        "email_quality",
        "SELECT 'email_missing_subject' AS check_name, count(*) FROM email_messages WHERE subject IS NULL OR btrim(subject)='' "
        "UNION ALL SELECT 'email_missing_sender', count(*) FROM email_messages WHERE sender IS NULL OR btrim(sender)='' "
        "UNION ALL SELECT 'email_missing_sent_at', count(*) FROM email_messages WHERE sent_at IS NULL "
        "UNION ALL SELECT 'email_empty_body', count(*) FROM email_messages WHERE body_text IS NULL OR btrim(body_text)='' "
        "UNION ALL SELECT 'email_subject_encoded_word', count(*) FROM email_messages WHERE subject LIKE '=?%' "
        "UNION ALL SELECT 'email_sender_encoded_word', count(*) FROM email_messages WHERE sender LIKE '=?%';",
    ),
    (
        "email_quality_by_store_type",
        "SELECT f.extension AS store_type, count(em.id) AS emails, "
        "count(*) FILTER (WHERE em.body_text IS NULL OR btrim(em.body_text)='') AS empty_body, "
        "count(*) FILTER (WHERE em.has_attachments IS TRUE) AS has_attachments "
        "FROM email_messages em JOIN files f ON f.id=em.source_file_id "
        "GROUP BY f.extension ORDER BY f.extension;",
    ),
    (
        "email_attachment_summary",
        "SELECT 'email_attachments' AS check_name, count(*) FROM email_attachments "
        "UNION ALL SELECT 'attachment_files', count(*) FROM files WHERE original_path LIKE '%extracted_email_attachments%' "
        "UNION ALL SELECT 'attachment_without_file', count(*) FROM email_attachments ea LEFT JOIN files f ON f.id=ea.file_id WHERE f.id IS NULL "
        "UNION ALL SELECT 'attachment_without_email', count(*) FROM email_attachments ea LEFT JOIN email_messages em ON em.id=ea.email_id WHERE em.id IS NULL "
        "UNION ALL SELECT 'messages_marked_with_attachments', count(*) FROM email_messages WHERE has_attachments IS TRUE;",
    ),
    (
        "ost_ignored_summary",
        "SELECT extension, etl_status, count(*) AS cnt "
        "FROM files WHERE category='email_store' GROUP BY extension, etl_status ORDER BY extension, etl_status;",
    ),
    (
        "document_encoding",
        "SELECT f.extension, count(*) AS extracted_rows, "
        "count(*) FILTER (WHERE ec.text_content LIKE '%�%') AS replacement_char_rows, "
        "round(100.0*count(*) FILTER (WHERE ec.text_content LIKE '%�%')/nullif(count(*),0),2) AS pct_replacement "
        "FROM extracted_contents ec JOIN files f ON f.id=ec.file_id "
        "WHERE f.category='document' GROUP BY f.extension ORDER BY replacement_char_rows DESC, extracted_rows DESC;",
    ),
    (
        "document_group_pipeline",
        "SELECT 'groups_total' AS check_name, count(*) FROM document_processing_groups "
        "UNION ALL SELECT 'groups_converted', count(*) FROM document_processing_groups WHERE convert_status='done' "
        "UNION ALL SELECT 'groups_pending_conversion', count(*) FROM document_processing_groups WHERE extension IN ('.doc','.hwp') AND convert_status='pending' "
        "UNION ALL SELECT 'groups_extracted', count(*) FROM document_processing_group_results WHERE extraction_status='done' "
        "UNION ALL SELECT 'groups_empty_text', count(*) FROM document_processing_group_results WHERE extraction_status='done' AND COALESCE(char_count,0)=0 "
        "UNION ALL SELECT 'propagation_missing', count(*) FROM document_processing_group_files gf "
        "JOIN document_processing_group_results r ON r.group_id=gf.group_id AND r.extraction_status='done' "
        "LEFT JOIN extracted_contents ec ON ec.file_id=gf.file_id AND ec.email_message_id IS NULL WHERE ec.id IS NULL "
        "UNION ALL SELECT 'derivative_missing_for_converted', count(*) FROM document_processing_group_files gf "
        "JOIN document_processing_groups g ON g.id=gf.group_id AND g.converted_path IS NOT NULL "
        "JOIN document_processing_group_results r ON r.group_id=gf.group_id AND r.extraction_status='done' "
        "LEFT JOIN file_derivatives fd ON fd.parent_file_id=gf.file_id AND fd.extracted_path=g.converted_path WHERE fd.id IS NULL;",
    ),
    (
        "hwp_doc_pair_summary",
        "WITH pairs AS ("
        "SELECT h.id AS hwp_id, d.id AS doc_id, h.etl_status AS hwp_status, d.etl_status AS doc_status "
        "FROM files h JOIN files d ON d.category='document' AND d.extension='.doc' "
        "AND regexp_replace(d.original_path, '\\\\[^\\\\]*$', '') = regexp_replace(h.original_path, '\\\\[^\\\\]*$', '') "
        "WHERE h.category='document' AND h.extension='.hwp'"
        ") "
        "SELECT 'hwp_total' AS check_name, count(*) FROM files WHERE category='document' AND extension='.hwp' "
        "UNION ALL SELECT 'hwp_with_same_folder_doc', count(DISTINCT hwp_id) FROM pairs "
        "UNION ALL SELECT 'hwp_doc_variant_relations', count(*) FROM file_relations WHERE relation_type='format_variant' "
        "UNION ALL SELECT 'hwp_remaining_skipped_with_doc', count(DISTINCT hwp_id) FROM pairs WHERE hwp_status IN ('skipped','pending','failed');",
    ),
]


def query(sql: str) -> list[dict]:
    rc, out, err = copy_and_run(sql, ["--csv"])
    if rc != 0:
        raise RuntimeError(err)
    return list(csv.DictReader(io.StringIO(out)))


def main() -> None:
    for name, sql in CHECKS:
        print(f"\n## {name}")
        rows = query(sql)
        if not rows:
            print("(no rows)")
            continue
        print("\t".join(rows[0].keys()))
        for row in rows:
            print("\t".join(str(v) for v in row.values()))


if __name__ == "__main__":
    main()
