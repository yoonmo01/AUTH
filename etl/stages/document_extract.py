# etl/stages/document_extract.py
# 역할: 파이프라인 6단계 — 문서 텍스트 추출
#   변환된 .docx/.hwpx에서 XML 파서로 텍스트 추출.
#   .pdf/.xls/.xlsx/.pptx/.txt/.csv/.rtf는 네이티브 추출기 사용.
#   추출된 텍스트는 content_store를 통해 extracted_contents + content_chunks에 저장.
# 쓰는 테이블: document_processing_group_results, extracted_contents, content_chunks
# 반환: {processed, success, failed, skipped}

import json
from pathlib import Path

from etl.common import chunk_text, esc, esc_body, psql_csv, psql_run_checked
from etl.extractors.docx_xml import extract_text as extract_docx_text
from etl.extractors.hwpx_xml import extract_text as extract_hwpx_text
from etl.extractors.native_documents import extract_text as extract_native_text


SUPPORTED_NATIVE = {".pdf", ".xls", ".xlsx", ".xltx", ".pptx", ".txt", ".csv", ".rtf"}


def load_groups(options: dict) -> list[dict]:
    force_reextract = bool(options.get("force_reextract", False))
    where_extra = ""
    if not force_reextract:
        where_extra = (
            "AND NOT ("
            "g.status='propagated' AND g.extract_status='done' "
            "AND EXISTS ("
            "  SELECT 1 FROM document_processing_group_results r "
            "  WHERE r.group_id=g.id AND r.extraction_status='done'"
            ")"
            ") "
            "AND NOT ("
            "g.status='skipped' AND g.extract_status='skipped' "
            "AND EXISTS ("
            "  SELECT 1 FROM document_processing_group_results r "
            "  WHERE r.group_id=g.id AND r.extraction_status='skipped'"
            ")"
            ") "
        )
    limit = ""
    if options.get("max_groups"):
        limit = f" LIMIT {int(options['max_groups'])}"
    return psql_csv(
        "SELECT g.id, g.extension, g.representative_file_id, g.converted_path, "
        "g.convert_status, f.original_path "
        "FROM document_processing_groups g "
        "JOIN files f ON f.id=g.representative_file_id "
        "WHERE g.extension IN ('.doc','.hwp','.docx','.pdf','.xls','.xlsx','.xltx','.pptx','.txt','.csv','.rtf') "
        f"{where_extra}"
        "ORDER BY g.priority, g.extension"
        f"{limit};"
    )


def store_result(
    group_id: str,
    source_file_id: str,
    source_path: Path,
    processor: str,
    text: str,
    metadata: dict,
) -> None:
    chunks = chunk_text(text)
    metadata_json = json.dumps(metadata, ensure_ascii=False)
    psql_run_checked(
        "INSERT INTO document_processing_group_results("
        "group_id,source_file_id,converted_path,processor_name,extraction_status,text_content,"
        "language,char_count,chunk_count,error,metadata,updated_at"
        ") VALUES ("
        f"'{group_id}','{source_file_id}',{esc(str(source_path))},{esc(processor)},'done',"
        f"{esc_body(text)},'ko',{len(text)},{len(chunks)},NULL,{esc(metadata_json)}::jsonb,NOW()"
        ") ON CONFLICT (group_id) DO UPDATE SET "
        "source_file_id=EXCLUDED.source_file_id, "
        "converted_path=EXCLUDED.converted_path, "
        "processor_name=EXCLUDED.processor_name, "
        "extraction_status=EXCLUDED.extraction_status, "
        "text_content=EXCLUDED.text_content, "
        "language=EXCLUDED.language, "
        "char_count=EXCLUDED.char_count, "
        "chunk_count=EXCLUDED.chunk_count, "
        "error=NULL, "
        "metadata=EXCLUDED.metadata, "
        "updated_at=NOW();"
    )
    psql_run_checked(
        "UPDATE document_processing_groups SET "
        "status='extracted', extract_status='done', error=NULL, processed_at=NOW() "
        f"WHERE id='{group_id}';"
    )


def store_failure(group_id: str, status: str, message: str, state: str) -> None:
    extraction_status = "skipped" if status == "skipped" else "failed"
    psql_run_checked(
        "INSERT INTO document_processing_group_results("
        "group_id,extraction_status,char_count,chunk_count,error,metadata,updated_at"
        ") VALUES ("
        f"'{group_id}',{esc(extraction_status)},0,0,{esc(message[:500])},"
        f"{esc(json.dumps({'extraction_state': state}, ensure_ascii=False))}::jsonb,NOW()"
        ") ON CONFLICT (group_id) DO UPDATE SET "
        "extraction_status=EXCLUDED.extraction_status, "
        "char_count=0, chunk_count=0, error=EXCLUDED.error, metadata=EXCLUDED.metadata, updated_at=NOW();"
    )
    group_status = "pending" if state == "pending_conversion" else status
    extract_status = "pending" if state == "pending_conversion" else extraction_status
    psql_run_checked(
        "UPDATE document_processing_groups SET "
        f"status={esc(group_status)}, extract_status={esc(extract_status)}, "
        f"error={esc(message[:500])}, processed_at=NOW() "
        f"WHERE id='{group_id}';"
    )


def extract_group(group: dict) -> tuple[str, Path, str]:
    ext = group["extension"]
    if ext == ".doc":
        if not group.get("converted_path"):
            raise RuntimeError("pending_conversion: missing docx artifact")
        path = Path(group["converted_path"])
        return extract_docx_text(path), path, "converted-docx-xml"
    if ext == ".hwp":
        if not group.get("converted_path"):
            raise RuntimeError("pending_conversion: missing hwpx artifact")
        path = Path(group["converted_path"])
        return extract_hwpx_text(path), path, "converted-hwpx-xml"
    if ext == ".docx":
        path = Path(group["original_path"])
        return extract_docx_text(path), path, "native-docx-xml"
    if ext in SUPPORTED_NATIVE:
        path = Path(group["original_path"])
        text, processor = extract_native_text(path, ext)
        return text, path, processor
    raise RuntimeError(f"unsupported extraction extension: {ext}")


def run(options: dict) -> dict:
    groups = load_groups(options)
    success = failed = skipped = 0
    for group in groups:
        try:
            text, source_path, processor = extract_group(group)
            if not text.strip():
                store_failure(group["id"], "skipped", "empty text from group representative", "empty_text")
                skipped += 1
                continue
            store_result(
                group["id"],
                group["representative_file_id"],
                source_path,
                processor,
                text,
                {
                    "grouping": "sha256_hash+extension",
                    "source_extension": group["extension"],
                    "source_kind": "converted" if group["extension"] in {".doc", ".hwp"} else "native",
                },
            )
            success += 1
        except Exception as exc:
            message = str(exc)
            if message.startswith("pending_conversion"):
                store_failure(group["id"], "skipped", message, "pending_conversion")
                skipped += 1
            else:
                store_failure(group["id"], "failed", message, "extract_failed")
                failed += 1
    return {"processed": len(groups), "success": success, "failed": failed, "skipped": skipped}
