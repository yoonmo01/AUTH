# api/models.py
# 역할: API 레이어 공통 Pydantic 모델 및 SQL 헬퍼.
#   모든 API 라우터 파일이 이 모듈을 공유해서 사용한다.
# 제공하는 것:
#   CaseCreate, SessionCreate, FindingCreate, EvidenceCreate — 점검 세션 요청 바디
#   LoginRequest, AuditCreate, ConsentItem, ConsentSubmit, ExplanationSubmit — 정기 점검
#   esc(s)              → SQL 안전 문자열 이스케이프 (제어문자 + 따옴표 처리)
#   require_uuid(v)     → UUID 형식 검증, 실패 시 HTTP 400
#   require_category(v) → file_category ENUM 검증, 실패 시 HTTP 400

import re
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel


class CaseCreate(BaseModel):
    title: str
    description: Optional[str] = None
    charge_type: Optional[str] = None


class SessionCreate(BaseModel):
    query_text: str
    query_intent: Optional[str] = None
    case_id: Optional[str] = None


class FindingCreate(BaseModel):
    session_id: str
    finding_type: str
    severity: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    agent_name: Optional[str] = None
    confidence: Optional[float] = None


class EvidenceCreate(BaseModel):
    finding_id: str
    evidence_source: str
    evidence_id: str
    note: Optional[str] = None


def esc(s: Optional[str]) -> str:
    if s is None:
        return "NULL"
    s = s.replace("\x00", "")
    s = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
    return "'" + s.replace("'", "''") + "'"


_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)
_VALID_CATEGORIES = {
    "document", "image", "audio", "email_store",
    "archive", "system_artifact", "unknown",
}


def require_uuid(value: str, name: str = "id") -> str:
    if not _UUID_RE.match(value):
        raise HTTPException(400, f"Invalid {name}: must be a UUID")
    return value.lower()


def require_category(value: Optional[str]) -> Optional[str]:
    if value is not None and value not in _VALID_CATEGORIES:
        raise HTTPException(400, f"Invalid category '{value}'. Valid: {sorted(_VALID_CATEGORIES)}")
    return value


# ── 정기 점검 / 사원·관리자 시스템 모델 ─────────────────────────

class LoginRequest(BaseModel):
    role: str                        # "employee" | "admin"
    id: str
    password: Optional[str] = None


class AuditCreate(BaseModel):
    employee_id: str
    quarter: str                     # 예: "2026-Q1"
    evidence_root_path: Optional[str] = None


class ConsentItem(BaseModel):
    consent_type: str                # "system_use" | "messenger_access"
    agreement_text: str
    signature_png_b64: str           # data:image/png;base64,...


class ConsentSubmit(BaseModel):
    employee_id: str
    consents: list[ConsentItem]


class ExplanationSubmit(BaseModel):
    employee_id: str
    text: str


class ExplanationSkip(BaseModel):
    employee_id: str
