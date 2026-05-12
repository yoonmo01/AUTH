# etl/stages/hwp_doc_variant.py
# 역할: 파이프라인 7단계 — HWP/DOC 동일 서식 쌍 처리
#   같은 폴더에 .hwp와 .doc이 함께 있는 경우 format_variant 관계 생성.
#   .doc을 docx로 변환하여 텍스트를 추출하고 .hwp 파일에도 전파.
#   참조 SQL: scripts/propagate_hwp_doc_variants.sql
# 쓰는 테이블: file_relations(format_variant), extracted_contents, content_chunks, file_derivatives
# 반환: {processed, success, failed, skipped}

import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

from etl.common import chunk_text, esc, esc_body, new_id, psql_csv, psql_run_checked
from etl.extractors.docx_xml import extract_text as extract_docx_text

ROOT = Path(__file__).resolve().parents[2]
CONVERTED_ROOT = Path(os.getenv("HYENA_CONVERTED_ROOT", str(ROOT / "converted_documents")))
DOCX_DIR = CONVERTED_ROOT / "docx"
ENUM_SQL = ROOT / "scripts" / "20260505_format_variant_enum.sql"
VARIANT_SQL = ROOT / "scripts" / "propagate_hwp_doc_variants.sql"

_MANIFEST: list[dict] | None = None
CHUNK_SIZE = 1500
CHUNK_STEP = 1350
DOC_BATCH = 200
CHUNK_BATCH = 500


def scalar(sql: str) -> int:
    rows = psql_csv(sql)
    return int(rows[0]["cnt"]) if rows else 0


def _is_valid_docx(path: Path) -> bool:
    try:
        return path.exists() and path.stat().st_size > 0 and zipfile.is_zipfile(path)
    except Exception:
        return False


def _load_manifest() -> list[dict]:
    global _MANIFEST
    if _MANIFEST is not None:
        return _MANIFEST
    manifest_path = CONVERTED_ROOT / "manifest.jsonl"
    rows: list[dict] = []
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    _MANIFEST = rows
    return rows


def _find_docx(file_id: str, sha256_hash: str | None) -> Path | None:
    # 1. {file_id}.docx in DOCX_DIR (new DB file_id — unlikely but try)
    p = DOCX_DIR / f"{file_id}.docx"
    if _is_valid_docx(p):
        return p
    # 2. manifest lookup by sha256 — covers old capstone file_ids
    for entry in _load_manifest():
        if entry.get("source_ext") != ".doc":
            continue
        if sha256_hash and entry.get("sha256_hash") != sha256_hash:
            continue
        target = entry.get("target_path") or entry.get("converted_path")
        if not target:
            continue
        p = Path(str(target))
        if _is_valid_docx(p):
            return p
        # fallback: same filename in DOCX_DIR (if user copied files here)
        p2 = DOCX_DIR / p.name
        if _is_valid_docx(p2):
            return p2
    return None


def _esc_body_idx(s: str, idx: int) -> str:
    """Dollar-quoted escape with a unique per-row delimiter for safe batching."""
    s = s.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
    delim = f"$R{idx:08x}$"
    if delim not in s:
        return f"{delim}{s}{delim}"
    return "'" + s.replace("'", "''") + "'"


def _flush_documents(rows: list[str]) -> None:
    if not rows:
        return
    psql_run_checked(
        "INSERT INTO documents(id, file_id, doc_type, page_count, sheet_count, processor_name, extracted_at) VALUES "
        + ",".join(rows) + " ON CONFLICT DO NOTHING;"
    )


def _flush_contents(rows: list[str]) -> None:
    if not rows:
        return
    psql_run_checked(
        "INSERT INTO extracted_contents("
        "id, file_id, email_message_id, content_kind, unit_type, unit_index, "
        "text_content, language, char_count, confidence, "
        "processor_name, processor_version, model_name, prompt_version, metadata, created_at"
        ") VALUES " + ",".join(rows) + " ON CONFLICT DO NOTHING;"
    )


def _flush_chunks(rows: list[str]) -> None:
    if not rows:
        return
    psql_run_checked(
        "INSERT INTO content_chunks(id, content_id, file_id, chunk_index, chunk_text, "
        "token_count, char_start, char_end) VALUES "
        + ",".join(rows) + " ON CONFLICT DO NOTHING;"
    )


def _flush_file_ids(done_ids: list[str]) -> None:
    if not done_ids:
        return
    id_list = ",".join(f"'{fid}'" for fid in done_ids)
    psql_run_checked(
        f"UPDATE files SET etl_status='done', etl_error=NULL, etl_processed_at=NOW() "
        f"WHERE id IN ({id_list});"
    )


def _extract_doc_pairs(options: dict) -> tuple[int, int]:
    """
    For each DOC file paired with a pending HWP that has no extracted_contents:
    - Group by sha256 so text is extracted once per unique document content
    - Batch-insert documents / extracted_contents / content_chunks
    """
    rows = psql_csv(
        "SELECT DISTINCT ON (d.id) d.id, d.sha256_hash "
        "FROM files h "
        "JOIN files d "
        "  ON d.category='document' AND d.extension='.doc' "
        "  AND regexp_replace(d.original_path, '\\\\[^\\\\]*$', '') = "
        "      regexp_replace(h.original_path, '\\\\[^\\\\]*$', '') "
        "LEFT JOIN extracted_contents ec "
        "  ON ec.file_id = d.id AND ec.email_message_id IS NULL "
        "WHERE h.category='document' AND h.extension='.hwp' "
        "  AND h.etl_status IN ('skipped','pending','failed') "
        "  AND ec.id IS NULL "
        "ORDER BY d.id;"
    )
    if not rows:
        return 0, 0

    # Group file_ids by sha256 so we extract once per unique content
    by_sha: dict[str | None, list[str]] = defaultdict(list)
    for row in rows:
        by_sha[row.get("sha256_hash") or None].append(row["id"])

    doc_rows: list[str] = []
    content_rows: list[str] = []
    chunk_rows: list[str] = []
    done_ids: list[str] = []
    row_idx = 0
    extracted = skipped = 0

    for sha256, file_ids in by_sha.items():
        # Use the first file_id to locate the docx (sha256-based manifest lookup)
        docx_path = _find_docx(file_ids[0], sha256)
        if docx_path is None:
            print(f"  [variant] no docx for sha256={sha256} ({len(file_ids)} files)", file=sys.stderr)
            skipped += len(file_ids)
            continue

        try:
            text = extract_docx_text(docx_path)
        except Exception as exc:
            print(f"  [variant WARN] extract failed sha256={sha256}: {exc}", file=sys.stderr)
            skipped += len(file_ids)
            continue

        if not text.strip():
            skipped += len(file_ids)
            continue

        text_len = len(text)
        chunks = chunk_text(text, size=CHUNK_SIZE, overlap=CHUNK_SIZE - CHUNK_STEP)

        for file_id in file_ids:
            content_id = new_id()
            doc_rows.append(
                f"('{new_id()}', '{file_id}', 'doc', 1, 0, 'hwp-variant-doc-extract', NOW())"
            )
            content_rows.append(
                f"('{content_id}', '{file_id}', NULL, 'text', 'document', 0, "
                f"{_esc_body_idx(text, row_idx)}, 'ko', {text_len}, NULL, "
                f"'hwp-variant-doc-extract', NULL, NULL, NULL, '{{}}'::jsonb, NOW())"
            )
            row_idx += 1
            for idx, chunk in enumerate(chunks):
                char_start = idx * CHUNK_STEP
                char_end = min(char_start + CHUNK_SIZE, text_len)
                tok = max(1, len(chunk) // 4)
                chunk_rows.append(
                    f"('{new_id()}', '{content_id}', '{file_id}', {idx}, "
                    f"{_esc_body_idx(chunk, row_idx)}, {tok}, {char_start}, {char_end})"
                )
                row_idx += 1
                if len(chunk_rows) >= CHUNK_BATCH:
                    _flush_chunks(chunk_rows)
                    chunk_rows.clear()

            done_ids.append(file_id)
            extracted += 1

            if len(doc_rows) >= DOC_BATCH:
                _flush_documents(doc_rows)
                _flush_contents(content_rows)
                doc_rows.clear()
                content_rows.clear()

    _flush_documents(doc_rows)
    _flush_contents(content_rows)
    _flush_chunks(chunk_rows)
    _flush_file_ids(done_ids)

    return extracted, skipped


def run(options: dict) -> dict:
    if not options.get("enable_hwp_doc_variant", True):
        return {"status": "skipped", "message": "hwp-doc format variant disabled"}

    psql_run_checked(ENUM_SQL.read_text(encoding="utf-8"))

    doc_extracted, doc_skipped = _extract_doc_pairs(options)
    print(f"  [variant] doc extraction done: extracted={doc_extracted}, skipped={doc_skipped}")

    before = scalar(
        "SELECT count(*) AS cnt FROM files h "
        "JOIN files d ON d.category='document' AND d.extension='.doc' "
        "AND regexp_replace(d.original_path, '\\\\[^\\\\]*$', '') = regexp_replace(h.original_path, '\\\\[^\\\\]*$', '') "
        "WHERE h.category='document' AND h.extension='.hwp' "
        "AND h.etl_status IN ('skipped','pending','failed');"
    )
    print(f"  [variant] running propagate SQL on {before} HWP-DOC pairs ...")
    psql_run_checked(VARIANT_SQL.read_text(encoding="utf-8"))

    propagated = scalar(
        "SELECT count(*) AS cnt FROM file_relations "
        "WHERE relation_type='format_variant' "
        "AND metadata->>'reason'='hwp_doc_format_variant';"
    )
    remaining = scalar(
        "SELECT count(*) AS cnt FROM files h "
        "JOIN files d ON d.category='document' AND d.extension='.doc' "
        "AND regexp_replace(d.original_path, '\\\\[^\\\\]*$', '') = regexp_replace(h.original_path, '\\\\[^\\\\]*$', '') "
        "WHERE h.category='document' AND h.extension='.hwp' "
        "AND h.etl_status IN ('skipped','pending','failed');"
    )
    return {
        "processed": before,
        "success": propagated,
        "skipped": remaining,
        "message": (
            f"docs_extracted={doc_extracted}, docs_skipped={doc_skipped}, "
            f"format_variant_relations={propagated}, remaining_pair_candidates={remaining}"
        ),
    }
