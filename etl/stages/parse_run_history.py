# etl/stages/parse_run_history.py
# 역할: Everything 소프트웨어의 Run History.csv를 파싱해 file_access_logs 테이블에 적재
# 대상: data 폴더 내 모든 사용자의 Run History.csv
# Windows FILETIME(100ns 단위, 1601-01-01 기준) → UTC datetime 변환

import csv
import datetime
import glob
import os
import re
import uuid

import psycopg2
from dotenv import load_dotenv

load_dotenv()

EPOCH_AS_FILETIME = 116444736000000000
HUNDREDS_OF_NS = 10000000


def _filetime_to_dt(filetime_str: str):
    try:
        ft = int(filetime_str)
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


def _find_run_history_files(data_root: str):
    pattern = os.path.join(data_root, "**", "Run History.csv")
    return glob.glob(pattern, recursive=True)


def _extract_user_info(filepath: str):
    parts = filepath.replace("\\", "/").split("/")
    for i, p in enumerate(parts):
        if "HYENA CTF" in p and i + 1 < len(parts):
            folder = parts[i + 1]
            # "구매팀_강수민(대리)" → source_label, user_name 추출
            m = re.match(r"(.+?)_(.+?)\((.+?)\)", folder)
            if m:
                return folder, m.group(2)
            return folder, folder
    return "HYENA CTF", "unknown"


def run(options: dict) -> dict:
    data_root = options.get("drive_root_path", "c:/capstone_clean/data")
    files = _find_run_history_files(data_root)

    if not files:
        return {"processed": 0, "success": 0, "failed": 0}

    conn = _get_conn()
    cur = conn.cursor()

    # 기존 데이터 초기화
    cur.execute("DELETE FROM file_access_logs")

    total, success, failed = 0, 0, 0

    for filepath in files:
        source_label, user_name = _extract_user_info(filepath)
        try:
            with open(filepath, encoding="utf-8-sig", errors="replace") as f:
                reader = csv.DictReader(f)
                rows = []
                for row in reader:
                    total += 1
                    full_path = row.get("Filename", "").strip()
                    run_count = int(row.get("Run Count", 1) or 1)
                    last_run_raw = row.get("Last Run Date", "").strip()
                    last_run_at = _filetime_to_dt(last_run_raw)
                    filename = os.path.basename(full_path)
                    rows.append((
                        str(uuid.uuid4()),
                        source_label,
                        user_name,
                        full_path,
                        filename,
                        run_count,
                        last_run_at,
                    ))

                cur.executemany(
                    "INSERT INTO file_access_logs "
                    "(id, source_label, user_name, full_path, filename, run_count, last_run_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    rows,
                )
                success += len(rows)
                print(f"[run_history] {user_name}: {len(rows)}행 적재", flush=True)
        except Exception as e:
            failed += 1
            print(f"[run_history] 오류 {filepath}: {e}", flush=True)

    conn.commit()
    cur.close()
    conn.close()

    return {"processed": total, "success": success, "failed": failed}


if __name__ == "__main__":
    result = run({"drive_root_path": "c:/capstone_clean/data"})
    print(result)
