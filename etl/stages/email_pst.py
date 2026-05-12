# etl/stages/email_pst.py
# 역할: 파이프라인 3단계 — 이메일 저장소 파싱
#   .pst/.ost 파일을 readpst(libpst)로 .mbox로 변환 후 이메일 파싱.
#   .msg 파일은 직접 파싱.
#   이메일 첨부파일은 별도 파일로 추출하고 files 테이블에도 등록.
# 쓰는 테이블: email_messages, email_attachments, files, file_derivatives
# 반환: {processed, success, failed}

import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
from email import policy
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from pathlib import Path

from etl.common import CONTAINER, chunk_text, esc, esc_body, new_id, psql_csv, psql_run_checked


ROOT = Path(__file__).resolve().parents[2]
ATTACH_ROOT = ROOT / "extracted_email_attachments"
DOCUMENT_EXTS = {".hwp", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".xltx", ".pdf", ".ppt", ".pptx", ".csv", ".rtf"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"}
AUDIO_EXTS = {".m4a"}
ARCHIVE_EXTS = {".zip", ".7z", ".rar", ".tar", ".gz"}
SKIP_ATTACHMENTS = {"rtf-body.rtf"}


def run_cmd(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def ensure_schema() -> None:
    sql_path = ROOT / "scripts" / "20260505_email_attachment_schema.sql"
    if sql_path.exists():
        psql_run_checked(sql_path.read_text(encoding="utf-8"))


def digest(path: Path, algorithm: str = "sha256") -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def digest_both(path: Path) -> tuple[str, str]:
    """sha256과 md5를 단일 파일 읽기로 동시에 계산."""
    h_sha = hashlib.sha256()
    h_md5 = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h_sha.update(chunk)
            h_md5.update(chunk)
    return h_sha.hexdigest(), h_md5.hexdigest()


def category_for(extension: str) -> str:
    ext = extension.lower()
    if ext in DOCUMENT_EXTS:
        return "document"
    if ext in IMAGE_EXTS:
        return "image"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in ARCHIVE_EXTS:
        return "archive"
    return "unknown"


_EMAIL_BATCH = 20   # 이메일 배치 크기 (email_messages, extracted_contents)
_CHUNK_BATCH = 500  # 청크 배치 크기


def pst_rows(force_reprocess: bool = False) -> list[dict]:
    status_filter = "" if force_reprocess else "AND (etl_status IS NULL OR etl_status NOT IN ('done','skipped'))"
    return psql_csv(
        "SELECT id, evidence_source_id, original_path, filename "
        f"FROM files WHERE category='email_store' AND extension='.pst' {status_filter}"
        "ORDER BY original_path;"
    )


def ignore_ost() -> int:
    psql_run_checked(
        "DELETE FROM email_messages em USING files f "
        "WHERE f.id=em.source_file_id AND f.extension='.ost';"
        "UPDATE files SET etl_status='skipped', "
        "etl_error='OST cache ignored; PST is primary email source', etl_processed_at=NOW() "
        "WHERE category='email_store' AND extension='.ost';"
    )
    rows = psql_csv("SELECT count(*) AS cnt FROM files WHERE category='email_store' AND extension='.ost';")
    return int(rows[0]["cnt"]) if rows else 0


def extract_pst(pst_path: Path, pst_file_id: str) -> Path:
    out_dir = ATTACH_ROOT / pst_file_id
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    container_out = f"/tmp/pst_email_{pst_file_id}"
    container_input = f"/tmp/pst_email_{pst_file_id}.pst"
    run_cmd(["docker", "exec", CONTAINER, "bash", "-lc", f"rm -rf {container_out} {container_input} && mkdir -p {container_out}"])
    subprocess.run(["docker", "cp", str(pst_path), f"{CONTAINER}:{container_input}"], check=True, capture_output=True)
    result = run_cmd(
        [
            "docker",
            "exec",
            CONTAINER,
            "bash",
            "-lc",
            f"readpst -S -tea -8 -b -o {container_out} {container_input}",
        ],
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[:1000] or result.stdout.strip()[:1000])
    subprocess.run(["docker", "cp", f"{CONTAINER}:{container_out}/.", str(out_dir)], check=True, capture_output=True)
    run_cmd(["docker", "exec", CONTAINER, "bash", "-lc", f"rm -rf {container_out} {container_input}"])
    return out_dir


def message_files(out_dir: Path) -> list[Path]:
    return sorted(path for path in out_dir.rglob("*") if path.is_file() and re.fullmatch(r"\d+", path.name))


def attachment_files(message_file: Path) -> list[Path]:
    prefix = message_file.name + "-"
    files = []
    for candidate in message_file.parent.iterdir():
        if not candidate.is_file() or not candidate.name.startswith(prefix):
            continue
        name = candidate.name[len(prefix) :]
        if name.lower() in SKIP_ATTACHMENTS:
            continue
        files.append(candidate)
    return sorted(files)


def decode_payload(part) -> str:
    payload = part.get_payload(decode=True)
    if not payload:
        return ""
    charset = part.get_content_charset() or "utf-8"
    for encoding in (charset, "utf-8", "cp949", "latin-1"):
        try:
            return payload.decode(encoding, errors="replace")
        except Exception:
            continue
    return payload.decode("utf-8", errors="replace")


def strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_message(path: Path, synthetic_id: str) -> dict:
    with path.open("rb") as handle:
        msg = BytesParser(policy=policy.default).parse(handle)
    recipients = [value.strip() for value in msg.get_all("To", []) if value and value.strip()]
    sent_at = None
    if msg.get("Date"):
        try:
            sent_at = parsedate_to_datetime(msg.get("Date")).strftime("%Y-%m-%d %H:%M:%S+00")
        except Exception:
            pass

    body = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = (part.get_content_disposition() or "").lower()
            if disposition == "attachment":
                continue
            if content_type == "text/plain" and not body:
                body = decode_payload(part)
            elif content_type == "text/html" and not html:
                html = decode_payload(part)
    else:
        if msg.get_content_type() == "text/html":
            html = decode_payload(msg)
        else:
            body = decode_payload(msg)
    if not body.strip() and html.strip():
        body = strip_html(html)

    return {
        "message_id": (msg.get("Message-ID") or f"synthetic:{synthetic_id}").strip(),
        "subject": str(msg.get("Subject") or ""),
        "sender": str(msg.get("From") or ""),
        "recipients_to": json.dumps(recipients, ensure_ascii=False),
        "sent_at": sent_at,
        "body_text": body[:500000],
    }


def _prepare_email(
    source_file_id: str,
    message: dict,
    has_attachments: bool,
    seen: dict[str, int],
) -> tuple[str, str, str | None, list[str]]:
    """email_id, email VALUES row, optional content VALUES row, chunk VALUES rows 반환."""
    email_id = new_id()
    raw_mid = message["message_id"] or f"synthetic:{email_id}"
    seen_count = seen.get(raw_mid, 0)
    seen[raw_mid] = seen_count + 1
    message_id = raw_mid if seen_count == 0 else f"{raw_mid}#dup{seen_count}"

    email_row = (
        f"('{email_id}','{source_file_id}',{esc(message_id)},{esc(message['subject'])},"
        f"{esc(message['sender'])},{esc(message['recipients_to'])}::jsonb,{esc(message['sent_at'])},"
        f"{esc_body(message['body_text'])},{str(has_attachments).upper()},"
        f"'{{\"source\":\"readpst\",\"store_kind\":\"pst\"}}'::jsonb)"
    )

    content_row: str | None = None
    chunk_rows: list[str] = []
    body = message.get("body_text") or ""
    if body.strip():
        content_id = new_id()
        content_row = (
            f"('{content_id}','{source_file_id}','{email_id}','text','email_body',0,"
            f"{esc_body(body[:100000])},'ko',{len(body)},NULL,'readpst',NULL,NULL,NULL,NULL,NOW())"
        )
        char_pos = 0
        for index, chunk in enumerate(chunk_text(body)):
            chunk_rows.append(
                f"(gen_random_uuid(),'{content_id}','{source_file_id}',"
                f"{index},{esc(chunk)},{max(1, len(chunk)//4)},{char_pos},{char_pos + len(chunk)})"
            )
            char_pos += len(chunk) - 150

    return email_id, email_row, content_row, chunk_rows


def _flush_emails(rows: list[str]) -> None:
    if not rows:
        return
    psql_run_checked(
        "INSERT INTO email_messages("
        "id,source_file_id,message_id,subject,sender,recipients_to,sent_at,body_text,has_attachments,metadata"
        ") VALUES " + ",".join(rows) + " ON CONFLICT(source_file_id,message_id) DO NOTHING;"
    )
    rows.clear()


def _flush_contents(rows: list[str]) -> None:
    if not rows:
        return
    psql_run_checked(
        "INSERT INTO extracted_contents("
        "id,file_id,email_message_id,content_kind,unit_type,unit_index,text_content,language,char_count,"
        "confidence,processor_name,processor_version,model_name,prompt_version,metadata,created_at"
        ") VALUES " + ",".join(rows) + " ON CONFLICT DO NOTHING;"
    )
    rows.clear()


def _flush_chunks(rows: list[str]) -> None:
    if not rows:
        return
    psql_run_checked(
        "INSERT INTO content_chunks("
        "id,content_id,file_id,chunk_index,chunk_text,token_count,char_start,char_end"
        ") VALUES " + ",".join(rows) + " ON CONFLICT DO NOTHING;"
    )
    rows.clear()


def relative_attachment_path(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("/", "\\")


def upsert_attachment_file(evidence_source_id: str, path: Path) -> tuple[str, str]:
    """(file_id, sha256_hash) 반환. 파일 읽기는 신규 삽입 시 1회만 수행."""
    relative_path = relative_attachment_path(path)
    rows = psql_csv(
        "SELECT id, sha256_hash FROM files "
        f"WHERE evidence_source_id='{evidence_source_id}' AND relative_path={esc(relative_path)} LIMIT 1;"
    )
    if rows:
        return rows[0]["id"], rows[0].get("sha256_hash") or ""
    stat = path.stat()
    extension = path.suffix.lower() or None
    mime_type, _ = mimetypes.guess_type(path.name)
    sha, md5 = digest_both(path)
    category = category_for(extension or "")
    rows = psql_csv(
        "WITH inserted AS ("
        "INSERT INTO files("
        "evidence_source_id,directory_id,filename,extension,mime_type,original_path,relative_path,storage_uri,"
        "file_size,sha256_hash,md5_hash,is_system_path,is_user_content,category,etl_status,indexed_at"
        ") VALUES ("
        f"'{evidence_source_id}',NULL,{esc(path.name)},{esc(extension)},{esc(mime_type)},"
        f"{esc(str(path))},{esc(relative_path)},{esc(str(path))},"
        f"{stat.st_size},{esc(sha)},{esc(md5)},FALSE,TRUE,"
        f"'{category}'::file_category,'pending'::etl_status_type,NOW()"
        ") ON CONFLICT(evidence_source_id, relative_path) DO UPDATE SET "
        "file_size=EXCLUDED.file_size, sha256_hash=EXCLUDED.sha256_hash, md5_hash=EXCLUDED.md5_hash "
        "RETURNING id"
        ") SELECT id FROM inserted;"
    )
    return rows[0]["id"], sha


def insert_attachment(email_id: str, pst_file_id: str, attachment_file_id: str, attachment: Path, attachment_name: str, sha256_hash: str) -> None:
    size = attachment.stat().st_size
    content_type, _ = mimetypes.guess_type(attachment.name)
    metadata = json.dumps(
        {"source": "readpst", "pst_file_id": pst_file_id, "extracted_path": str(attachment)},
        ensure_ascii=False,
    )
    psql_run_checked(
        "INSERT INTO email_attachments("
        "email_id,file_id,attachment_name,content_type,size_bytes,sha256_hash,extracted_path,metadata,created_at"
        ") VALUES ("
        f"'{email_id}','{attachment_file_id}',{esc(attachment_name)},{esc(content_type)},"
        f"{size},{esc(sha256_hash)},{esc(str(attachment))},{esc(metadata)}::jsonb,NOW()"
        ") ON CONFLICT(email_id, attachment_name, size_bytes, sha256_hash) DO UPDATE SET "
        "file_id=EXCLUDED.file_id, content_type=EXCLUDED.content_type, extracted_path=EXCLUDED.extracted_path, metadata=EXCLUDED.metadata;"
    )
    psql_run_checked(
        "INSERT INTO file_derivatives("
        "parent_file_id,child_file_id,derivative_type,ordinal,original_name,extracted_path,metadata,created_at"
        ") VALUES ("
        f"'{pst_file_id}','{attachment_file_id}','email-attachment',0,"
        f"{esc(attachment_name)},{esc(str(attachment))},{esc(metadata)}::jsonb,NOW()"
        ") ON CONFLICT DO NOTHING;"
    )


def process_pst(row: dict) -> dict:
    out_dir = extract_pst(Path(row["original_path"]), row["id"])
    psql_run_checked(f"DELETE FROM email_messages WHERE source_file_id='{row['id']}';")

    seen: dict[str, int] = {}
    pending_emails: list[str] = []
    pending_contents: list[str] = []
    pending_chunks: list[str] = []
    email_count = 0
    attachment_count = 0

    for message_file in message_files(out_dir):
        attachments = attachment_files(message_file)
        message = parse_message(message_file, f"{row['id']}:{message_file}")
        email_id, email_row, content_row, chunk_rows = _prepare_email(
            row["id"], message, bool(attachments), seen
        )
        pending_emails.append(email_row)
        if content_row:
            pending_contents.append(content_row)
        pending_chunks.extend(chunk_rows)
        email_count += 1

        # FK 순서 유지: email → content → chunks 순으로 배치 flush
        if len(pending_emails) >= _EMAIL_BATCH:
            _flush_emails(pending_emails)
            _flush_contents(pending_contents)
            _flush_chunks(pending_chunks)
        elif len(pending_chunks) >= _CHUNK_BATCH:
            _flush_emails(pending_emails)
            _flush_contents(pending_contents)
            _flush_chunks(pending_chunks)

        for attachment in attachments:
            attachment_name = attachment.name[len(message_file.name) + 1:]
            attachment_file_id, attachment_sha = upsert_attachment_file(row["evidence_source_id"], attachment)
            insert_attachment(email_id, row["id"], attachment_file_id, attachment, attachment_name, attachment_sha)
            attachment_count += 1

    # 나머지 flush
    _flush_emails(pending_emails)
    _flush_contents(pending_contents)
    _flush_chunks(pending_chunks)

    psql_run_checked(
        "UPDATE files SET etl_status='done', etl_error=NULL, etl_processed_at=NOW() "
        f"WHERE id='{row['id']}';"
    )
    return {"emails": email_count, "attachments": attachment_count}


def run(options: dict) -> dict:
    ensure_schema()
    skipped_ost = ignore_ost()
    force = bool(options.get("force_reextract", False))
    processed = success = failed = attachments = 0
    for row in pst_rows(force_reprocess=force):
        processed += 1
        try:
            result = process_pst(row)
            success += result["emails"]
            attachments += result["attachments"]
        except Exception as exc:
            failed += 1
            psql_run_checked(
                "UPDATE files SET etl_status='failed', etl_error="
                f"{esc(str(exc)[:500])}, etl_processed_at=NOW() WHERE id='{row['id']}';"
            )
    return {
        "processed": processed,
        "success": success,
        "failed": failed,
        "skipped": skipped_ost,
        "message": f"pst_only=true, attachments={attachments}",
    }
