"""
agent/nodes/baseline.py
STEP 1 — Baseline Sub-Agent (풀 구현)

Main Supervisor로부터 task를 받아 정상 행동 기준선을 수립한다.
  [계획] 분석 항목 순서 결정
  [실행] get_email_history / get_file_access_history / get_activity_events 호출
  [반환] baseline_profile dict → Main Agent로 반환
"""
import json
import os
import re
from datetime import datetime, timedelta

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from agent.prompts import load_prompt
from agent.state import InvestigationState
from agent.tools.rdb_tools import (
    get_activity_events,
    get_email_history,
    get_file_access_history,
)


def baseline_node(state: InvestigationState) -> dict:
    """STEP 1: 기준선 수립 Sub-Agent 노드."""
    prompt = load_prompt("baseline")

    resign_dt = datetime.strptime(state["resignation_date"], "%Y-%m-%d")
    baseline_end = (resign_dt - timedelta(days=30)).strftime("%Y-%m-%d")

    ctx = {
        "subject_name": state["subject_name"],
        "subject_position": state["subject_position"],
        "analysis_start": state["analysis_start"],
        "baseline_end": baseline_end,
        "resignation_date": state["resignation_date"],
    }

    # run.py에서 AgentLogger 콜백이 주입된 경우 사용 (없으면 콜백 없이 실행)
    try:
        from agent.run import agent_logger
        callbacks = [agent_logger]
    except ImportError:
        callbacks = []

    print(f"\n  [STEP 1 시작] {state['subject_name']} 기준선 수립 중...")

    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
        callbacks=callbacks,
    )
    tools = [get_email_history, get_file_access_history, get_activity_events]

    agent = create_react_agent(
        llm,
        tools,
        prompt=SystemMessage(content=prompt["system"].format(**ctx)),
    )

    result = agent.invoke(
        {"messages": [("user", prompt["task"].format(**ctx))]},
        config={"callbacks": callbacks},
    )

    raw = result["messages"][-1].content
    baseline_profile = _parse_json(raw)
    return {"baseline_profile": baseline_profile}


def _parse_json(text: str) -> dict:
    """LLM 응답에서 JSON 블록을 추출해 파싱한다."""
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    # 블록 없으면 전체를 JSON으로 시도
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text, "parse_error": True}
