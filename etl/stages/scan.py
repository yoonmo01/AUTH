# etl/stages/scan.py
# 역할: 파이프라인 1단계 — 파일시스템 스캔
#   drive_root_path를 재귀 탐색하여 모든 파일/디렉토리를 DB에 등록.
#   sha256/md5 해시 계산 (100MB 초과 파일 및 .pst/.ost 등은 스킵).
#   시스템 경로($Recycle.Bin, Windows/ 등)와 사용자 콘텐츠 경로를 구분 표시.
# 쓰는 테이블: evidence_sources, directories, files
# 반환: {source_id, processed, success}

import hashlib
import mimetypes
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from etl.common import esc, new_id, psql_csv, psql_run_checked


SYSTEM_TOPS = {
    "$recycle.bin",
    "intel",
    "msocache",
    "perflogs",
    "program files",
    "program files (x86)",
    "programdata",
    "recovery",
    "system volume information",
    "windows",
}
USER_PARTS = {
    "desktop",
    "documents",
    "downloads",
    "music",
    "pictures",
    "videos",
    "바탕 화면",
    "문서",
    "다운로드",
    "사진",
    "동영상",
}
HASH_SIZE_LIMIT = 100 * 1024 * 1024
SKIP_HASH_EXTS = {".pst", ".ost", ".db", ".dat", ".log"}
BATCH_SIZE = 1000


def timestamp(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00")


def sha256(path: Path) -> Optional[str]:
    try:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return None


def md5(path: Path) -> Optional[str]:
    try:
        digest = hashlib.md5()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return None


def existing_source(source_label: str, drive_root_path: str) -> Optional[str]:
    # 단일/이중 백슬래시 모두 허용 (Windows 경로 정규화 차이 방어)
    rows = psql_csv(
        "SELECT id FROM evidence_sources "
        f"WHERE source_label={esc(source_label)} "
        f"AND (drive_root_path={esc(drive_root_path)} "
        f"     OR replace(drive_root_path, chr(92)||chr(92), chr(92))={esc(drive_root_path)}) "
        "ORDER BY created_at DESC LIMIT 1;"
    )
    if rows:
        return rows[0]["id"]
    # source_label만으로 폴백 (경로 완전 불일치 시)
    rows = psql_csv(
        "SELECT id FROM evidence_sources "
        f"WHERE source_label={esc(source_label)} "
        "ORDER BY created_at DESC LIMIT 1;"
    )
    return rows[0]["id"] if rows else None


def source_file_count(source_id: str) -> int:
    rows = psql_csv(f"SELECT count(*) AS cnt FROM files WHERE evidence_source_id='{source_id}';")
    return int(rows[0]["cnt"]) if rows else 0


def create_source(source_label: str, drive_root_path: str) -> str:
    rows = psql_csv(
        "WITH user_row AS ("
        "INSERT INTO users(name, role, system_username) "
        f"VALUES({esc(source_label)}, 'unknown', {esc(source_label)}) "
        "RETURNING id"
        "), source_row AS ("
        "INSERT INTO evidence_sources(user_id, source_label, source_type, drive_root_path, acquisition_started_at) "
        f"SELECT id, {esc(source_label)}, 'c_drive_dump', {esc(drive_root_path)}, NOW() FROM user_row "
        "RETURNING id"
        ") SELECT id FROM source_row;"
    )
    if not rows:
        raise RuntimeError("failed to create evidence source")
    return rows[0]["id"]


def category_for_extension(extension: str) -> str:
    ext = extension.lower()
    if ext in {".hwp", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".xltx", ".pdf", ".ppt", ".pptx", ".csv", ".rtf"}:
        return "document"
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"}:
        return "image"
    if ext in {".m4a"}:
        return "audio"
    if ext in {".pst", ".ost", ".msg"}:
        return "email_store"
    if ext in {".zip", ".7z", ".rar", ".tar", ".gz"}:
        return "archive"
    if ext in {".lnk", ".evtx", ".pf", ".db", ".sqlite", ".dat", ".log"}:
        return "system_artifact"
    return "unknown"


def is_system_path(parts: tuple[str, ...]) -> bool:
    return bool(parts) and parts[0].lower() in SYSTEM_TOPS


def is_user_content(parts: tuple[str, ...]) -> bool:
    lowered = [part.lower() for part in parts]
    return any(part in USER_PARTS for part in lowered)


def flush_directories(rows: list[tuple[str, str, Optional[str], str, str, int]]) -> None:
    if not rows:
        return
    values = [
        f"('{row[0]}','{row[1]}',{'NULL' if row[2] is None else esc(row[2])},"
        f"{esc(row[3])},{esc(row[4])},{row[5]})"
        for row in rows
    ]
    psql_run_checked(
        "INSERT INTO directories(id,evidence_source_id,parent_id,full_path,name,depth) VALUES "
        + ",".join(values)
        + " ON CONFLICT(evidence_source_id, full_path) DO NOTHING;"
    )


def flush_files(rows: list[dict]) -> None:
    if not rows:
        return
    values: list[str] = []
    for row in rows:
        values.append(
            f"('{row['id']}','{row['source_id']}',"
            f"{'NULL' if row['directory_id'] is None else esc(row['directory_id'])},"
            f"{esc(row['filename'])},{esc(row['extension'])},{esc(row['mime_type'])},"
            f"{esc(row['original_path'])},{esc(row['relative_path'])},"
            f"{row['file_size'] if row['file_size'] is not None else 'NULL'},"
            f"{esc(row['sha256_hash'])},{esc(row['md5_hash'])},"
            f"{esc(row['modified_at'])},{esc(row['accessed_at'])},{esc(row['created_at'])},"
            f"{str(row['is_system_path']).upper()},{str(row['is_user_content']).upper()},"
            f"'{row['category']}'::file_category,'pending'::etl_status_type)"
        )
    psql_run_checked(
        "INSERT INTO files("
        "id,evidence_source_id,directory_id,filename,extension,mime_type,original_path,relative_path,"
        "file_size,sha256_hash,md5_hash,file_modified_at,file_accessed_at,file_created_at,"
        "is_system_path,is_user_content,category,etl_status"
        ") VALUES "
        + ",".join(values)
        + " ON CONFLICT(evidence_source_id, relative_path) DO NOTHING;"
    )


def run(source_label: str, drive_root_path: str, reset_existing_source: bool = False) -> dict:
    root = Path(drive_root_path)
    if not root.exists():
        raise RuntimeError(f"drive root does not exist: {drive_root_path}")

    source_id = existing_source(source_label, str(root))
    if source_id and source_file_count(source_id) > 0 and not reset_existing_source:
        return {"source_id": source_id, "processed": 0, "success": source_file_count(source_id), "skipped": 1}
    if source_id is None:
        source_id = create_source(source_label, str(root))

    all_files = [path for path in root.rglob("*") if path.is_file()]
    all_dirs = sorted({path.parent for path in all_files if root == path.parent or root in path.parents})
    dir_map: dict[Path, str] = {}
    dir_rows: list[tuple[str, str, Optional[str], str, str, int]] = []
    for directory in all_dirs:
        directory_id = new_id()
        dir_map[directory] = directory_id
        try:
            rel_parts = directory.relative_to(root.parent).parts
        except ValueError:
            rel_parts = directory.parts
        parent_id = dir_map.get(directory.parent)
        dir_rows.append((directory_id, source_id, parent_id, str(directory), directory.name, max(len(rel_parts) - 1, 0)))
        if len(dir_rows) >= BATCH_SIZE:
            flush_directories(dir_rows)
            dir_rows.clear()
    flush_directories(dir_rows)

    file_rows: list[dict] = []
    failed = 0
    for file_path in all_files:
        try:
            stat = file_path.stat()
            extension = file_path.suffix.lower() or None
            rel = str(file_path.relative_to(root.parent))
            parts = file_path.relative_to(root).parts
            do_hash = bool(extension) and extension not in SKIP_HASH_EXTS and stat.st_size < HASH_SIZE_LIMIT
            mime_type, _ = mimetypes.guess_type(file_path.name)
            file_rows.append(
                {
                    "id": new_id(),
                    "source_id": source_id,
                    "directory_id": dir_map.get(file_path.parent),
                    "filename": file_path.name,
                    "extension": extension,
                    "mime_type": mime_type,
                    "original_path": str(file_path),
                    "relative_path": rel,
                    "file_size": stat.st_size,
                    "sha256_hash": sha256(file_path) if do_hash else None,
                    "md5_hash": md5(file_path) if do_hash else None,
                    "modified_at": timestamp(stat.st_mtime),
                    "accessed_at": timestamp(stat.st_atime),
                    "created_at": timestamp(stat.st_ctime),
                    "is_system_path": is_system_path(parts),
                    "is_user_content": is_user_content(parts),
                    "category": category_for_extension(extension or ""),
                }
            )
            if len(file_rows) >= BATCH_SIZE:
                flush_files(file_rows)
                file_rows.clear()
        except Exception as exc:
            failed += 1
            print(f"  [scan WARN] {file_path}: {exc}", file=sys.stderr)
    flush_files(file_rows)
    psql_run_checked(
        "UPDATE evidence_sources SET acquisition_ended_at=NOW() "
        f"WHERE id='{source_id}';"
    )
    return {"source_id": source_id, "processed": len(all_files), "success": len(all_files) - failed, "failed": failed}
