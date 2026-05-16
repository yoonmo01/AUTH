"""
agent/run.py
에이전트 시스템 실행 및 결과 출력 스크립트.

사전 조건:
  - Docker 컨테이너 실행 중 (PostgreSQL)
  - .env 파일에 OPENAI_API_KEY, POSTGRES_PASSWORD 설정

실행:
  python agent/run.py
"""
import io
import json
import sys
from pathlib import Path

# Windows 콘솔 UTF-8 출력
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from dotenv import load_dotenv

# 프로젝트 루트를 sys.path에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from agent.graph import build_graph
from agent.state import make_initial_state


class AgentLogger(BaseCallbackHandler):
    """에이전트 사고 과정을 콘솔에 출력하는 콜백 핸들러."""

    def on_llm_start(self, serialized, prompts, **kwargs):
        pass  # 프롬프트 입력은 생략

    def on_llm_end(self, response: LLMResult, **kwargs):
        pass  # 최종 결과는 아래에서 처리

    def on_tool_start(self, serialized, input_str, **kwargs):
        tool_name = serialized.get("name", "unknown")
        print(f"  → [Tool 호출] {tool_name}  입력: {str(input_str)[:150]}")

    def on_tool_end(self, output, **kwargs):
        preview = str(output)[:200]
        print(f"  ← [DB 결과]  {preview}{'...' if len(str(output)) > 200 else ''}")

    def on_agent_action(self, action, **kwargs):
        pass  # on_tool_start에서 처리

    def on_agent_finish(self, finish, **kwargs):
        output = str(finish.return_values.get("output", ""))[:300]
        print(f"  ✓ [판단 완료] {output}")

    def on_chat_model_start(self, serialized, messages, **kwargs):
        pass


# 콜백 인스턴스를 모듈 레벨에 생성 → baseline.py에서 주입
agent_logger = AgentLogger()


def main():
    graph = build_graph()

    initial_state = make_initial_state(
        subject_name="이지수",
        subject_position="과장",
        hire_date="2019-03-01",
        resignation_date="2021-02-28",
        source_label="HYENA CTF",
    )

    print("=" * 60)
    print(f"분석 대상: {initial_state['subject_name']} ({initial_state['subject_position']})")
    print(f"분석 기간: {initial_state['analysis_start']} ~ {initial_state['resignation_date']}")
    print("=" * 60)
    print("분석 시작...\n")

    # stream_mode="updates" — 각 노드가 완료될 때 상태 변경 사항만 수신
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
            # 마지막 이벤트에서 최종 상태 누적
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
