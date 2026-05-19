"""
agent/nodes/sensitive_files.py
STEP 3 — 민감 파일 분류 Sub-Agent

Input (task dict):
  - subject_name: str
  - source_label: str
  - supervisor_instructions: str  ← Main Agent 수사 지침

Output:
  - sensitive_files: list
    [
      {
        "file_id": "uuid",
        "filename": "파일명",
        "relative_path": "경로",
        "extension": ".xlsx",
        "sensitivity_score": 0.0~1.0,
        "sensitivity_category": "단가/계약" | "인사/내부" | "영업/전략" | "기술/설계" | "재무" | "일반 업무",
        "matched_keywords": ["키워드"],
        "related_entities": ["엔티티명"],
        "highlight_keywords": ["키워드"]
      }
    ]
    sensitivity_score 0.7 미만 항목은 제외.
"""
import json
import os
import re

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from agent.prompts import load_prompt
from agent.tools.vector_tools import search_vector_db, get_chunk_by_file
from agent.tools.graph_tools import get_files_by_entity, get_file_metadata


def sensitive_files_node(task: dict) -> dict:
    """STEP 3: 민감 파일 분류 Sub-Agent 노드. Main Agent로부터 task dict를 수신한다."""
    prompt = load_prompt("sensitive_files")

    ctx = {
        "subject_name": task["subject_name"],
        "source_label": task["source_label"],
        "supervisor_instructions": task.get("supervisor_instructions", ""),
    }

    try:
        from agent.run import agent_logger
        callbacks = [agent_logger]
    except ImportError:
        callbacks = []

    print(f"\n  [STEP 3 시작] {task['subject_name']} 민감 파일 분류 중...")

    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-5.1"),
        temperature=0,
        callbacks=callbacks,
    )
    tools = [search_vector_db, get_chunk_by_file, get_files_by_entity, get_file_metadata]

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
    return {"sensitive_files": _parse_json_list(raw)}


def _parse_json_list(text: str) -> list:
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return []
