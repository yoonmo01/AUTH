# api/sessions.py
# 역할: 점검 세션 관리 라우터
#   POST  /sessions                          → 세션 생성 (query_text, case_id)
#                                              반환: {id, status:"running"}
#   GET   /sessions                          → 세션 목록 (limit 기본 20)
#                                              반환: [{id, query_text, query_intent, status, started_at, completed_at}]
#   GET   /sessions/{session_id}             → 세션 상세 + report_json
#   PATCH /sessions/{session_id}/complete    → 세션 완료 처리, 리포트 저장
#                                              바디: 자유 dict (report_json으로 저장)
# 쓰는 테이블: investigation_sessions

import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.db import query, execute
from api.models import SessionCreate, esc, require_uuid

router = APIRouter()


@router.post("/sessions", status_code=201)
def create_session(body: SessionCreate):
    sid = str(uuid.uuid4())
    if body.case_id:
        require_uuid(body.case_id, "case_id")
    case_sql = f"'{body.case_id}'" if body.case_id else "NULL"
    execute(
        f"INSERT INTO investigation_sessions(id,case_id,query_text,query_intent,status,started_at) "
        f"VALUES('{sid}',{case_sql},{esc(body.query_text)},{esc(body.query_intent)},'running',NOW());"
    )
    return {"id": sid, "status": "running"}


@router.get("/sessions")
def list_sessions(limit: int = Query(20, le=100)):
    return query(
        f"SELECT id, query_text, query_intent, status, started_at, completed_at, "
        f"report_json->>'verdict' AS verdict, "
        f"(report_json->>'risk_score')::int AS risk_score "
        f"FROM investigation_sessions ORDER BY started_at DESC LIMIT {limit};"
    )


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    require_uuid(session_id, "session_id")
    rows = query(
        f"SELECT id,query_text,query_intent,status,started_at,completed_at,"
        f"report_json, agent_trace, "
        f"report_json->>'verdict' AS verdict, "
        f"(report_json->>'risk_score')::int AS risk_score "
        f"FROM investigation_sessions WHERE id='{session_id}';"
    )
    if not rows:
        raise HTTPException(404, "Session not found")
    row = rows[0]
    # db.py는 CSV 방식으로 JSONB를 문자열로 반환한다 — 객체로 파싱해서 전달.
    if isinstance(row.get("report_json"), str):
        try:
            row["report_json"] = json.loads(row["report_json"])
        except (json.JSONDecodeError, TypeError):
            row["report_json"] = None
    if isinstance(row.get("agent_trace"), str):
        try:
            row["agent_trace"] = json.loads(row["agent_trace"])
        except (json.JSONDecodeError, TypeError):
            row["agent_trace"] = None
    if row.get("verdict") is None and isinstance(row.get("report_json"), dict):
        report = row["report_json"]
        if isinstance(report.get("final_report"), dict):
            report = report["final_report"]
        row["verdict"] = report.get("verdict")
        row["risk_score"] = report.get("risk_score")
    return row


@router.patch("/sessions/{session_id}/complete")
def complete_session(session_id: str, report: Optional[dict] = None):
    require_uuid(session_id, "session_id")
    report_sql = esc(json.dumps(report, ensure_ascii=False)) if report else "NULL"
    execute(
        f"UPDATE investigation_sessions "
        f"SET status='completed', completed_at=NOW(), report_json={report_sql} "
        f"WHERE id='{session_id}';"
    )
    return {"status": "completed"}
