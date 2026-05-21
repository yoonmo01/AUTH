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
from agent.nodes.behavior import behavior_node
from agent.nodes.counter_evidence import counter_evidence_node
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
            fname = attachment.get("filename", "") or attachment.get("attachment_name", "")
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

def _calculate_risk_score(state: InvestigationState) -> tuple[int, dict]:
    score = 0
    breakdown = {}

    # +40: 기밀 파일이 익명 채널로 발신됨 (교차 대조 hit)
    if state.get("cross_reference"):
        score += 40
        breakdown["cross_ref"] = 40

    # +30: 은폐 시도 (deleted_files 존재)
    who = state.get("behavior_anomalies", {}).get("who_analysis", {})
    if who.get("deleted_files"):
        score += 30
        breakdown["deleted_files"] = 30

    # +20: Baseline 대비 이상 행동 (anomaly_score 0.7 이상인 날짜 존재)
    timeline = (
        state.get("behavior_anomalies", {})
        .get("when_analysis", {})
        .get("timeline", [])
    )
    if any(d.get("anomaly_score", 0) >= 0.7 for d in timeline):
        score += 20
        breakdown["anomaly"] = 20

    # +15: 익명 채널 사용만 (파일 매칭 없음)
    cross_email_ids = {r["email_id"] for r in state.get("cross_reference", [])}
    anon_only = [
        c for c in state.get("suspicious_channels", [])
        if c.get("channel_type") in ("protonmail", "tmpbox")
        and c.get("email_id") not in cross_email_ids
    ]
    anon_score = len(anon_only) * 15
    if anon_score:
        score += anon_score
        breakdown["anon_channel"] = anon_score

    # -20: Counter-evidence 반증 (verified=False 항목당)
    false_count = sum(
        1 for f in state.get("verified_findings", [])
        if not f.get("verified", True)
    )
    counter_score = false_count * -20
    if counter_score:
        score += counter_score
        breakdown["counter_evidence"] = counter_score

    return max(0, score), breakdown


def _calculate_verdict(risk_score: int) -> str:
    if risk_score >= 81:
        return "HIGH"
    elif risk_score >= 61:
        return "MEDIUM"
    elif risk_score >= 41:
        return "LOW"
    return "CLEAN"


# ---------------------------------------------------------------------------
# Main Agent 추론 헬퍼 — Sub-Agent task 생성 전 LLM 1회 호출
# ---------------------------------------------------------------------------

def _supervisor_reason(system_prompt: str, user_prompt: str) -> str:
    """Main Agent LLM 1회 호출 — 다음 Sub-Agent에 줄 수사 지침 생성."""
    llm = ChatOpenAI(model=os.getenv("AGENT_MODEL", "gpt-5.1"), temperature=0)
    result = llm.invoke([
        ("system", system_prompt),
        ("user", user_prompt),
    ])
    return result.content


# ---------------------------------------------------------------------------
# 노드 함수
# ---------------------------------------------------------------------------

def step1_node(state: InvestigationState) -> dict:
    """STEP 1 Baseline Sub-Agent 실행. Main Agent가 먼저 수사 지침을 추론한 뒤 task로 전달."""
    main_prompt = load_prompt("main")
    ctx = {
        "subject_name": state["subject_name"],
        "subject_position": state["subject_position"],
        "hire_date": state["hire_date"],
        "resignation_date": state["resignation_date"],
        "analysis_start": state["analysis_start"],
    }
    print(f"\n  [Main Agent] STEP 1 수사 지침 추론 중...")
    instructions = _supervisor_reason(
        system_prompt=main_prompt["supervisor_system"],
        user_prompt=main_prompt["step1_task"].format(**ctx),
    )
    print(f"  [Main Agent → STEP 1] {instructions[:80]}...")

    task = {
        "task": "baseline_profile 수립",
        "subject_name": state["subject_name"],
        "subject_position": state["subject_position"],
        "analysis_start": state["analysis_start"],
        "resignation_date": state["resignation_date"],
        "source_label": state["source_label"],
        "supervisor_instructions": instructions,
    }
    result = baseline_node(task)
    result["supervisor_context"] = {"step1": instructions}
    return result


def parallel_node(state: InvestigationState) -> dict:
    """STEP 2 / STEP 3 / STEP 4 병렬 실행.
    Main Agent가 baseline 결과를 보고 각 Sub-Agent에 줄 지침을 추론한 뒤 task로 전달한다.
    """
    main_prompt = load_prompt("main")
    baseline = state.get("baseline_profile", {})
    ctx_common = {
        "subject_name": state["subject_name"],
        "subject_position": state["subject_position"],
        "baseline_summary": json.dumps(baseline, ensure_ascii=False),
        "analysis_start": state["analysis_start"],
        "resignation_date": state["resignation_date"],
        "source_label": state["source_label"],
    }

    print(f"\n  [Main Agent] STEP 2/3/4 수사 지침 추론 중 (병렬)...")
    with ThreadPoolExecutor(max_workers=3) as pre:
        f2 = pre.submit(_supervisor_reason,
                        main_prompt["supervisor_system"],
                        main_prompt["step2_task"].format(**ctx_common))
        f3 = pre.submit(_supervisor_reason,
                        main_prompt["supervisor_system"],
                        main_prompt["step3_task"].format(**ctx_common))
        f4 = pre.submit(_supervisor_reason,
                        main_prompt["supervisor_system"],
                        main_prompt["step4_task"].format(**ctx_common))
    instructions_step2 = f2.result()
    instructions_step3 = f3.result()
    instructions_step4 = f4.result()
    print(f"  [Main Agent → STEP 2] {instructions_step2[:80]}...")
    print(f"  [Main Agent → STEP 3] {instructions_step3[:80]}...")
    print(f"  [Main Agent → STEP 4] {instructions_step4[:80]}...")

    task2 = {
        "task": "유출 채널 탐지",
        "subject_name": state["subject_name"],
        "baseline_profile": baseline,
        "analysis_start": state["analysis_start"],
        "resignation_date": state["resignation_date"],
        "supervisor_instructions": instructions_step2,
    }
    task3 = {
        "task": "민감 파일 분류",
        "subject_name": state["subject_name"],
        "source_label": state["source_label"],
        "supervisor_instructions": instructions_step3,
    }
    task4 = {
        "task": "행동 패턴 이상 분석",
        "subject_name": state["subject_name"],
        "baseline_profile": baseline,
        "analysis_start": state["analysis_start"],
        "resignation_date": state["resignation_date"],
        "supervisor_instructions": instructions_step4,
    }

    results = {}

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(exfiltration_node, task2): "step2",
            executor.submit(sensitive_files_node, task3): "step3",
            executor.submit(behavior_node, task4): "step4",
        }
        for future in as_completed(futures):
            results.update(future.result())

    prev = state.get("supervisor_context", {})
    results["supervisor_context"] = {
        **prev,
        "step2": instructions_step2,
        "step3": instructions_step3,
        "step4": instructions_step4,
    }
    return results


def cross_ref_node(state: InvestigationState) -> dict:
    """Main Agent 교차 대조 — 결정론적 코드."""
    cross = _cross_reference(
        state.get("suspicious_channels", []),
        state.get("sensitive_files", []),
    )
    return {"cross_reference": cross}


def step5_node(state: InvestigationState) -> dict:
    """STEP 5 Counter-evidence Sub-Agent — Main Agent가 교차 대조 결과를 보고 반증 지침을 추론."""
    main_prompt = load_prompt("main")
    ctx = {
        "subject_name": state["subject_name"],
        "cross_reference_summary": json.dumps(state.get("cross_reference", []), ensure_ascii=False),
        "suspicious_count": len(state.get("suspicious_channels", [])),
        "sensitive_count": len(state.get("sensitive_files", [])),
        "deleted_files_count": len(
            state.get("behavior_anomalies", {})
                .get("who_analysis", {})
                .get("deleted_files", [])
        ),
    }
    print(f"\n  [Main Agent] STEP 5 사실 검증 지침 추론 중...")
    instructions = _supervisor_reason(
        system_prompt=main_prompt["supervisor_system"],
        user_prompt=main_prompt["step5_task"].format(**ctx),
    )
    print(f"  [Main Agent → STEP 5] {instructions[:80]}...")

    task = {
        "task": "의심 항목 반증 검증",
        "subject_name": state["subject_name"],
        "analysis_start": state.get("analysis_start", ""),
        "resignation_date": state.get("resignation_date", ""),
        "suspicious_channels": state.get("suspicious_channels", []),
        "sensitive_files": state.get("sensitive_files", []),
        "behavior_anomalies": state.get("behavior_anomalies", {}),
        "cross_reference": state.get("cross_reference", []),
        "supervisor_instructions": instructions,
    }
    result = counter_evidence_node(task)
    prev = state.get("supervisor_context", {})
    return {
        "verified_findings": result.get("verified_findings", []),
        "supervisor_context": {**prev, "step5": instructions},
    }


def scoring_node(state: InvestigationState) -> dict:
    """Main Agent 리스크 스코어링 — 결정론적 코드."""
    score, breakdown = _calculate_risk_score(state)
    verdict = _calculate_verdict(score)
    return {"risk_score": score, "verdict": verdict, "risk_breakdown": breakdown}


def report_node(state: InvestigationState) -> dict:
    """Main Agent 최종 리포트 생성 — LLM 1회 호출."""
    prompt = load_prompt("main")
    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
    )

    verified = state.get("verified_findings", [])
    ctx = {
        "subject_name": state["subject_name"],
        "subject_position": state["subject_position"],
        "hire_date": state["hire_date"],
        "resignation_date": state["resignation_date"],
        "analysis_start": state["analysis_start"],
        "verdict": state["verdict"],
        "risk_score": state["risk_score"],
        "risk_breakdown": json.dumps(state.get("risk_breakdown", {}), ensure_ascii=False),
        "baseline_profile": json.dumps(state.get("baseline_profile", {}), ensure_ascii=False),
        "suspicious_channels": json.dumps(state.get("suspicious_channels", []), ensure_ascii=False),
        "sensitive_files": json.dumps(state.get("sensitive_files", []), ensure_ascii=False),
        "cross_reference": json.dumps(state.get("cross_reference", []), ensure_ascii=False),
        "verified_findings": json.dumps(verified, ensure_ascii=False),
        "behavior_anomalies": json.dumps(state.get("behavior_anomalies", {}), ensure_ascii=False),
        "emails_analyzed": len(state.get("suspicious_channels", [])),
        "files_analyzed": len(state.get("sensitive_files", [])),
        "anomalies_found": len(state.get("cross_reference", [])),
        "false_positives_removed": sum(1 for f in verified if not f.get("verified", True)),
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

def _progress_wrap(step: str, fn):
    """노드 함수를 감싸 SSE 진행 이벤트를 emit한다. session_id가 없으면 무시."""
    def wrapper(state: InvestigationState):
        sid = state.get("session_id", "")
        if sid:
            from api.progress import emit
            emit(sid, {"event": "step_start", "step": step})
        result = fn(state)
        if sid:
            from api.progress import emit
            emit(sid, {"event": "step_done", "step": step})
        return result
    return wrapper


def build_graph():
    """Main Supervisor LangGraph 그래프를 생성하고 컴파일해서 반환한다."""
    g = StateGraph(InvestigationState)

    g.add_node("step1",     _progress_wrap("step1",     step1_node))
    g.add_node("parallel",  _progress_wrap("parallel",  parallel_node))
    g.add_node("cross_ref", _progress_wrap("cross_ref", cross_ref_node))
    g.add_node("step5",     _progress_wrap("step5",     step5_node))
    g.add_node("scoring",   _progress_wrap("scoring",   scoring_node))
    g.add_node("report",    _progress_wrap("report",    report_node))

    g.set_entry_point("step1")
    g.add_edge("step1",     "parallel")
    g.add_edge("parallel",  "cross_ref")
    g.add_edge("cross_ref", "step5")
    g.add_edge("step5",     "scoring")
    g.add_edge("scoring",   "report")
    g.add_edge("report",    END)

    return g.compile()
