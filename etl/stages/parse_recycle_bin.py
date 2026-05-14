# etl/stages/parse_recycle_bin.py
# 역할: $Recycle.Bin의 $I 메타데이터 파일을 파싱해 deleted_files 테이블에 적재
# $I 파일 구조 (버전2):
#   0-7   : 버전 (int64 LE)
#   8-15  : 원본 파일 크기 (int64 LE)
#   16-23 : 삭제 시간 (Windows FILETIME, int64 LE)
#   24-27 : 경로 문자 수 (int32 LE)
#   28~   : 원본 경로 (UTF-16LE)

import glob
import os
import re
import struct
import uuid
import datetime

import psycopg2
from dotenv import load_dotenv

load_dotenv()

EPOCH_AS_FILETIME = 116444736000000000
HUNDREDS_OF_NS = 10000000


def _filetime_to_dt(ft: int):
    try:
        if ft <= 0:
            return None
        seconds = (ft - EPOCH_AS_FILETIME) / HUNDREDS_OF_NS
        return datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(seconds=seconds)
    except Exception:
        return None


def _get_conn():
    return psycopg2.connect(
        host="localhost",
        port=55432,
        dbname="hyena",
        user="hyena",
        password=os.getenv("POSTGRES_PASSWORD", "hyena_pw"),
    )


def _find_recycle_i_files(data_root: str):
    # $I로 시작하는 파일 탐색
    results = []
    for root, dirs, files in os.walk(data_root):
        if "$Recycle.Bin" in root or "Recycle.Bin" in root:
            for f in files:
                if f.startswith("$I"):
                    results.append(os.path.join(root, f))
    return results


def _extract_user_info(filepath: str):
    parts = filepath.replace("\\", "/").split("/")
    for i, p in enumerate(parts):
        if "HYENA CTF" in p and i + 1 < len(parts):
            folder = parts[i + 1]
            m = re.match(r"(.+?)_(.+?)\((.+?)\)", folder)
            if m:
                return folder, m.group(2)
            return folder, folder
    return "HYENA CTF", "unknown"


def _parse_i_file(filepath: str):
    with open(filepath, "rb") as f:
        data = f.read()

    if len(data) < 28:
        return None

    version   = struct.unpack("<q", data[0:8])[0]
    file_size = struct.unpack("<q", data[8:16])[0]
    del_time  = struct.unpack("<q", data[16:24])[0]
    deleted_at = _filetime_to_dt(del_time)

    if version == 2 and len(data) >= 28:
        path_len   = struct.unpack("<I", data[24:28])[0]
        orig_path  = data[28:28 + path_len * 2].decode("utf-16-le", errors="replace").rstrip("\x00")
    else:
        # 버전1: 24바이트 후 바로 520바이트 UTF-16LE
        orig_path = data[24:544].decode("utf-16-le", errors="replace").rstrip("\x00")

    recycle_id = os.path.splitext(os.path.basename(filepath))[0]  # $IYWUP6M 등
    extension  = os.path.splitext(orig_path)[1].lower() if orig_path else ""
    filename   = os.path.basename(orig_path) if orig_path else ""

    return {
        "recycle_id":        recycle_id,
        "original_path":     orig_path,
        "original_filename": filename,
        "extension":         extension,
        "file_size_bytes":   file_size,
        "deleted_at":        deleted_at,
    }


def run(options: dict) -> dict:
    data_root = options.get("drive_root_path", "c:/capstone_clean/data")
    files = _find_recycle_i_files(data_root)

    if not files:
        return {"processed": 0, "success": 0, "failed": 0}

    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM deleted_files")

    total, success, failed = 0, 0, 0

    for filepath in files:
        source_label, user_name = _extract_user_info(filepath)
        total += 1
        try:
            info = _parse_i_file(filepath)
            if not info:
                failed += 1
                continue

            cur.execute(
                "INSERT INTO deleted_files "
                "(id, source_label, user_name, original_path, original_filename, "
                " extension, file_size_bytes, deleted_at, recycle_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    str(uuid.uuid4()),
                    source_label,
                    user_name,
                    info["original_path"],
                    info["original_filename"],
                    info["extension"],
                    info["file_size_bytes"],
                    info["deleted_at"],
                    info["recycle_id"],
                ),
            )
            success += 1
            print(f"[recycle] {user_name}: {info['original_filename']} ({info['deleted_at']})", flush=True)
        except Exception as e:
            failed += 1
            print(f"[recycle] 오류 {filepath}: {e}", flush=True)

    conn.commit()
    cur.close()
    conn.close()

    return {"processed": total, "success": success, "failed": failed}


if __name__ == "__main__":
    result = run({"drive_root_path": "c:/capstone_clean/data"})
    print(result)
