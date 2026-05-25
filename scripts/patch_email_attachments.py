"""
scripts/patch_email_attachments.py
email_attachments 테이블에 시나리오 이메일 첨부파일 레코드를 INSERT합니다.
load_scenario.py 재실행 없이 단독으로 실행하세요.
"""
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

import psycopg2


def get_pg_conn():
    return psycopg2.connect(
        host="localhost",
        port=55432,
        dbname=os.getenv("HYENA_POSTGRES_DB", "hyena"),
        user=os.getenv("HYENA_POSTGRES_USER", "hyena"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


ATTACHMENTS = [
    # 강수민 "자료 전달드립니다" 이메일 (77c35cbc-...)
    {
        "email_id": "77c35cbc-d81b-4027-9fa9-4a690ff52f3b",
        "file_id": "89057f31-7934-4e63-8521-bb182a627781",
        "attachment_name": "행복의류_거래처별_단가표_2021.xlsx",
        "size_bytes": 9350,
    },
    {
        "email_id": "77c35cbc-d81b-4027-9fa9-4a690ff52f3b",
        "file_id": "dc564c6e-b86e-4e40-a61e-f2cf562e3bc4",
        "attachment_name": "삼색원단나라_원단_공급계약서.pdf",
        "size_bytes": None,
    },
    # 이지수 "참고자료" 이메일 (156334eb-...)
    {
        "email_id": "156334eb-66ea-4611-909e-86203347979c",
        "file_id": "7c775cb3-c554-4a1d-a89a-9db54d6fe608",
        "attachment_name": "공급업체_연락처_리스트.xlsx",
        "size_bytes": None,
    },
    {
        "email_id": "156334eb-66ea-4611-909e-86203347979c",
        "file_id": "3fcbeb87-8ebc-429e-b7ef-43c6e49a0d83",
        "attachment_name": "2021_구매계획서.xlsx",
        "size_bytes": None,
    },
]


def main():
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            inserted = 0
            for row in ATTACHMENTS:
                cur.execute(
                    """
                    INSERT INTO email_attachments (id, email_id, file_id, attachment_name, size_bytes)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        str(uuid.uuid4()),
                        row["email_id"],
                        row["file_id"],
                        row["attachment_name"],
                        row["size_bytes"],
                    ),
                )
                inserted += cur.rowcount
                print(f"  INSERT: {row['attachment_name']} → email {row['email_id'][:8]}...")
        conn.commit()
        print(f"\n완료: {inserted}건 INSERT")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
