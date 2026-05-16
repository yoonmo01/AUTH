"""
agent/graph.py
Main Supervisor — LangGraph StateGraph

설계 문서 섹션 5 기준으로 구현.
Sub-Agent 실행 순서:
  STEP 1 → STEP 2/3/4(병렬) → 교차 대조(코드) → STEP 5(플레이스홀더)
  → 리스크 스코어링(코드) → 최종 리포트(LLM 1회)
"""
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from agent.nodes.baseline import baseline_node
from agent.nodes.exfiltration import exfiltration_node
from agent.nodes.sensitive_files import sensitive_files_node
from agent.prompts import load_prompt
from agent.state import InvestigationState


# ---------------------------------------------------------------------------
# 교차 대조 — 설계 문서 cross_reference() 코드 그대로
# ---------------------------------------------------------------------------

def _cross_reference(suspicious_channels: list, sensitive_files: list) -> list:
    """유출 경로로 나간 파일 중 민감 파일이 포함된 경우를 매핑한다."""
    results = []
    sensitive_filenames = {f["filename"].lower() for f in sensitive_files}

    for channel in suspicious_channels:
        for attachment in channel.get("attachments", []):
            fname = attachment.get("filename", "")
            if fname.lower() in sensitive_filenames:
                results.append({
                    "email_id": channel.get("email_id"),
                    "channel_type": channel.get("channel_type"),
                    "sensitive_file": fname,
                    "sent_at": channel.get("sent_at"),
                    "match_reason": (
                        f"민감 파일 '{fname}' 이 "
                        f"{channel.get('channel_type')}로 발송됨"
                    ),
                })
    return results


# ---------------------------------------------------------------------------
# 리스크 스코어링 — 설계 문서 가중치 테이블 그대로
# ---------------------------------------------------------------------------

def _calculate_risk_score(state: InvestigationState) -> int:
    score = 0

    # +40: 기밀 파일이 익명 채널로 발신됨 (교차 대조 hit)
    if state.get("cross_reference"):
        score += 40

    # +30: 은폐 시도 (deleted_files 존재)
    who = state.get("behavior_anomalies", {}).get("who_analysis", {})
    if who.get("deleted_files"):
        score += 30

    # +20: Baseline 대비 이상 행동 (anomaly_score 0.7 이상인 날짜 존재)
    timeline = (
        state.get("behavior_anomalies", {})
        .get("when_analysis", {})
        .get("timeline", [])
    )
    if any(d.get("anomaly_score", 0) >= 0.7 for d in timeline):
        score += 20

    # +15: 익명 채널 사용만 (파일 매칭 없음)
    cross_email_ids = {r["email_id"] for r in state.get("cross_reference", [])}
    anon_only = [
        c for c in state.get("suspicious_channels", [])
        if c.get("channel_type") in ("protonmail", "tmpbox")
        and c.get("email_id") not in cross_email_ids
    ]
    score += len(anon_only) * 15

    # -20: Counter-evidence 반증 (verified=False 항목당)
    false_count = sum(
        1 for f in state.get("verified_findings", [])
        if not f.get("verified", True)
    )
    score -= false_count * 20

    return max(0, score)


def _calculate_verdict(risk_score: int) -> str:
    if risk_score >= 81:
        return "HIGH"
    elif risk_score >= 61:
        return "MEDIUM"
    elif risk_score >= 41:
        return "LOW"
    return "CLEAN"


# ---------------------------------------------------------------------------
# 노드 함수
# ---------------------------------------------------------------------------

def step1_node(state: InvestigationState) -> dict:
    """STEP 1 Baseline Sub-Agent 실행."""
    return baseline_node(state)


def parallel_node(state: InvestigationState) -> dict:
    """STEP 2 / STEP 3 / STEP 4 병렬 실행.
    Main Supervisor가 각 Sub-Agent에 task를 동시에 전달하고 결과를 수집한다.
    """
    results = {}

    def run_step4(_state):
        # STEP 4 (행동 패턴 분석) 플레이스홀더 — 추후 구현
        return {"behavior_anomalies": {}}

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(exfiltration_node, state): "step2",
            executor.submit(sensitive_files_node, state): "step3",
            executor.submit(run_step4, state): "step4",
        }
        for future in as_completed(futures):
            results.update(future.result())

    return results


def cross_ref_node(state: InvestigationState) -> dict:
    """Main Agent 교차 대조 — 결정론적 코드."""
    cross = _cross_reference(
        state.get("suspicious_channels", []),
        state.get("sensitive_files", []),
    )
    return {"cross_reference": cross}


def step5_node(state: InvestigationState) -> dict:
    """STEP 5 Counter-evidence Sub-Agent 플레이스홀더 — 추후 구현."""
    return {"verified_findings": []}


def scoring_node(state: InvestigationState) -> dict:
    """Main Agent 리스크 스코어링 — 결정론적 코드."""
    score = _calculate_risk_score(state)
    verdict = _calculate_verdict(score)
    return {"risk_score": score, "verdict": verdict}


def report_node(state: InvestigationState) -> dict:
    """Main Agent 최종 리포트 생성 — LLM 1회 호출."""
    prompt = load_prompt("main")
    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
    )

    ctx = {
        "subject_name": state["subject_name"],
        "subject_position": state["subject_position"],
        "hire_date": state["hire_date"],
        "resignation_date": state["resignation_date"],
        "analysis_start": state["analysis_start"],
        "verdict": state["verdict"],
        "risk_score": state["risk_score"],
        "baseline_profile": json.dumps(state.get("baseline_profile", {}), ensure_ascii=False),
        "cross_reference": json.dumps(state.get("cross_reference", []), ensure_ascii=False),
        "verified_findings": json.dumps(state.get("verified_findings", []), ensure_ascii=False),
        "behavior_anomalies": json.dumps(state.get("behavior_anomalies", {}), ensure_ascii=False),
    }

    result = llm.invoke([
        ("system", prompt["system"].format(**ctx)),
        ("user", prompt["report_task"].format(**ctx)),
    ])

    final_report = _parse_json(result.content)
    return {"final_report": final_report}


def _parse_json(text: str) -> dict:
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text, "parse_error": True}


# ---------------------------------------------------------------------------
# 그래프 조립
# ---------------------------------------------------------------------------

def build_graph():
    """Main Supervisor LangGraph 그래프를 생성하고 컴파일해서 반환한다."""
    g = StateGraph(InvestigationState)

    g.add_node("step1",     step1_node)
    g.add_node("parallel",  parallel_node)
    g.add_node("cross_ref", cross_ref_node)
    g.add_node("step5",     step5_node)
    g.add_node("scoring",   scoring_node)
    g.add_node("report",    report_node)

    g.set_entry_point("step1")
    g.add_edge("step1",     "parallel")
    g.add_edge("parallel",  "cross_ref")
    g.add_edge("cross_ref", "step5")
    g.add_edge("step5",     "scoring")
    g.add_edge("scoring",   "report")
    g.add_edge("report",    END)

    return g.compile()
