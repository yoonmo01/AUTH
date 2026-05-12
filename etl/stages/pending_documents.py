# etl/stages/pending_documents.py
# 역할: 파이프라인 9단계(옵션) — 미처리 문서 재시도
#   etl_status='pending'이면서 변환/추출이 안 된 파일을 개별로 재처리.
#   주로 document_groups 파이프라인에서 누락된 파일 보완용.
#   process_pending_documents: True 옵션일 때만 실행.
# 쓰는 테이블: extracted_contents, content_chunks, files(etl_status)
# 반환: {processed, success, failed, skipped}

from pathlib import Path

from dotenv import load_dotenv

from etl.common import esc, psql_csv, psql_run_checked
from etl.content_store import replace_file_text_content
from etl.extractors.docx_xml import extract_text as extract_docx_text
from etl.extractors.native_documents import extract_text as extract_native_text


load_dotenv()

SUPPORTED = {".txt", ".csv", ".rtf", ".docx", ".xlsx", ".xls", ".xltx", ".pptx", ".pdf"}


def _target_limit(options: dict) -> str:
    limit = int(options.get("pending_documents_limit") or 0)
    return f" LIMIT {limit}" if limit > 0 else ""


def load_targets(options: dict) -> list[dict]:
    return psql_csv(
        "SELECT id, original_path, relative_path, extension "
        "FROM files "
        "WHERE category='document' AND etl_status='pending' "
        "AND replace(relative_path, chr(92), '/') LIKE '%/C/Users/%' "
        "AND replace(relative_path, chr(92), '/') NOT LIKE '%/AppData/%' "
        "AND extension IN ('.txt','.csv','.rtf','.docx','.xlsx','.xls','.xltx','.pptx','.pdf') "
        "ORDER BY extension, file_size NULLS LAST, id"
        f"{_target_limit(options)};"
    )


def _extract(path: Path, extension: str) -> tuple[str, str]:
    if extension == ".docx":
        return extract_docx_text(path), "native-docx-xml"
    return extract_native_text(path, extension)


def run(options: dict) -> dict:
    targets = load_targets(options)
    success = failed = skipped = 0
    for row in targets:
        file_id = row["id"]
        path = Path(row["original_path"])
        try:
            if not path.exists():
                raise FileNotFoundError(str(path))
            text, processor = _extract(path, row["extension"])
            if not text.strip():
                skipped += 1
                psql_run_checked(
                    "UPDATE files SET etl_status='skipped', etl_error='empty text from pending document parser', "
                    f"etl_processed_at=NOW() WHERE id='{file_id}';"
                )
                continue
            replace_file_text_content(
                file_id=file_id,
                text=text,
                content_kind="text",
                unit_type="document",
                processor_name=f"pending-document-{processor}",
                metadata={
                    "source": "pending_documents",
                    "relative_path": row.get("relative_path"),
                    "extension": row.get("extension"),
                },
            )
            psql_run_checked(
                "INSERT INTO documents(file_id, doc_type, processor_name, extracted_at) "
                f"VALUES('{file_id}', {esc(row['extension'].lstrip('.'))}, {esc(processor)}, NOW()) "
                "ON CONFLICT(file_id) DO UPDATE SET "
                "processor_name=EXCLUDED.processor_name, extraction_error=NULL, extracted_at=EXCLUDED.extracted_at;"
                "UPDATE files SET etl_status='done', etl_error=NULL, etl_processed_at=NOW() "
                f"WHERE id='{file_id}';"
            )
            success += 1
        except Exception as exc:
            failed += 1
            psql_run_checked(
                "UPDATE files SET etl_status='failed', "
                f"etl_error={esc(str(exc)[:500])}, etl_processed_at=NOW() WHERE id='{file_id}';"
            )
    return {"processed": len(targets), "success": success, "failed": failed, "skipped": skipped}


if __name__ == "__main__":
    print(run({}))

