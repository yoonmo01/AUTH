# api/explanations.py
# 역할: 사원 소명 제출 라우터 (= 관리자 inbox 자동 진입)
#   POST /sessions/{session_id}/explanations
#     body: {employee_id, text}
#     explanations INSERT + admin_inbox INSERT (status='submitted') 단일 호출
#     반환: {ok:true}
#   POST /sessions/{session_id}/explanations/skip
#     body: {employee_id}
#     소명 불필요 세션을 admin_inbox에만 INSERT
# 쓰는 테이블: explanations, admin_inbox

import json

from fastapi import APIRouter, HTTPException

from api.db import execute, query
from api.models import ExplanationSkip, ExplanationSubmit, esc, require_uuid

router = APIRouter()


def _report_requires_explanation(session_id: str) -> bool:
    rows = query(f"SELECT report_json FROM investigation_sessions WHERE id = '{session_id}';")
    if not rows:
        raise HTTPException(404, "Session not found")

    raw = rows[0].get("report_json")
    if isinstance(raw, str):
        try:
            report = json.loads(raw)
        except json.JSONDecodeError:
            report = {}
    elif isinstance(raw, dict):
        report = raw
    else:
        report = {}

    if isinstance(report.get("final_report"), dict):
        report = report["final_report"]

    verdict = report.get("verdict")
    try:
        risk_score = int(report.get("risk_score") or 0)
    except (TypeError, ValueError):
        risk_score = 0

    if verdict in ("LOW", "CLEAN"):
        return False
    return risk_score > 20


@router.post("/sessions/{session_id}/explanations")
def submit_explanation(session_id: str, body: ExplanationSubmit):
    require_uuid(session_id, "session_id")

    if not _report_requires_explanation(session_id):
        raise HTTPException(400, "Explanation is not required for this session")

    execute(
        f"INSERT INTO explanations(session_id, employee_id, text) "
        f"VALUES ('{session_id}', {esc(body.employee_id)}, {esc(body.text)}) "
        f"ON CONFLICT (session_id) DO UPDATE SET text = EXCLUDED.text, submitted_at = NOW(); "
        f"INSERT INTO admin_inbox(session_id, employee_id, status) "
        f"VALUES ('{session_id}', {esc(body.employee_id)}, 'submitted') "
        f"ON CONFLICT (session_id) DO NOTHING;"
    )
    return {"ok": True}


@router.post("/sessions/{session_id}/explanations/skip")
def skip_explanation(session_id: str, body: ExplanationSkip):
    require_uuid(session_id, "session_id")

    if _report_requires_explanation(session_id):
        raise HTTPException(400, "Explanation is required for this session")

    execute(
        f"INSERT INTO admin_inbox(session_id, employee_id, status) "
        f"VALUES ('{session_id}', {esc(body.employee_id)}, 'submitted') "
        f"ON CONFLICT (session_id) DO NOTHING;"
    )
    return {"ok": True, "skipped": True}
