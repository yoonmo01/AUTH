"""
agent/nodes/sensitive_files.py
STEP 3 — 민감 파일 분류 Sub-Agent (뼈대)
담당: 동료

구현 순서:
  1. agent/tools/vector_tools.py 의 TODO 함수 구현
       - search_vector_db
       - get_chunk_by_file
  2. agent/tools/graph_tools.py 의 TODO 함수 구현
       - get_files_by_entity
       - get_file_metadata
  3. 이 파일의 sensitive_files_node() 아래 TODO 블록 구현

Input (state에서 읽음):
  - subject_name: str
  - source_label: str

Output (state에 저장):
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
from agent.state import InvestigationState

# TODO: 아래 import 주석 해제 후 사용 (vector_tools.py, graph_tools.py 구현 완료 후)
# from agent.tools.vector_tools import search_vector_db, get_chunk_by_file
# from agent.tools.graph_tools import get_files_by_entity, get_file_metadata


def sensitive_files_node(state: InvestigationState) -> dict:
    """STEP 3: 민감 파일 분류 Sub-Agent 노드."""

    # TODO: 아래 블록 구현
    # prompt = load_prompt("sensitive_files")
    # ctx = {
    #     "subject_name": state["subject_name"],
    #     "source_label": state["source_label"],
    # }
    # llm = ChatOpenAI(model=os.getenv("AGENT_MODEL", "gpt-5.1"), temperature=0)
    # tools = [search_vector_db, get_chunk_by_file, get_files_by_entity, get_file_metadata]
    # agent = create_agent(
    #     llm, tools,
    #     system_prompt=prompt["system"].format(**ctx),
    # )
    # result = agent.invoke({"messages": [("user", prompt["task"].format(**ctx))]})
    # raw = result["messages"][-1].content
    # sensitive_files = _parse_json_list(raw)
    # return {"sensitive_files": sensitive_files}

    # 뼈대: vector_tools.py, graph_tools.py 구현 완료 전까지 빈 결과 반환
    return {"sensitive_files": []}


def _parse_json_list(text: str) -> list:
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return []
