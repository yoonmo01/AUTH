# api/consents.py
# 역할: 동의 및 전자서명 저장 라우터
#   POST /sessions/{session_id}/consents
#     body: {employee_id, consents:[{consent_type, agreement_text, signature_png_b64}, ...]}
#     서버에서 client_ip / user_agent / signed_at / SHA-256 해시 계산 후 저장
#     반환: {ok:true, count:2}
# 쓰는 테이블: consents

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from api.db import execute, query
from api.models import ConsentSubmit, esc, require_uuid

router = APIRouter()

_VALID_CONSENT_TYPES = {"system_use", "messenger_access"}


@router.post("/sessions/{session_id}/consents")
def submit_consents(session_id: str, body: ConsentSubmit, request: Request):
    require_uuid(session_id, "session_id")

    # 세션 존재 확인
    sess = query(f"SELECT id FROM investigation_sessions WHERE id = '{session_id}';")
    if not sess:
        raise HTTPException(404, "Session not found")

    # consent_type 검증
    for item in body.consents:
        if item.consent_type not in _VALID_CONSENT_TYPES:
            raise HTTPException(400, f"Invalid consent_type '{item.consent_type}'")

    client_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")

    for item in body.consents:
        cid = str(uuid.uuid4())
        signed_at = datetime.now(timezone.utc).isoformat()
        hash_input = item.agreement_text + item.signature_png_b64 + body.employee_id + signed_at
        signature_hash = hashlib.sha256(hash_input.encode()).hexdigest()

        execute(
            f"INSERT INTO consents"
            f"(id, session_id, employee_id, consent_type, agreement_text, "
            f"signature_png_b64, signature_hash, client_ip, user_agent, signed_at) "
            f"VALUES ('{cid}', '{session_id}', {esc(body.employee_id)}, "
            f"{esc(item.consent_type)}, {esc(item.agreement_text)}, "
            f"{esc(item.signature_png_b64)}, '{signature_hash}', "
            f"{esc(client_ip)}, {esc(user_agent)}, '{signed_at}');"
        )

    return {"ok": True, "count": len(body.consents)}
