"""
agent/nodes/exfiltration.py
STEP 2 — 유출 행위 분석 Sub-Agent (뼈대)
담당: 동료

구현 순서:
  1. agent/tools/rdb_tools.py 의 STEP 2 TODO 함수 4개 구현
       - get_external_emails
       - get_anonymous_channel_emails
       - get_messenger_logs
       - get_email_attachments
  2. 이 파일의 exfiltration_node() 아래 TODO 블록 구현

Input (state에서 읽음):
  - subject_name: str
  - baseline_profile: dict   ← STEP 1 결과 (정상 기준선)
  - analysis_start: str
  - resignation_date: str

Output (state에 저장):
  - suspicious_channels: list
    [
      {
        "channel_type": "protonmail" | "tmpbox" | "personal_gmail" |
                        "anonymous_channel" | "messenger_leak" | "baseline_anomaly",
        "email_id": "uuid",
        "sender": "발신자",
        "recipient": "수신자",
        "subject": "제목",
        "sent_at": "ISO8601",
        "has_attachment": bool,
        "attachments": [{"filename": "...", "size_bytes": 0}],
        "body_preview": "본문 앞부분",
        "highlight_keywords": ["키워드"],
        "suspicion_reason": "의심 사유",
        "risk_weight": 0~40
      }
    ]
"""
import json
import os
import re

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from agent.prompts import load_prompt
from agent.state import InvestigationState

# TODO: 아래 import 주석 해제 후 사용 (rdb_tools.py STEP 2 구현 완료 후)
# from agent.tools.rdb_tools import (
#     get_external_emails,
#     get_anonymous_channel_emails,
#     get_messenger_logs,
#     get_email_attachments,
# )


def exfiltration_node(state: InvestigationState) -> dict:
    """STEP 2: 유출 행위 분석 Sub-Agent 노드."""

    # TODO: 아래 블록 구현
    # prompt = load_prompt("exfiltration")
    # ctx = {
    #     "subject_name": state["subject_name"],
    #     "baseline_summary": json.dumps(state["baseline_profile"], ensure_ascii=False),
    #     "analysis_start": state["analysis_start"],
    #     "resignation_date": state["resignation_date"],
    # }
    # llm = ChatOpenAI(model=os.getenv("AGENT_MODEL", "gpt-5.1"), temperature=0)
    # tools = [
    #     get_external_emails,
    #     get_anonymous_channel_emails,
    #     get_messenger_logs,
    #     get_email_attachments,
    # ]
    # agent = create_agent(
    #     llm, tools,
    #     system_prompt=prompt["system"].format(**ctx),
    # )
    # result = agent.invoke({"messages": [("user", prompt["task"].format(**ctx))]})
    # raw = result["messages"][-1].content
    # suspicious_channels = _parse_json_list(raw)
    # return {"suspicious_channels": suspicious_channels}

    # 뼈대: rdb_tools.py STEP 2 구현 완료 전까지 빈 결과 반환
    return {"suspicious_channels": []}


def _parse_json_list(text: str) -> list:
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return []
