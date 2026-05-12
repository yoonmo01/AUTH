# api/db.py
# 역할: API 레이어 전용 DB 유틸. docker exec psql 방식으로 SQL을 실행한다.
#   Windows에서 psycopg2 한글 인코딩 불안정 문제를 우회하기 위해
#   임시 SQL 파일을 컨테이너에 복사 후 psql로 실행하는 패턴을 사용.
#   내부 실행 엔진은 etl.common.copy_and_run을 공유.
# 공개 함수:
#   query(sql)   → SELECT 결과를 list[dict]로 반환 (에러 시 빈 리스트)
#   execute(sql) → INSERT/UPDATE/DELETE 실행 (에러 시 RuntimeError)
import csv, io
from typing import Any

from etl.common import copy_and_run


def query(sql: str) -> list[dict[str, Any]]:
    rc, out, _ = copy_and_run(sql, ["--csv"], prefix="api")
    if rc != 0 or not out.strip():
        return []
    return list(csv.DictReader(io.StringIO(out)))


def execute(sql: str) -> None:
    rc, _, err = copy_and_run(sql, prefix="api")
    if rc != 0 and "already exists" not in err:
        raise RuntimeError(err.strip()[:300])
