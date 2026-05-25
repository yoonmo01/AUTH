# api/findings.py
# 역할: 점검 결과(Findings) 및 증거 연결(Evidence) 라우터
#   POST /findings                           → 점검 결과 생성 (session_id, finding_type, severity 등)
#                                              반환: {id}
#   GET  /sessions/{session_id}/findings     → 세션의 결과 목록 + 각 결과의 증거 수
#                                              반환: [{id, finding_type, severity, ..., evidence_count}]
#   POST /evidence                           → 결과에 증거 파일 연결 (finding_id, evidence_source, evidence_id)
#                                              반환: {id}
#   GET  /findings/{finding_id}/evidence     → 특정 결과에 연결된 증거 목록
#                                              반환: [{id, evidence_source, evidence_id, note}]
# 쓰는 테이블: findings, finding_evidence

import uuid

from fastapi import APIRouter

from api.db import query, execute
from api.models import FindingCreate, EvidenceCreate, esc, require_uuid

router = APIRouter()


@router.post("/findings", status_code=201)
def create_finding(body: FindingCreate):
    fid = str(uuid.uuid4())
    conf = str(body.confidence) if body.confidence is not None else "NULL"
    execute(
        f"INSERT INTO findings(id,session_id,finding_type,severity,title,"
        f"description,agent_name,confidence,created_at) "
        f"VALUES('{fid}','{body.session_id}',"
        f"{esc(body.finding_type)},{esc(body.severity)},{esc(body.title)},"
        f"{esc(body.description)},{esc(body.agent_name)},{conf},NOW());"
    )
    return {"id": fid}


@router.get("/sessions/{session_id}/findings")
def list_findings(session_id: str):
    require_uuid(session_id, "session_id")
    return query(
        f"SELECT f.id,f.finding_type,f.severity,f.title,f.description,"
        f"f.agent_name,f.confidence,f.created_at,"
        f"count(fe.id) as evidence_count "
        f"FROM findings f "
        f"LEFT JOIN finding_evidence fe ON fe.finding_id=f.id "
        f"WHERE f.session_id='{session_id}' "
        f"GROUP BY f.id ORDER BY f.created_at;"
    )


@router.post("/evidence", status_code=201)
def add_evidence(body: EvidenceCreate):
    eid = str(uuid.uuid4())
    execute(
        f"INSERT INTO finding_evidence(id,finding_id,evidence_source,evidence_id,note,created_at) "
        f"VALUES('{eid}','{body.finding_id}',"
        f"{esc(body.evidence_source)},'{body.evidence_id}',"
        f"{esc(body.note)},NOW()) "
        f"ON CONFLICT DO NOTHING;"
    )
    return {"id": eid}


@router.get("/findings/{finding_id}/evidence")
def list_evidence(finding_id: str):
    require_uuid(finding_id, "finding_id")
    return query(
        f"SELECT id,evidence_source,evidence_id,note,created_at "
        f"FROM finding_evidence WHERE finding_id='{finding_id}' ORDER BY created_at;"
    )
