# etl/stages/parse_messenger.py
# 역할: 해피메신저 백업 텍스트 파일을 파싱해 messenger_logs 테이블에 적재
# 포맷: [이름] [오전/오후 HH:MM] 메시지내용
# 날짜 구분선: --------------- YYYY년 M월 D일 요일 ---------------

import glob
import os
import re
import uuid
import datetime

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATE_LINE = re.compile(r"-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*?-+")
MSG_LINE  = re.compile(r"^\[(.+?)\]\s+\[(오전|오후)\s+(\d{1,2}):(\d{2})\]\s+(.*)")


def _get_conn():
    return psycopg2.connect(
        host="localhost",
        port=55432,
        dbname="hyena",
        user="hyena",
        password=os.getenv("POSTGRES_PASSWORD", "hyena_pw"),
    )


def _find_messenger_files(data_root: str):
    pattern = os.path.join(data_root, "**", "해피메신저 백업", "*.txt")
    return glob.glob(pattern, recursive=True)


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


def _chat_title_from_filename(filepath: str) -> str:
    name = os.path.splitext(os.path.basename(filepath))[0]
    return name


def _parse_file(filepath: str, source_label: str, user_name: str):
    chat_title = _chat_title_from_filename(filepath)
    records = []
    current_date = None

    with open(filepath, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\r\n")

            m_date = DATE_LINE.search(line)
            if m_date:
                current_date = datetime.date(
                    int(m_date.group(1)),
                    int(m_date.group(2)),
                    int(m_date.group(3)),
                )
                continue

            m_msg = MSG_LINE.match(line)
            if m_msg and current_date:
                sender   = m_msg.group(1).strip()
                ampm     = m_msg.group(2)
                hour     = int(m_msg.group(3))
                minute   = int(m_msg.group(4))
                message  = m_msg.group(5).strip()

                if ampm == "오후" and hour != 12:
                    hour += 12
                elif ampm == "오전" and hour == 12:
                    hour = 0

                sent_at = datetime.datetime(
                    current_date.year, current_date.month, current_date.day,
                    hour, minute,
                    tzinfo=datetime.timezone.utc,
                )
                records.append((
                    str(uuid.uuid4()),
                    source_label,
                    user_name,
                    chat_title,
                    sender,
                    message,
                    sent_at,
                ))

    return records


def run(options: dict) -> dict:
    data_root = options.get("drive_root_path", "c:/capstone_clean/data")
    files = _find_messenger_files(data_root)

    if not files:
        return {"processed": 0, "success": 0, "failed": 0}

    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM messenger_logs")

    total, success, failed = 0, 0, 0

    for filepath in files:
        source_label, user_name = _extract_user_info(filepath)
        try:
            records = _parse_file(filepath, source_label, user_name)
            if records:
                cur.executemany(
                    "INSERT INTO messenger_logs "
                    "(id, source_label, user_name, chat_title, sender, message, sent_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    records,
                )
                success += len(records)
                total   += len(records)
                print(f"[messenger] {user_name} / {os.path.basename(filepath)}: {len(records)}건", flush=True)
        except Exception as e:
            failed += 1
            print(f"[messenger] 오류 {filepath}: {e}", flush=True)

    conn.commit()
    cur.close()
    conn.close()

    return {"processed": total, "success": success, "failed": failed}


if __name__ == "__main__":
    result = run({"drive_root_path": "c:/capstone_clean/data"})
    print(result)
