# api/agent_runner.py
# 역할: 에이전트 파이프라인 실행 라우터
#   POST /agent/run   — 분석 대상 정보를 받아 백그라운드 스레드로 파이프라인 기동,
#                       즉시 {session_id} 반환 (202)
#   GET  /agent/events/{session_id} — SSE 스트림: 각 노드 시작/완료 + 최종 완료 이벤트
import asyncio
import json
import queue as q_module
import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from api.db import execute
from api.models import esc
from api.progress import cleanup, emit, get_queue, register
from agent.graph import build_graph
from agent.state import make_initial_state
from agent.tools.rdb_tools import get_pg_conn

router = APIRouter(prefix="/agent", tags=["agent"])


class AgentRunRequest(BaseModel):
    subject_name: str
    subject_position: str
    hire_date: str
    resignation_date: str
    source_label: str = "HYENA CTF"
    case_id: Optional[str] = None
    session_id: Optional[str] = None


def _get_analysis_start(user_name: str) -> str:
    """DB의 실제 데이터 최초 날짜를 analysis_start로 반환한다."""
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT MIN(dt) FROM (
                    SELECT MIN(sent_at)::date AS dt FROM email_messages
                     WHERE sender ILIKE %s OR recipients_to::text ILIKE %s
                    UNION ALL
                    SELECT MIN(last_run_at)::date FROM file_access_logs
                     WHERE user_name ILIKE %s
                    UNION ALL
                    SELECT MIN(event_at)::date FROM activity_events
                     WHERE actor ILIKE %s
                    UNION ALL
                    SELECT MIN(sent_at)::date FROM messenger_logs
                     WHERE sender ILIKE %s
                ) sub
                """,
                (f"%{user_name}%", f"%{user_name}%",
                 f"%{user_name}%", f"%{user_name}%", f"%{user_name}%"),
            )
            result = cur.fetchone()[0]
            return str(result) if result else "2021-01-01"
    finally:
        conn.close()


def _run_agent_thread(session_id: str, body: AgentRunRequest) -> None:
    """백그라운드 스레드에서 LangGraph 파이프라인을 실행하고 결과를 DB에 저장한다."""
    try:
        analysis_start = _get_analysis_start(body.subject_name)
        graph = build_graph()
        initial_state = make_initial_state(
            subject_name=body.subject_name,
            subject_position=body.subject_position,
            hire_date=body.hire_date,
            resignation_date=body.resignation_date,
            source_label=body.source_label,
            analysis_start=analysis_start,
            session_id=session_id,
        )

        result = graph.invoke(initial_state)

        final_report = result.get("final_report", {})
        verdict = result.get("verdict", "UNKNOWN")
        risk_score = result.get("risk_score", 0)

        agent_trace = {
            "baseline_profile":   result.get("baseline_profile", {}),
            "behavior_anomalies": result.get("behavior_anomalies", {}),
            "verified_findings":  result.get("verified_findings", []),
            "cross_reference":    result.get("cross_reference", []),
            "supervisor_context": result.get("supervisor_context", {}),
            "analysis_start":     initial_state["analysis_start"],
            "subject_name":       initial_state["subject_name"],
            "subject_position":   initial_state["subject_position"],
        }

        report_sql = esc(json.dumps(final_report, ensure_ascii=False))
        trace_sql  = esc(json.dumps(agent_trace, ensure_ascii=False))
        execute(
            f"UPDATE investigation_sessions "
            f"SET status='completed', completed_at=NOW(), "
            f"    report_json={report_sql}, agent_trace={trace_sql} "
            f"WHERE id='{session_id}';"
        )

        emit(session_id, {
            "event": "completed",
            "session_id": session_id,
            "verdict": verdict,
            "risk_score": risk_score,
        })

    except Exception as e:
        execute(f"UPDATE investigation_sessions SET status='error' WHERE id='{session_id}';")
        emit(session_id, {"event": "error", "message": str(e)})

    finally:
        # SSE 클라이언트가 완료 이벤트를 읽을 시간을 준 뒤 큐를 정리한다.
        time.sleep(30)
        cleanup(session_id)


@router.post("/run", status_code=202)
def run_agent(body: AgentRunRequest):
    """에이전트 파이프라인을 백그라운드 스레드로 기동하고 session_id를 즉시 반환한다."""
    if body.session_id:
        session_id = body.session_id
    else:
        session_id = str(uuid.uuid4())
        case_sql = f"'{body.case_id}'" if body.case_id else "NULL"
        execute(
            f"INSERT INTO investigation_sessions(id,case_id,query_text,query_intent,status,started_at) "
            f"VALUES('{session_id}',{case_sql},'에이전트 자동 분석','agent_run','running',NOW());"
        )

    register(session_id)

    threading.Thread(
        target=_run_agent_thread,
        args=(session_id, body),
        daemon=True,
    ).start()

    return {"session_id": session_id}


@router.get("/events/{session_id}")
async def agent_events(session_id: str, request: Request):
    """SSE 스트림: 에이전트 노드별 시작/완료 이벤트와 최종 완료/오류 이벤트를 전달한다."""
    q = get_queue(session_id)
    if q is None:
        raise HTTPException(status_code=404, detail="session not found or expired")

    async def generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                event = q.get_nowait()
                yield {"data": json.dumps(event, ensure_ascii=False)}
                if event.get("event") in ("completed", "error"):
                    break
            except q_module.Empty:
                await asyncio.sleep(0.3)

    return EventSourceResponse(generator())
