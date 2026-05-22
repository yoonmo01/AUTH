# api/audits.py
# 역할: 사원 정기 점검 세션 생성 라우터
#   POST /audits → investigation_sessions에 INSERT 후 session_id 반환
#     body: {employee_id, quarter, evidence_root_path?}
#     검증: employees 존재 확인
#     반환: {session_id, status:"running"}
# 쓰는 테이블: investigation_sessions, employees

import uuid

from fastapi import APIRouter, HTTPException

from api.db import query, execute
from api.models import AuditCreate, esc

router = APIRouter()


@router.post("/audits", status_code=201)
def create_audit(body: AuditCreate):
    emp_rows = query(
        f"SELECT name FROM employees WHERE employee_id = {esc(body.employee_id)};"
    )
    if not emp_rows:
        raise HTTPException(400, "Invalid employee_id: employee not found")

    name = emp_rows[0]["name"]
    sid = str(uuid.uuid4())
    query_text = f"{body.quarter} 정기 점검 - {name}"

    execute(
        f"INSERT INTO investigation_sessions"
        f"(id, query_text, employee_id, quarter, status, started_at) "
        f"VALUES ('{sid}', {esc(query_text)}, {esc(body.employee_id)}, {esc(body.quarter)}, 'running', NOW());"
    )
    return {"session_id": sid, "status": "running"}
