# api/cases.py
# 역할: 점검 케이스(Cases) 관리 라우터
#   POST  /cases              → 케이스 생성 (title, description, charge_type)
#                               반환: {id, status:"active"}
#   GET   /cases              → 케이스 목록 (limit 기본 20)
#                               반환: [{id, title, description, charge_type, status, created_at, updated_at}]
#   GET   /cases/{case_id}    → 케이스 상세 + 연결된 세션 목록
#                               반환: {케이스 필드..., sessions:[{id, query_text, status, ...}]}
#   PATCH /cases/{case_id}    → 케이스 상태 변경 (active|paused|closed|archived)
#                               반환: {case_id, status}
# 쓰는 테이블: cases, investigation_sessions (읽기)

import uuid

from fastapi import APIRouter, HTTPException, Query

from api.db import query, execute
from api.models import CaseCreate, esc, require_uuid

router = APIRouter()


@router.post("/cases", status_code=201)
def create_case(body: CaseCreate):
    cid = str(uuid.uuid4())
    execute(
        f"INSERT INTO cases(id,title,description,charge_type,status,created_at,updated_at) "
        f"VALUES('{cid}',{esc(body.title)},{esc(body.description)},"
        f"{esc(body.charge_type)},'active',NOW(),NOW());"
    )
    return {"id": cid, "status": "active"}


@router.get("/cases")
def list_cases(limit: int = Query(20, le=100)):
    return query(
        f"SELECT id,title,description,charge_type,status,created_at,updated_at "
        f"FROM cases ORDER BY created_at DESC LIMIT {limit};"
    )


@router.get("/cases/{case_id}")
def get_case(case_id: str):
    require_uuid(case_id, "case_id")
    rows = query(
        f"SELECT id,title,description,charge_type,status,created_at,updated_at "
        f"FROM cases WHERE id='{case_id}';"
    )
    if not rows:
        raise HTTPException(404, "Case not found")
    sessions = query(
        f"SELECT id,query_text,status,started_at,completed_at "
        f"FROM investigation_sessions WHERE case_id='{case_id}' ORDER BY started_at DESC;"
    )
    result = rows[0]
    result["sessions"] = sessions
    return result


@router.patch("/cases/{case_id}")
def update_case_status(case_id: str, status: str):
    require_uuid(case_id, "case_id")
    valid = {"active", "paused", "closed", "archived"}
    if status not in valid:
        raise HTTPException(400, f"Invalid status. Valid: {sorted(valid)}")
    execute(
        f"UPDATE cases SET status={esc(status)}, updated_at=NOW() WHERE id='{case_id}';"
    )
    return {"case_id": case_id, "status": status}
