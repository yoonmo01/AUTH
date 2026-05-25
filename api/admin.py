# api/admin.py
# 역할: 관리자 inbox 조회 및 검토 처리 라우터
#   GET  /admin/inbox                          → 제출된 세션 목록 (직원정보+소명+분석결과)
#   PATCH /admin/inbox/{session_id}/review     → status='reviewed' 처리
#   GET  /admin/sessions/{session_id}/narrative → LLM 관리자 줄글 (캐싱)
# 쓰는 테이블: admin_inbox, employees, investigation_sessions, explanations

import json
import os
import re

from fastapi import APIRouter, HTTPException

from agent.prompts import load_prompt
from api.db import execute, query
from api.models import esc, require_uuid

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


def _parse_narrative_json(text: str) -> dict:
    m = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}


@router.get("/admin/sessions/{session_id}/narrative")
def get_admin_narrative(session_id: str):
    require_uuid(session_id, "session_id")

    rows = query(
        f"SELECT s.report_json, s.agent_trace, s.admin_narrative, "
        f"       ex.text AS explanation_text "
        f"FROM investigation_sessions s "
        f"LEFT JOIN explanations ex ON ex.session_id = s.id "
        f"WHERE s.id='{session_id}';"
    )
    if not rows:
        raise HTTPException(404, "Session not found")
    row = rows[0]

    # 캐시 hit
    narrative = row.get("admin_narrative")
    if isinstance(narrative, str):
        try:
            narrative = json.loads(narrative)
        except (json.JSONDecodeError, TypeError):
            narrative = None
    if isinstance(narrative, dict) and narrative:
        return narrative

    # 캐시 miss → LLM 호출
    report_json = row.get("report_json")
    agent_trace = row.get("agent_trace")
    if isinstance(report_json, str):
        report_json = json.loads(report_json)
    if isinstance(agent_trace, str):
        try:
            agent_trace = json.loads(agent_trace)
        except Exception:
            agent_trace = None
    if not report_json:
        raise HTTPException(409, "Session has no report yet")

    from langchain_openai import ChatOpenAI
    prompt = load_prompt("admin_narrative")
    llm = ChatOpenAI(
        model=os.getenv("NARRATIVE_MODEL", "gpt-4o"),
        temperature=0,
    )
    ctx = {
        "report_json":      json.dumps(report_json, ensure_ascii=False),
        "agent_trace":      json.dumps(agent_trace or {}, ensure_ascii=False),
        "explanation_text": row.get("explanation_text") or "(소명 미제출)",
    }
    result = llm.invoke([
        ("system", prompt["system"]),
        ("user", prompt["task"].format(**ctx)),
    ])
    narrative = _parse_narrative_json(result.content)
    if not narrative:
        raise HTTPException(502, "Narrative generation failed")

    # 캐시 저장
    execute(
        f"UPDATE investigation_sessions "
        f"SET admin_narrative={esc(json.dumps(narrative, ensure_ascii=False))} "
        f"WHERE id='{session_id}';"
    )
    return narrative


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
