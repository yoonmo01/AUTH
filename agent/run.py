"""
agent/run.py
에이전트 시스템 실행 및 결과 출력 스크립트.

사전 조건:
  - Docker 컨테이너 실행 중 (PostgreSQL)
  - .env 파일에 OPENAI_API_KEY, POSTGRES_PASSWORD 설정

실행:
  python agent/run.py          # 기본값(이지수)
  python agent/run.py 1        # 이지수
  python agent/run.py 2        # 강수민
  python agent/run.py 3        # 장국주
"""
import io
import json
import logging
import sys
from pathlib import Path

# ─── 로그 출력 ON/OFF ───────────────────────────────────────
VERBOSE = True   # False로 바꾸면 Tool 입출력 로그 꺼짐
# ────────────────────────────────────────────────────────────

# Windows 콘솔 UTF-8 출력
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="[INFO] %(asctime)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("agent.orchestrator")

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from agent.graph import build_graph
from agent.state import make_initial_state
from agent.tools.rdb_tools import get_pg_conn


# ---------------------------------------------------------------------------
# 분석 대상 목록 (이름/직급/입사일/퇴사일/source_label)
# ---------------------------------------------------------------------------

SUBJECTS = {
    "1": {
        "subject_name": "이지수",
        "subject_position": "과장",
        "hire_date": "2019-03-01",
        "resignation_date": "2021-02-28",
        "source_label": "HYENA CTF",
    },
    "2": {
        "subject_name": "강수민",
        "subject_position": "대리",
        "hire_date": "2020-01-01",
        "resignation_date": "2021-02-28",
        "source_label": "HYENA CTF",
    },
    "3": {
        "subject_name": "장국주",
        "subject_position": "팀장",
        "hire_date": "2015-01-01",
        "resignation_date": "2021-02-28",
        "source_label": "HYENA CTF",
    },
}


# ---------------------------------------------------------------------------
# DB에서 실제 데이터 시작일 조회
# ---------------------------------------------------------------------------

def get_analysis_start(user_name: str) -> str:
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


# ---------------------------------------------------------------------------
# 콜백 핸들러
# ---------------------------------------------------------------------------

class AgentLogger(BaseCallbackHandler):
    """에이전트 사고 과정을 콘솔에 출력하는 콜백 핸들러."""

    def on_llm_start(self, serialized, prompts, **kwargs):
        pass

    def on_llm_end(self, response: LLMResult, **kwargs):
        pass

    def on_agent_action(self, _action, **kwargs):
        # create_agent(function calling 방식)에서는 호출되지 않음
        pass

    def on_tool_start(self, serialized, input_str, **kwargs):
        if not VERBOSE:
            return
        tool_name = serialized.get("name", "unknown")
        logger.info(f"[ToolCall] Tool={tool_name} | Input={str(input_str)[:200]}")

    def on_tool_end(self, output, **kwargs):
        if not VERBOSE:
            return
        raw = getattr(output, "content", None) or str(output)
        preview = str(raw)[:300]
        logger.info(f"[ToolResult] Output={preview}{'...' if len(str(raw)) > 300 else ''}")

    def on_agent_finish(self, finish, **kwargs):
        if not VERBOSE:
            return
        output = str(finish.return_values.get("output", ""))[:300]
        logger.info(f"[AgentFinish] {output}")

    def on_chat_model_start(self, serialized, messages, **kwargs):
        pass


agent_logger = AgentLogger()


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def main():
    # CLI 인자: python agent/run.py [1|2|3]
    subject_key = sys.argv[1] if len(sys.argv) > 1 else "1"
    if subject_key not in SUBJECTS:
        print(f"사용법: python agent/run.py [1|2|3]")
        print(f"  1 = 이지수, 2 = 강수민, 3 = 장국주")
        sys.exit(1)

    subject = SUBJECTS[subject_key]
    analysis_start = get_analysis_start(subject["subject_name"])

    graph = build_graph()

    initial_state = make_initial_state(
        subject_name=subject["subject_name"],
        subject_position=subject["subject_position"],
        hire_date=subject["hire_date"],
        resignation_date=subject["resignation_date"],
        source_label=subject["source_label"],
        analysis_start=analysis_start,
    )

    print("=" * 60)
    print(f"분석 대상: {initial_state['subject_name']} ({initial_state['subject_position']})")
    print(f"분석 기간: {initial_state['analysis_start']} ~ {initial_state['resignation_date']}")
    print(f"  (DB 실제 데이터 시작일 기준)")
    print("=" * 60)
    print("분석 시작...\n")

    NODE_LABELS = {
        "step1": "STEP 1 Baseline",
        "parallel": "STEP 2/3/4 병렬",
        "cross_ref": "교차 대조",
        "step5": "STEP 5 Counter-evidence",
        "scoring": "리스크 스코어링",
        "report": "최종 리포트 생성",
    }

    result = None
    for event in graph.stream(initial_state, stream_mode="updates"):
        for node_name, update in event.items():
            label = NODE_LABELS.get(node_name, node_name)
            changed_keys = list(update.keys()) if isinstance(update, dict) else []
            print(f"\n✅ [{label}] 완료 → 업데이트 필드: {changed_keys}")
            if result is None:
                result = dict(initial_state)
            if isinstance(update, dict):
                result.update(update)

    print("\n" + "=" * 60)
    print(f"판정: {result['verdict']}  (리스크 점수: {result['risk_score']})")
    print("=" * 60)

    print("\n[STEP 1] 기준선 프로필")
    print(json.dumps(result.get("baseline_profile", {}), ensure_ascii=False, indent=2))

    print("\n[STEP 2] 유출 의심 채널")
    print(json.dumps(result.get("suspicious_channels", []), ensure_ascii=False, indent=2))

    print("\n[교차 대조 결과]")
    print(json.dumps(result.get("cross_reference", []), ensure_ascii=False, indent=2))

    print("\n[STEP 5] 검증된 의심 항목")
    print(json.dumps(result.get("verified_findings", []), ensure_ascii=False, indent=2))

    print("\n[최종 리포트]")
    print(json.dumps(result.get("final_report", {}), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
