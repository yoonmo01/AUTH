# etl/content_store.py
# 역할: 추출된 텍스트를 DB에 저장하는 공용 헬퍼
#   여러 stage(document_extract, hwp_doc_variant, pending_documents 등)에서 공유 사용.
#   extracted_contents + content_chunks 테이블에 UPSERT.
# 공개 함수:
#   replace_file_text_content(...) → 파일 단위 텍스트 저장 (기존 row 교체)
#   store_email_text_content(...)  → 이메일 단위 텍스트 저장

import json
import uuid
from typing import Any

from etl.common import chunk_text, esc, esc_body, psql_run_checked


def _jsonb(value: dict[str, Any] | None) -> str:
    return esc(json.dumps(value or {}, ensure_ascii=False)) + "::jsonb"


def replace_file_text_content(
    *,
    file_id: str,
    text: str,
    content_kind: str,
    unit_type: str,
    processor_name: str,
    model_name: str | None = None,
    prompt_version: str | None = None,
    language: str = "ko",
    confidence: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Replace one file-level extracted content row and its chunks for a processor."""
    content_id = str(uuid.uuid4())
    clean_text = (text or "").replace("\x00", "").strip()
    chunks = chunk_text(clean_text)
    confidence_sql = str(confidence) if confidence is not None else "NULL"
    rows = [
        "BEGIN;",
        "DELETE FROM extracted_contents "
        f"WHERE file_id='{file_id}' AND email_message_id IS NULL "
        f"AND processor_name={esc(processor_name)};",
        "INSERT INTO extracted_contents("
        "id,file_id,email_message_id,content_kind,unit_type,unit_index,text_content,"
        "language,char_count,confidence,processor_name,processor_version,model_name,"
        "prompt_version,metadata,created_at"
        ") VALUES ("
        f"'{content_id}','{file_id}',NULL,{esc(content_kind)},{esc(unit_type)},0,"
        f"{esc_body(clean_text)},{esc(language)},{len(clean_text)},{confidence_sql},"
        f"{esc(processor_name)},NULL,{esc(model_name)},{esc(prompt_version)},"
        f"{_jsonb(metadata)},NOW());",
    ]
    char_pos = 0
    for index, chunk in enumerate(chunks):
        chunk_id = str(uuid.uuid4())
        start = max(0, char_pos)
        end = min(len(clean_text), start + len(chunk))
        rows.append(
            "INSERT INTO content_chunks("
            "id,content_id,file_id,chunk_index,chunk_text,token_count,char_start,char_end"
            ") VALUES ("
            f"'{chunk_id}','{content_id}','{file_id}',{index},"
            f"{esc_body(chunk)},{max(1, len(chunk)//4)},{start},{end});"
        )
        char_pos += len(chunk) - 150
    rows.append("COMMIT;")
    psql_run_checked("\n".join(rows))
    return content_id

