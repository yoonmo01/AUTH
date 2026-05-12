# scripts/init_db.py
# 역할: DB 스키마 초기화 스크립트 (clean_rebuild.ps1에서 호출)
#   1) PostgreSQL 컨테이너가 준비될 때까지 대기 (최대 90초)
#   2) 기존 스키마 DROP → CREATE (완전 초기화)
#   3) schema.sql 적용 (모든 테이블·뷰·인덱스 생성)
# 실행: python scripts/init_db.py
# 주의: 기존 데이터가 모두 삭제된다. 재현 시에만 사용.
# 환경변수: HYENA_POSTGRES_CONTAINER, HYENA_POSTGRES_USER, HYENA_POSTGRES_DB

import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_FILE = ROOT / "schema.sql"
CONTAINER = os.getenv("HYENA_POSTGRES_CONTAINER", "hyena_clean_postgres")
PG_USER = os.getenv("HYENA_POSTGRES_USER", "hyena")
PG_DB = os.getenv("HYENA_POSTGRES_DB", "hyena")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def wait_for_postgres(timeout_seconds: int = 90) -> None:
    deadline = time.time() + timeout_seconds
    last_error = ""
    while time.time() < deadline:
        result = run(["docker", "exec", CONTAINER, "pg_isready", "-U", PG_USER, "-d", PG_DB])
        if result.returncode == 0:
            return
        last_error = (result.stdout + result.stderr).strip()
        time.sleep(2)
    raise RuntimeError(f"postgres not ready after {timeout_seconds}s: {last_error}")


def main() -> None:
    try:
        wait_for_postgres()
    except Exception as exc:
        print(str(exc))
        sys.exit(1)

    reset = run([
        "docker", "exec", CONTAINER,
        "psql", "-U", PG_USER, "-d", PG_DB,
        "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    ])
    if reset.returncode != 0:
        print(reset.stderr)
        sys.exit(reset.returncode)

    result = run(["docker", "cp", str(SCHEMA_FILE), f"{CONTAINER}:/tmp/schema.sql"])
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(result.returncode)

    result = run(["docker", "exec", CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-f", "/tmp/schema.sql"])
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(result.returncode)

    print("[OK] schema applied")


if __name__ == "__main__":
    main()
