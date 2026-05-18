"""
agent/nodes/behavior.py
STEP 4 — 행동 패턴 분석 Sub-Agent

Main Supervisor로부터 task를 받아 WHO/WHEN 두 관점으로 이상 행동을 분석한다.
  [계획] WHO/WHEN 분석 항목 순서 결정
  [실행] get_file_access_history / get_deleted_files / get_activity_events / get_messenger_logs 호출
  [반환] behavior_anomalies dict → Main Agent로 반환
"""
import json
import os
import re

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from agent.prompts import load_prompt
from agent.tools.rdb_tools import (
    get_activity_events,
    get_deleted_files,
    get_file_access_history,
    get_messenger_logs,
)


def behavior_node(task: dict) -> dict:
    """STEP 4: 행동 패턴 분석 Sub-Agent 노드. Main Agent로부터 task dict를 수신한다."""
    prompt = load_prompt("behavior")

    ctx = {
        "subject_name": task["subject_name"],
        "baseline_summary": json.dumps(task["baseline_profile"], ensure_ascii=False),
        "analysis_start": task["analysis_start"],
        "resignation_date": task["resignation_date"],
        "supervisor_instructions": task.get("supervisor_instructions", ""),
    }

    try:
        from agent.run import agent_logger
        callbacks = [agent_logger]
    except ImportError:
        callbacks = []

    print(f"\n  [STEP 4 시작] {task['subject_name']} 행동 패턴 분석 중...")

    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
        callbacks=callbacks,
    )
    tools = [get_file_access_history, get_deleted_files, get_activity_events, get_messenger_logs]

    agent = create_agent(
        llm,
        tools,
        system_prompt=prompt["system"].format(**ctx),
    )

    result = agent.invoke(
        {"messages": [("user", prompt["task"].format(**ctx))]},
        config={"callbacks": callbacks},
    )

    raw = result["messages"][-1].content
    behavior_anomalies = _parse_json(raw)
    return {"behavior_anomalies": behavior_anomalies}


def _parse_json(text: str) -> dict:
    """LLM 응답에서 JSON 블록을 추출해 파싱한다."""
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text, "parse_error": True}
