# etl/stages/parse_ost.py
# 역할: OST 파일을 readpst로 파싱해 email_messages 테이블에 신규 이메일만 적재
#   - 기존 email_messages와 message_id로 중복 체크
#   - 장국주 / 이지수(2) OST 대상

import json
import os
import re
import subprocess
import tempfile
import uuid
from email import policy
from email.header import decode_header
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv()

CONTAINER = os.getenv("HYENA_POSTGRES_CONTAINER", "hyena_clean_postgres")

OST_TARGETS = [
    {
        "ost_path": "c:/capstone_clean/data/HYENA CTF/구매팀_장국주(팀장)/C/Users/장국주/AppData/Local/Microsoft/Outlook/hb.kookju.jang@gmail.com(7).ost",
        "file_id":  "28ccdbe2-2c88-48ea-adb6-07627dbfb6df",
        "user_name": "장국주",
    },
    {
        "ost_path": "c:/capstone_clean/data/HYENA CTF/구매팀_이지수(과장)/C/Users/HB/AppData/Local/Microsoft/Outlook/hb.jisu.lee@gmail.com(2).ost",
        "file_id":  "51aa38ad-e91a-49f8-966f-928022f5b588",
        "user_name": "이지수",
    },
]


def _get_conn():
    return psycopg2.connect(
        host="localhost", port=55432, dbname="hyena",
        user="hyena", password=os.getenv("POSTGRES_PASSWORD", "hyena_pw"),
    )


def _decode_header_value(raw: str) -> str:
    if not raw:
        return ""
    parts = decode_header(raw)
    result = ""
    for part, enc in parts:
        if isinstance(part, bytes):
            result += part.decode(enc or "utf-8", errors="replace")
        else:
            result += str(part)
    return result.strip()


def _parse_email_file(path: Path) -> dict | None:
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except Exception:
        return None

    try:
        msg = BytesParser(policy=policy.compat32).parsebytes(raw)
    except Exception:
        return None

    message_id = (msg.get("Message-ID") or "").strip()
    if not message_id:
        return None

    subject = _decode_header_value(msg.get("Subject", ""))
    sender_raw = _decode_header_value(msg.get("From", ""))
    _, sender_addr = parseaddr(sender_raw)
    sender = sender_addr or sender_raw

    # 수신자 파싱
    to_raw = _decode_header_value(msg.get("To", ""))
    recipients_to = [addr.strip() for addr in to_raw.split(",") if addr.strip()]

    # 날짜 파싱
    sent_at = None
    date_raw = msg.get("Date")
    if date_raw:
        try:
            sent_at = parsedate_to_datetime(date_raw)
        except Exception:
            pass

    # 본문 추출
    body_text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                charset = part.get_content_charset() or "utf-8"
                try:
                    body_text = part.get_payload(decode=True).decode(charset, errors="replace")
                    break
                except Exception:
                    pass
        if not body_text:
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/html":
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        html = part.get_payload(decode=True).decode(charset, errors="replace")
                        body_text = re.sub(r"<[^>]+>", " ", html)
                        body_text = re.sub(r"\s+", " ", body_text).strip()
                        break
                    except Exception:
                        pass
    else:
        charset = msg.get_content_charset() or "utf-8"
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                body_text = payload.decode(charset, errors="replace")
        except Exception:
            pass

    has_attachments = any(
        part.get_content_disposition() == "attachment"
        for part in (msg.walk() if msg.is_multipart() else [msg])
    )

    folder_path = str(path.parent).split("test_")[-1] if "test_" in str(path) else str(path.parent)

    return {
        "message_id": message_id,
        "subject": subject,
        "sender": sender,
        "recipients_to": recipients_to,
        "sent_at": sent_at,
        "body_text": body_text[:100000],
        "has_attachments": has_attachments,
        "folder_path": folder_path,
    }


def _extract_ost(ost_path: str, tag: str) -> Path:
    ost = Path(ost_path)
    container_src = f"/tmp/ost_src_{tag}.ost"
    container_out = f"/tmp/ost_result_{tag}"

    subprocess.run(
        ["docker", "cp", str(ost), f"{CONTAINER}:{container_src}"],
        check=True, capture_output=True,
    )
    r = subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c",
         f"rm -rf {container_out} && mkdir -p {container_out} && readpst -S -tea -8 -o {container_out} {container_src}"],
        capture_output=True,
    )
    local_out = Path(tempfile.mkdtemp())
    r2 = subprocess.run(
        ["docker", "cp", f"{CONTAINER}:{container_out}/.", str(local_out)],
        check=True, capture_output=True,
    )
    return local_out


def run(options: dict) -> dict:
    conn = _get_conn()
    cur = conn.cursor()

    # 기존 message_id 전체 로드 (중복 체크용)
    cur.execute("SELECT message_id FROM email_messages")
    existing_ids = {row[0] for row in cur.fetchall()}
    print(f"[ost] 기존 이메일 {len(existing_ids)}건 로드")

    total, inserted, skipped, failed = 0, 0, 0, 0

    for target in OST_TARGETS:
        user = target["user_name"]
        file_id = target["file_id"]
        print(f"\n[ost] {user} OST 파싱 시작...")

        tag = user.replace(" ", "_")
        try:
            out_dir = _extract_ost(target["ost_path"], tag)
        except Exception as e:
            print(f"[ost] {user} 추출 실패: {e}")
            failed += 1
            continue

        # 모든 이메일 파일 탐색 (확장자 없는 숫자 파일)
        email_files = [
            p for p in out_dir.rglob("*")
            if p.is_file() and p.suffix == "" and p.name.isdigit()
        ]

        print(f"[ost] {user}: {len(email_files)}개 이메일 파일 발견")

        for epath in email_files:
            total += 1
            parsed = _parse_email_file(epath)
            if not parsed:
                failed += 1
                continue

            mid = parsed["message_id"]
            if mid in existing_ids:
                skipped += 1
                continue

            try:
                cur.execute(
                    "INSERT INTO email_messages "
                    "(id, source_file_id, message_id, subject, sender, recipients_to, "
                    " sent_at, folder_path, body_text, has_attachments, metadata) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        str(uuid.uuid4()),
                        file_id,
                        mid,
                        parsed["subject"],
                        parsed["sender"],
                        json.dumps(parsed["recipients_to"]),
                        parsed["sent_at"],
                        parsed["folder_path"],
                        parsed["body_text"],
                        parsed["has_attachments"],
                        json.dumps({"source": "ost", "user": user}),
                    ),
                )
                existing_ids.add(mid)
                inserted += 1
                print(f"[ost] 신규: {parsed['sender']} | {parsed['subject'][:50]}")
            except Exception as e:
                failed += 1
                print(f"[ost] 삽입 오류: {e}")

        conn.commit()
        print(f"[ost] {user} 완료: 신규 {inserted}건")

    cur.close()
    conn.close()

    print(f"\n[ost] 전체 완료 - 처리:{total} 신규:{inserted} 중복:{skipped} 실패:{failed}")
    return {"processed": total, "success": inserted, "skipped": skipped, "failed": failed}


if __name__ == "__main__":
    result = run({})
    print(result)
