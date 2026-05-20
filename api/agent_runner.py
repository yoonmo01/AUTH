# api/agent_runner.py
# 역할: 에이전트 파이프라인 실행 라우터
#   POST /agent/run — 분석 대상 정보를 받아 파이프라인 동기 실행 후 결과 반환
#                     investigation_sessions 테이블에 결과 저장
import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db import execute
from api.models import esc
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
                (f"%{user_name}%",) * 5,
            )
            result = cur.fetchone()[0]
            return str(result) if result else "2021-01-01"
    finally:
        conn.close()


@router.post("/run", status_code=200)
def run_agent(body: AgentRunRequest):
    session_id = str(uuid.uuid4())
    case_sql = f"'{body.case_id}'" if body.case_id else "NULL"

    execute(
        f"INSERT INTO investigation_sessions(id,case_id,query_text,query_intent,status,started_at) "
        f"VALUES('{session_id}',{case_sql},'에이전트 자동 분석','agent_run','running',NOW());"
    )

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
        )

        result = graph.invoke(initial_state)

        final_report = result.get("final_report", {})
        verdict = result.get("verdict", "UNKNOWN")
        risk_score = result.get("risk_score", 0)

        report_sql = esc(json.dumps(final_report, ensure_ascii=False))
        execute(
            f"UPDATE investigation_sessions "
            f"SET status='completed', completed_at=NOW(), report_json={report_sql} "
            f"WHERE id='{session_id}';"
        )

        return {
            "session_id": session_id,
            "verdict": verdict,
            "risk_score": risk_score,
            "final_report": final_report,
        }

    except Exception as e:
        execute(f"UPDATE investigation_sessions SET status='error' WHERE id='{session_id}';")
        raise HTTPException(status_code=500, detail=str(e))
