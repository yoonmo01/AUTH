"""
scripts/migrate.py
------------------
DB 마이그레이션 스크립트 - 새로 추가된 테이블과 데이터를 생성한다.

실행 방법:
    python scripts/migrate.py

사전 조건:
    - Docker Desktop 실행 중
    - hyena_clean_postgres 컨테이너 실행 중
    - data/ 폴더가 c:/capstone_clean/data/ 에 존재
    - .env 파일 존재

추가되는 내용:
    1. file_access_logs  테이블 생성 + 데이터 적재 (Everything Run History)
    2. messenger_logs    테이블 생성 + 데이터 적재 (해피메신저 백업)
    3. deleted_files     테이블 생성 + 데이터 적재 ($Recycle.Bin)
    4. OST 이메일        email_messages에 신규 이메일 추가
"""

import os
import sys

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_conn():
    return psycopg2.connect(
        host="localhost",
        port=55432,
        dbname="hyena",
        user="hyena",
        password=os.getenv("POSTGRES_PASSWORD", "hyena_pw"),
    )


def check_table_exists(conn, table_name: str) -> bool:
    cur = conn.cursor()
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = %s)",
        [table_name]
    )
    return cur.fetchone()[0]


def check_row_count(conn, table_name: str) -> int:
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cur.fetchone()[0]


def step1_create_tables(conn):
    print("\n[1/4] 테이블 생성 중...")
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS file_access_logs (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            source_label text,
            user_name   text,
            full_path   text NOT NULL,
            filename    text,
            run_count   int DEFAULT 1,
            last_run_at timestamptz,
            created_at  timestamptz DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS messenger_logs (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            source_label    text,
            user_name       text,
            chat_title      text,
            sender          text,
            message         text,
            sent_at         timestamptz,
            created_at      timestamptz DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS deleted_files (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            source_label    text,
            user_name       text,
            original_path   text,
            original_filename text,
            extension       text,
            file_size_bytes bigint,
            deleted_at      timestamptz,
            recycle_id      text,
            created_at      timestamptz DEFAULT now()
        );
    """)
    conn.commit()
    print("    file_access_logs, messenger_logs, deleted_files 테이블 생성 완료")


def step2_load_run_history(conn, data_root: str):
    print("\n[2/4] Everything Run History 적재 중...")

    count = check_row_count(conn, "file_access_logs")
    if count > 0:
        print(f"    이미 {count}건 존재 - 스킵")
        return

    from etl.stages.parse_run_history import run
    result = run({"drive_root_path": data_root})
    print(f"    완료: {result['success']}건 적재")


def step3_load_messenger(conn, data_root: str):
    print("\n[3/4] 해피메신저 백업 적재 중...")

    count = check_row_count(conn, "messenger_logs")
    if count > 0:
        print(f"    이미 {count}건 존재 - 스킵")
        return

    from etl.stages.parse_messenger import run
    result = run({"drive_root_path": data_root})
    print(f"    완료: {result['success']}건 적재")


def step4_load_recycle_bin(conn, data_root: str):
    print("\n[4/4] $Recycle.Bin 적재 중...")

    count = check_row_count(conn, "deleted_files")
    if count > 0:
        print(f"    이미 {count}건 존재 - 스킵")
        return

    from etl.stages.parse_recycle_bin import run
    result = run({"drive_root_path": data_root})
    print(f"    완료: {result['success']}건 적재")


def step5_load_ost(conn):
    print("\n[5/5] OST 이메일 적재 중...")

    # 기존 OST 이메일이 있는지 확인
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM email_messages WHERE metadata->>'source' = 'ost'")
    count = cur.fetchone()[0]
    if count > 0:
        print(f"    이미 {count}건 존재 - 스킵")
        return

    from etl.stages.parse_ost import run
    result = run({})
    print(f"    완료: 신규 {result['success']}건 적재 / 중복 {result['skipped']}건 스킵")


def verify(conn):
    print("\n[검증] 최종 데이터 현황:")
    tables = [
        "files", "email_messages", "entity_canonical",
        "activity_events", "content_chunks",
        "file_access_logs", "messenger_logs", "deleted_files"
    ]
    cur = conn.cursor()
    for t in tables:
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        count = cur.fetchone()[0]
        marker = "OK" if count > 0 else "EMPTY"
        print(f"    [{marker}] {t}: {count:,}건")


def find_data_root():
    # 스크립트 위치 기준으로 프로젝트 루트 탐색
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidate = os.path.join(project_root, "data")
    if os.path.exists(candidate):
        return candidate

    # 현재 작업 디렉토리 기준
    candidate = os.path.join(os.getcwd(), "data")
    if os.path.exists(candidate):
        return candidate

    return None


def main():
    data_root = find_data_root()

    print("=" * 50)
    print("DB 마이그레이션 시작")
    print(f"data 경로: {data_root}")
    print("=" * 50)

    if not data_root:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        print(f"오류: data 폴더를 찾을 수 없습니다.")
        print(f"다음 위치 중 하나에 data/ 폴더를 놓아주세요:")
        print(f"  {os.path.join(project_root, 'data')}")
        print(f"  {os.path.join(os.getcwd(), 'data')}")
        sys.exit(1)

    try:
        conn = get_conn()
        print("PostgreSQL 연결 성공")
    except Exception as e:
        print(f"오류: PostgreSQL 연결 실패 - {e}")
        print("Docker Desktop이 실행 중이고 hyena_clean_postgres 컨테이너가 동작 중인지 확인하세요.")
        sys.exit(1)

    step1_create_tables(conn)
    step2_load_run_history(conn, data_root)
    step3_load_messenger(conn, data_root)
    step4_load_recycle_bin(conn, data_root)
    step5_load_ost(conn)
    verify(conn)

    conn.close()
    print("\n마이그레이션 완료")


if __name__ == "__main__":
    main()
