# api/explanations.py
# 역할: 사원 소명 제출 라우터 (= 관리자 inbox 자동 진입)
#   POST /sessions/{session_id}/explanations
#     body: {employee_id, text}
#     explanations INSERT + admin_inbox INSERT (status='submitted') 단일 호출
#     반환: {ok:true}
# 쓰는 테이블: explanations, admin_inbox

from fastapi import APIRouter, HTTPException

from api.db import execute, query
from api.models import ExplanationSubmit, esc, require_uuid

router = APIRouter()


@router.post("/sessions/{session_id}/explanations")
def submit_explanation(session_id: str, body: ExplanationSubmit):
    require_uuid(session_id, "session_id")

    sess = query(f"SELECT id FROM investigation_sessions WHERE id = '{session_id}';")
    if not sess:
        raise HTTPException(404, "Session not found")

    execute(
        f"INSERT INTO explanations(session_id, employee_id, text) "
        f"VALUES ('{session_id}', {esc(body.employee_id)}, {esc(body.text)}); "
        f"INSERT INTO admin_inbox(session_id, employee_id, status) "
        f"VALUES ('{session_id}', {esc(body.employee_id)}, 'submitted');"
    )
    return {"ok": True}
