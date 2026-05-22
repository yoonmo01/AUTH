# api/admin.py
# 역할: 관리자 inbox 조회 및 검토 처리 라우터
#   GET  /admin/inbox                      → 제출된 세션 목록 (직원정보+소명+분석결과)
#   PATCH /admin/inbox/{session_id}/review → status='reviewed' 처리
# 쓰는 테이블: admin_inbox, employees, investigation_sessions, explanations

from fastapi import APIRouter, HTTPException

from api.db import execute, query
from api.models import require_uuid

router = APIRouter()


@router.get("/admin/inbox")
def get_inbox():
    rows = query(
        "SELECT ai.session_id, ai.employee_id, e.name, e.position, e.department, "
        "isess.quarter, isess.started_at, isess.completed_at, "
        "isess.report_json->>'verdict'          AS verdict, "
        "(isess.report_json->>'risk_score')::int AS risk_score, "
        "ai.status, ai.submitted_at, ai.reviewed_at, "
        "ex.text AS explanation_text "
        "FROM admin_inbox ai "
        "JOIN employees e              ON e.employee_id = ai.employee_id "
        "JOIN investigation_sessions isess ON isess.id = ai.session_id "
        "LEFT JOIN explanations ex     ON ex.session_id = ai.session_id "
        "ORDER BY ai.submitted_at DESC;"
    )
    return rows


@router.patch("/admin/inbox/{session_id}/review")
def mark_reviewed(session_id: str):
    require_uuid(session_id, "session_id")
    rows = query(f"SELECT session_id FROM admin_inbox WHERE session_id = '{session_id}';")
    if not rows:
        raise HTTPException(404, "Inbox entry not found")
    execute(
        f"UPDATE admin_inbox SET status='reviewed', reviewed_at=NOW() "
        f"WHERE session_id = '{session_id}';"
    )
    return {"ok": True, "status": "reviewed"}
