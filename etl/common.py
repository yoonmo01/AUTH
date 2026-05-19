# etl/common.py
# 역할: ETL 레이어 전체 공용 유틸리티
#   docker exec psql 방식으로 SQL을 실행 (Windows 한글 인코딩 우회).
#   API 레이어(api/db.py)도 copy_and_run을 공유해서 사용.
# 환경변수: HYENA_POSTGRES_CONTAINER, HYENA_POSTGRES_USER, HYENA_POSTGRES_DB
# 공개 함수:
#   copy_and_run(sql, flags, prefix) → (returncode, stdout, stderr)
#   psql_run(sql)         → DML 실행, 에러 시 경고만 출력
#   psql_run_checked(sql) → DML 실행, 에러 시 RuntimeError
#   psql_csv(sql)         → SELECT → list[dict]
#   esc(s)                → SQL 안전 이스케이프 (제어문자 + 따옴표)
#   esc_body(s)           → 대용량 텍스트용 달러 인용 이스케이프
#   new_id()              → UUID v4 문자열
#   chunk_text(text)      → 텍스트를 size=1500 overlap=150 청크로 분할
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import csv, io, os, re, subprocess, tempfile, uuid
from typing import Optional

_field_limit = sys.maxsize
while True:
    try:
        csv.field_size_limit(_field_limit)
        break
    except OverflowError:
        _field_limit //= 10

CONTAINER   = os.getenv("HYENA_POSTGRES_CONTAINER", "hyena_clean_postgres")
PG_USER     = os.getenv("HYENA_POSTGRES_USER", "hyena")
PG_DB       = os.getenv("HYENA_POSTGRES_DB", "hyena")


def new_id() -> str:
    return str(uuid.uuid4())


def esc(s: Optional[str]) -> str:
    if s is None:
        return "NULL"
    s = s.replace("\x00", "")
    s = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
    return "'" + s.replace("'", "''") + "'"


def esc_body(s: Optional[str]) -> str:
    """이메일 본문 등 대용량 텍스트용 달러 인용 이스케이핑"""
    if s is None:
        return "NULL"
    s = s.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
    # 달러 구분자 선택 (본문에 없는 것)
    for delim in ("$BODY$", "$HYENA$", "$MAIL$", "$TEXT$"):
        if delim not in s:
            return f"{delim}{s}{delim}"
    # 최후 수단: 표준 이스케이핑
    return "'" + s.replace("'", "''") + "'"


def copy_and_run(sql: str, flags: list[str] | None = None, prefix: str = "etl") -> tuple[int, str, str]:
    flags = flags or []
    call_id = uuid.uuid4().hex[:8]
    container_sql = f"/tmp/_{prefix}_q_{call_id}.sql"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql",
                                     encoding="utf-8", delete=False) as f:
        f.write(sql)
        tmp = f.name
    try:
        subprocess.run(["docker", "cp", tmp, f"{CONTAINER}:{container_sql}"],
                       check=True, capture_output=True)
        r = subprocess.run(
            ["docker", "exec", "-e", "PGCLIENTENCODING=UTF8", CONTAINER,
             "psql", "-U", PG_USER, "-d", PG_DB] + flags + ["-f", container_sql],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        subprocess.run(["docker", "exec", CONTAINER, "rm", "-f", container_sql],
                       capture_output=True)
        return r.returncode, r.stdout, r.stderr
    finally:
        os.unlink(tmp)


def psql_run(sql: str) -> None:
    """DML 실행 (오류 시 경고만)."""
    rc, _, err = copy_and_run(sql)
    if rc != 0 and "already exists" not in err:
        snippet = err.strip()[:300]
        print(f"  [WARN] psql: {snippet}")


def psql_run_checked(sql: str) -> None:
    """DML 실행 (오류 시 중단)."""
    rc, out, err = copy_and_run(sql, ["-v", "ON_ERROR_STOP=1"])
    if rc != 0 and "already exists" not in err:
        raise RuntimeError((err or out).strip()[:1000])


def psql_csv(sql: str) -> list[dict]:
    """SELECT → CSV → list[dict]."""
    rc, out, err = copy_and_run(sql, ["--csv"])
    if rc != 0 or not out.strip():
        return []
    return list(csv.DictReader(io.StringIO(out)))


def chunk_text(text: str, size: int = 1500, overlap: int = 150) -> list[str]:
    if not text or not text.strip():
        return []
    chunks, start = [], 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return chunks

