"""
agent/nodes/exfiltration.py
STEP 2 — 유출 행위 분석 Sub-Agent

Input (task dict):
  - subject_name: str
  - baseline_profile: dict   ← STEP 1 결과 (정상 기준선)
  - analysis_start: str
  - resignation_date: str
  - supervisor_instructions: str  ← Main Agent 수사 지침

Output:
  - suspicious_channels: list
"""
import json
import os
import re

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from agent.prompts import load_prompt
from agent.tools.rdb_tools import (
    get_anonymous_channel_emails,
    get_email_attachments,
    get_external_emails,
    get_messenger_logs,
)


def exfiltration_node(task: dict) -> dict:
    """STEP 2: 유출 행위 분석 Sub-Agent 노드. Main Agent로부터 task dict를 수신한다."""
    prompt = load_prompt("exfiltration")

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

    print(f"\n  [STEP 2 시작] {task['subject_name']} 유출 채널 탐지 중...")

    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
        callbacks=callbacks,
    )
    tools = [
        get_external_emails,
        get_anonymous_channel_emails,
        get_messenger_logs,
        get_email_attachments,
    ]

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
    return {"suspicious_channels": _parse_json_list(raw)}


def _parse_json_list(text: str) -> list:
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return []
