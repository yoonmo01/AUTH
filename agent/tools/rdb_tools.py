"""
agent/tools/rdb_tools.py
PostgreSQL Tool 함수 모음.

- STEP 1 (Baseline): get_email_history, get_file_access_history, get_activity_events  ← 풀 구현
- STEP 2 (유출 행위 분석): get_external_emails, get_anonymous_channel_emails,
                          get_messenger_logs, get_email_attachments              ← TODO (동료)
"""
import json
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from langchain_core.tools import tool


# ---------------------------------------------------------------------------
# 연결 헬퍼
# ---------------------------------------------------------------------------

def get_pg_conn() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.getenv("HYENA_POSTGRES_HOST", "localhost"),
        port=int(os.getenv("HYENA_POSTGRES_PORT", "55432")),
        dbname=os.getenv("HYENA_POSTGRES_DB", "hyena"),
        user=os.getenv("HYENA_POSTGRES_USER", "hyena"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


def _fetchall_as_json(cur: psycopg2.extensions.cursor) -> str:
    rows = cur.fetchall()
    col_names = [desc[0] for desc in cur.description]
    result = [dict(zip(col_names, row)) for row in rows]
    return json.dumps(result, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# STEP 1 — Baseline Agent Tools
# ---------------------------------------------------------------------------

@tool
def get_email_history(user_name: str, date_from: str, date_to: str) -> str:
    """email_messages 테이블에서 특정 사용자의 기간 내 이메일 이력을 조회합니다.

    Args:
        user_name: 조회할 사용자 이름 (예: "이지수")
        date_from: 시작 날짜 (YYYY-MM-DD)
        date_to: 종료 날짜 (YYYY-MM-DD)

    Returns:
        이메일 목록 JSON 문자열 (id, subject, sender, recipients_to, sent_at, has_attachments)
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (subject, sender, sent_at)
                  id, subject, sender, recipients_to, sent_at, has_attachments
                FROM email_messages
                WHERE sender ILIKE %s
                  AND sent_at BETWEEN %s AND %s
                ORDER BY subject, sender, sent_at
                """,
                (f"%{user_name}%", date_from, date_to),
            )
            return _fetchall_as_json(cur)
    finally:
        conn.close()


@tool
def get_file_access_history(user_name: str, date_from: str, date_to: str) -> str:
    """file_access_logs 테이블에서 특정 사용자의 기간 내 파일 실행 이력을 조회합니다.

    Args:
        user_name: 조회할 사용자 이름
        date_from: 시작 날짜 (YYYY-MM-DD)
        date_to: 종료 날짜 (YYYY-MM-DD)

    Returns:
        파일 실행 이력 JSON 문자열 (id, filename, full_path, run_count, last_run_at)
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (filename, user_name, last_run_at)
                  id, filename, full_path, run_count, last_run_at
                FROM file_access_logs
                WHERE user_name ILIKE %s
                  AND last_run_at BETWEEN %s AND %s
                ORDER BY filename, user_name, last_run_at
                """,
                (f"%{user_name}%", date_from, date_to),
            )
            return _fetchall_as_json(cur)
    finally:
        conn.close()


@tool
def get_activity_events(
    user_name: str,
    date_from: str,
    date_to: str,
    event_types: Optional[str] = None,
) -> str:
    """activity_events 테이블에서 특정 사용자의 기간 내 활동 이벤트를 조회합니다.

    Args:
        user_name: 조회할 사용자 이름
        date_from: 시작 날짜 (YYYY-MM-DD)
        date_to: 종료 날짜 (YYYY-MM-DD)
        event_types: 필터할 이벤트 유형 (콤마 구분 문자열, 예: "USB,network"). None이면 전체 조회.

    Returns:
        이벤트 목록 JSON 문자열 (id, event_type, event_at, actor, process_name, target_path, run_count)
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            if event_types:
                types_list = [t.strip() for t in event_types.split(",")]
                cur.execute(
                    """
                    SELECT DISTINCT ON (actor, event_type, event_at, target_path)
                      id, event_type, event_at, actor, process_name, target_path, run_count
                    FROM activity_events
                    WHERE actor ILIKE %s
                      AND event_at BETWEEN %s AND %s
                      AND event_type = ANY(%s)
                    ORDER BY actor, event_type, event_at, target_path
                    """,
                    (f"%{user_name}%", date_from, date_to, types_list),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT ON (actor, event_type, event_at, target_path)
                      id, event_type, event_at, actor, process_name, target_path, run_count
                    FROM activity_events
                    WHERE actor ILIKE %s
                      AND event_at BETWEEN %s AND %s
                    ORDER BY actor, event_type, event_at, target_path
                    """,
                    (f"%{user_name}%", date_from, date_to),
                )
            return _fetchall_as_json(cur)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# STEP 2 — 유출 행위 분석 Agent Tools  (TODO: 동료 구현)
# ---------------------------------------------------------------------------

@tool
def get_external_emails(user_name: str, date_from: str, date_to: str) -> str:
    """외부 수신자에게 발송된 이메일 목록을 조회합니다. (내부 도메인 hb.* 제외)

    Args:
        user_name: 발신자 이름
        date_from: 시작 날짜 (YYYY-MM-DD)
        date_to: 종료 날짜 (YYYY-MM-DD)

    Returns:
        외부 발신 이메일 목록 JSON 문자열
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, subject, sender, recipients_to, sent_at,
                       has_attachments, body_text
                FROM email_messages
                WHERE sender ILIKE %s
                  AND sent_at BETWEEN %s AND %s
                  AND recipients_to::text NOT ILIKE '%%hb.%%'
                ORDER BY sent_at
                """,
                (f"%{user_name}%", date_from, date_to),
            )
            return _fetchall_as_json(cur)
    finally:
        conn.close()


@tool
def get_anonymous_channel_emails(date_from: str, date_to: str) -> str:
    """ProtonMail, tmpbox 등 익명/일회용 채널 이메일을 조회합니다.

    Args:
        date_from: 시작 날짜 (YYYY-MM-DD)
        date_to: 종료 날짜 (YYYY-MM-DD)

    Returns:
        익명 채널 이메일 목록 JSON 문자열
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, subject, sender, recipients_to, sent_at,
                       has_attachments, body_text
                FROM email_messages
                WHERE sent_at BETWEEN %s AND %s
                  AND (
                    sender ILIKE '%%protonmail%%'
                    OR sender ILIKE '%%tmpbox%%'
                    OR sender ILIKE '%%moakt%%'
                    OR sender ILIKE '%%guerrillamail%%'
                    OR sender ILIKE '%%tutanota%%'
                    OR recipients_to::text ILIKE '%%protonmail%%'
                    OR recipients_to::text ILIKE '%%tmpbox%%'
                    OR recipients_to::text ILIKE '%%moakt%%'
                    OR recipients_to::text ILIKE '%%guerrillamail%%'
                    OR recipients_to::text ILIKE '%%tutanota%%'
                  )
                ORDER BY sent_at
                """,
                (date_from, date_to),
            )
            return _fetchall_as_json(cur)
    finally:
        conn.close()


@tool
def get_messenger_logs(
    user_name: str,
    date_from: str,
    date_to: str,
    keywords: Optional[str] = None,
) -> str:
    """메신저 대화 기록을 조회합니다.

    Args:
        user_name: 조회할 사용자 이름
        date_from: 시작 날짜 (YYYY-MM-DD)
        date_to: 종료 날짜 (YYYY-MM-DD)
        keywords: 필터 키워드 (콤마 구분, 예: "단가,계약,거래처"). None이면 전체 조회.

    Returns:
        메신저 로그 목록 JSON 문자열 (id, chat_title, sender, message, sent_at)
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            if keywords:
                kw_list = [f"%{kw.strip()}%" for kw in keywords.split(",")]
                cur.execute(
                    """
                    SELECT id, chat_title, sender, message, sent_at
                    FROM messenger_logs
                    WHERE sender ILIKE %s
                      AND sent_at BETWEEN %s AND %s
                      AND message ILIKE ANY(%s)
                    ORDER BY sent_at
                    """,
                    (f"%{user_name}%", date_from, date_to, kw_list),
                )
            else:
                cur.execute(
                    """
                    SELECT id, chat_title, sender, message, sent_at
                    FROM messenger_logs
                    WHERE sender ILIKE %s
                      AND sent_at BETWEEN %s AND %s
                    ORDER BY sent_at
                    """,
                    (f"%{user_name}%", date_from, date_to),
                )
            return _fetchall_as_json(cur)
    finally:
        conn.close()


@tool
def get_email_attachments(email_id: str) -> str:
    """특정 이메일의 첨부파일 목록을 조회합니다.

    Args:
        email_id: email_messages.id (UUID 문자열)

    Returns:
        첨부파일 목록 JSON 문자열 (id, attachment_name, size_bytes, extracted_path)
    """
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, attachment_name, size_bytes, extracted_path
                FROM email_attachments
                WHERE email_id = %s
                ORDER BY attachment_name
                """,
                (email_id,),
            )
            return _fetchall_as_json(cur)
    finally:
        conn.close()
