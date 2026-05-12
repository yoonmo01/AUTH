# etl/stages/document_convert.py
# 역할: 파이프라인 5단계 — 문서 변환
#   .hwp → .hwpx (Hancom Office 또는 Java 변환기),
#   .doc → .docx (LibreOffice 또는 Word COM) 변환.
#   그룹 대표 파일 1개만 변환하고 결과를 document_processing_groups에 기록.
# 쓰는 테이블: document_processing_groups (convert_status, converted_path)
# 반환: {processed, success, failed, skipped}

import json
import os
import zipfile
from pathlib import Path

from etl.common import esc, psql_csv, psql_run_checked
from etl.converters.doc_to_docx import WordDocConverter, is_valid_docx
from etl.converters.hwp_to_hwpx_hancom import convert_with_timeout as convert_hwp_hancom
from etl.converters.hwp_to_hwpx_hancom import is_valid_hwpx
from etl.converters.hwp_to_hwpx_java import convert as convert_hwp_java


ROOT = Path(__file__).resolve().parents[2]
CONVERTED_ROOT = Path(os.getenv("HYENA_CONVERTED_ROOT", str(ROOT / "converted_documents")))
DOCX_DIR = CONVERTED_ROOT / "docx"
HWPX_DIR = CONVERTED_ROOT / "hwpx"
MAX_SIZE = 30 * 1024 * 1024
_MANIFEST: list[dict] | None = None


def is_valid_zip(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0 and zipfile.is_zipfile(path)


def converted_dir_for(extension: str) -> Path:
    return DOCX_DIR if extension == ".doc" else HWPX_DIR


def target_ext_for(extension: str) -> str:
    return ".docx" if extension == ".doc" else ".hwpx"


def processor_for(extension: str, converted_by: str) -> str:
    if extension == ".doc":
        return "word-com-doc-to-docx" if converted_by == "created" else "reused-docx"
    return converted_by


def group_file_ids(group_id: str) -> list[str]:
    rows = psql_csv(
        "SELECT file_id FROM document_processing_group_files "
        f"WHERE group_id='{group_id}' ORDER BY is_representative DESC, file_id;"
    )
    return [row["file_id"] for row in rows]


def load_group_file_map() -> dict[str, list[str]]:
    rows = psql_csv(
        "SELECT group_id, file_id FROM document_processing_group_files "
        "ORDER BY group_id, is_representative DESC, file_id;"
    )
    mapping: dict[str, list[str]] = {}
    for row in rows:
        mapping.setdefault(row["group_id"], []).append(row["file_id"])
    return mapping


def load_manifest() -> list[dict]:
    global _MANIFEST
    if _MANIFEST is not None:
        return _MANIFEST
    manifest_path = CONVERTED_ROOT / "manifest.jsonl"
    rows: list[dict] = []
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    _MANIFEST = rows
    return rows


def manifest_candidates(group: dict) -> list[Path]:
    target_ext = target_ext_for(group["extension"])
    sha = group.get("sha256_hash")
    candidates: list[Path] = []
    if sha:
        cache = converted_dir_for(group["extension"]) / f"{sha}{target_ext}"
        candidates.append(cache)
    for row in load_manifest():
        if row.get("source_ext") != group["extension"]:
            continue
        if sha and row.get("sha256_hash") != sha:
            continue
        target_path = row.get("target_path")
        if not target_path:
            continue
        target = Path(str(target_path))
        if not target.exists():
            target = CONVERTED_ROOT / target_ext.lstrip(".") / target.name
        candidates.append(target)
    return candidates


def find_existing_converted(group: dict, file_map: dict[str, list[str]] | None = None) -> Path | None:
    ext = group["extension"]
    target_ext = target_ext_for(ext)
    target_dir = converted_dir_for(ext)
    candidate_ids = [group["representative_file_id"], *(file_map or {}).get(group["id"], [])]
    if file_map is None:
        candidate_ids = [group["representative_file_id"], *group_file_ids(group["id"])]
    seen: set[str] = set()
    for file_id in candidate_ids:
        if not file_id or file_id in seen:
            continue
        seen.add(file_id)
        candidate = target_dir / f"{file_id}{target_ext}"
        if (ext == ".doc" and is_valid_docx(candidate)) or (ext == ".hwp" and is_valid_hwpx(candidate)):
            return candidate
    for candidate in manifest_candidates(group):
        if (ext == ".doc" and is_valid_docx(candidate)) or (ext == ".hwp" and is_valid_hwpx(candidate)):
            return candidate
    return None


def update_group_done(group_id: str, converted_path: Path, processor: str, metadata: dict) -> None:
    psql_run_checked(group_done_sql(group_id, converted_path, processor, metadata))


def group_done_sql(group_id: str, converted_path: Path, processor: str, metadata: dict) -> str:
    return (
        "UPDATE document_processing_groups SET "
        "status='converted', convert_status='done', converted_path="
        f"{esc(str(converted_path))}, processor_name={esc(processor)}, error=NULL, "
        f"metadata=COALESCE(metadata, '{{}}'::jsonb) || {esc(json.dumps(metadata, ensure_ascii=False))}::jsonb, "
        "processed_at=NOW() "
        f"WHERE id='{group_id}';"
    )


def update_group_missing(group_id: str, message: str, state: str = "pending_conversion") -> None:
    psql_run_checked(group_missing_sql(group_id, message, state))


def group_missing_sql(group_id: str, message: str, state: str = "pending_conversion") -> str:
    metadata = {"conversion_state": state}
    return (
        "UPDATE document_processing_groups SET "
        "status='pending', convert_status='pending', converted_path=NULL, processor_name=NULL, "
        f"error={esc(message[:500])}, "
        f"metadata=COALESCE(metadata, '{{}}'::jsonb) || {esc(json.dumps(metadata, ensure_ascii=False))}::jsonb, "
        "processed_at=NOW() "
        f"WHERE id='{group_id}';"
    )


def flush_updates(updates: list[str]) -> None:
    if not updates:
        return
    psql_run_checked("BEGIN;\n" + "\n".join(updates) + "\nCOMMIT;")
    updates.clear()


def load_groups() -> list[dict]:
    return psql_csv(
        "SELECT g.id, g.extension, g.sha256_hash, g.representative_file_id, f.original_path, f.file_size "
        "FROM document_processing_groups g "
        "JOIN files f ON f.id=g.representative_file_id "
        "WHERE g.extension IN ('.doc','.hwp') "
        "ORDER BY g.priority, g.extension, f.file_size NULLS LAST;"
    )


def convert_doc(group: dict, converter: WordDocConverter) -> tuple[Path, str]:
    source = Path(group["original_path"])
    target = DOCX_DIR / f"{group['representative_file_id']}.docx"
    converter.convert(source, target)
    return target, "created"


def convert_hwp(group: dict, hancom_fallback: bool) -> tuple[Path, str]:
    source = Path(group["original_path"])
    target = HWPX_DIR / f"{group['representative_file_id']}.hwpx"
    try:
        convert_hwp_java(source, target)
        return target, "java-hwp2hwpx"
    except Exception as java_error:
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        if not hancom_fallback:
            raise RuntimeError(f"java hwp2hwpx failed: {java_error}")
        convert_hwp_hancom(source, target)
        return target, "hancom-com-hwp-to-hwpx"


def run(options: dict) -> dict:
    if not options.get("convert_doc_hwp", True):
        psql_run_checked(
            "UPDATE document_processing_groups SET convert_status='skipped', status='skipped', "
            "error='convert_doc_hwp disabled' WHERE extension IN ('.doc','.hwp');"
        )
        rows = psql_csv("SELECT count(*) AS cnt FROM document_processing_groups WHERE extension IN ('.doc','.hwp');")
        count = int(rows[0]["cnt"]) if rows else 0
        return {"processed": count, "success": 0, "skipped": count}

    DOCX_DIR.mkdir(parents=True, exist_ok=True)
    HWPX_DIR.mkdir(parents=True, exist_ok=True)
    groups = load_groups()
    file_map = load_group_file_map()
    success = failed = skipped = reused = created = 0
    word_converter: WordDocConverter | None = None
    updates: list[str] = []
    batch_size = int(options.get("convert_update_batch_size", 200) or 200)

    try:
        for group in groups:
            ext = group["extension"]
            try:
                existing = find_existing_converted(group, file_map) if options.get("reuse_existing_converted_files", True) else None
                if existing:
                    updates.append(group_done_sql(
                        group["id"],
                        existing,
                        processor_for(ext, "reused"),
                        {"conversion_state": "reused_existing", "converted_by": "reuse"},
                    ))
                    success += 1
                    reused += 1
                    if len(updates) >= batch_size:
                        flush_updates(updates)
                    continue

                if not options.get("create_missing_converted_files", True):
                    updates.append(group_missing_sql(group["id"], "converted artifact not found; creation disabled", "pending_conversion"))
                    skipped += 1
                    if len(updates) >= batch_size:
                        flush_updates(updates)
                    continue

                source = Path(group["original_path"])
                size = int(group.get("file_size") or 0)
                if not source.exists():
                    updates.append(group_missing_sql(group["id"], "representative source missing", "conversion_missing"))
                    failed += 1
                    if len(updates) >= batch_size:
                        flush_updates(updates)
                    continue
                if size > MAX_SIZE:
                    updates.append(group_missing_sql(group["id"], "representative source too large", "conversion_missing"))
                    skipped += 1
                    if len(updates) >= batch_size:
                        flush_updates(updates)
                    continue

                if ext == ".doc":
                    if word_converter is None:
                        word_converter = WordDocConverter()
                    converted_path, converted_by = convert_doc(group, word_converter)
                else:
                    converted_path, converted_by = convert_hwp(group, options.get("hancom_fallback", False))

                updates.append(group_done_sql(
                    group["id"],
                    converted_path,
                    processor_for(ext, converted_by),
                    {"conversion_state": "created", "converted_by": converted_by},
                ))
                success += 1
                created += 1
                if len(updates) >= batch_size:
                    flush_updates(updates)
            except Exception as exc:
                updates.append(group_missing_sql(group["id"], str(exc), "conversion_missing"))
                failed += 1
                if len(updates) >= batch_size:
                    flush_updates(updates)
    finally:
        flush_updates(updates)
        if word_converter is not None:
            word_converter.close()

    return {
        "processed": len(groups),
        "success": success,
        "failed": failed,
        "skipped": skipped,
        "reused": reused,
        "created": created,
    }
