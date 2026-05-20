"""
agent/nodes/counter_evidence.py
STEP 5 — 반증 검증 Sub-Agent
"""
import json
import os
import re

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from agent.prompts import load_prompt
from agent.tools.rdb_tools import (
    get_deleted_files,
    get_email_attachments,
    get_email_history,
    get_messenger_logs,
)


def counter_evidence_node(task: dict) -> dict:
    """STEP 5: 반증 검증 Sub-Agent 노드. Main Agent로부터 task dict를 수신한다."""
    prompt = load_prompt("counter_evidence")

    ctx = {
        "subject_name": task["subject_name"],
        "analysis_start": task.get("analysis_start", ""),
        "resignation_date": task.get("resignation_date", ""),
        "cross_reference_summary": json.dumps(
            task.get("cross_reference", []), ensure_ascii=False
        ),
        "suspicious_channels_detail": json.dumps(
            task.get("suspicious_channels", []), ensure_ascii=False
        ),
        "deleted_files_claims": json.dumps(
            task.get("behavior_anomalies", {}).get("who_analysis", {}).get("deleted_files", []),
            ensure_ascii=False,
        ),
        "supervisor_instructions": task.get("supervisor_instructions", ""),
    }

    try:
        from agent.run import agent_logger
        callbacks = [agent_logger]
    except ImportError:
        callbacks = []

    print(f"\n  [STEP 5 시작] {task['subject_name']} 반증 검증 중...")

    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
        callbacks=callbacks,
    )
    tools = [get_email_history, get_email_attachments, get_deleted_files, get_messenger_logs]

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
    return {"verified_findings": _parse_json_list(raw)}


def _parse_json_list(text: str) -> list:
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return []
