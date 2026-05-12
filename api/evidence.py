# api/evidence.py
# 역할: 증거 원본 데이터 및 통계 조회 라우터
#   GET /summary              → 전체 데이터 규모 요약
#                               반환: {files, emails, documents, activities, entities, chunks, relations, etl_status[]}
#   GET /files/{file_id}      → 파일 상세 (evidence_sources 조인)
#                               반환: {files.* , source_label}
#   GET /emails/{email_id}    → 이메일 상세 (files·evidence_sources 조인)
#                               반환: {email_messages.*, source_file, source_label}
#   GET /entities             → 엔티티 목록 (entity_type 필터 옵션, mention_count 내림차순)
#                               반환: [{id, entity_type, canonical_value, mention_count}]

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.db import query
from api.models import esc, require_uuid

router = APIRouter()


@router.get("/summary")
def get_summary():
    files      = query("SELECT count(*) as cnt FROM files;")
    emails     = query("SELECT count(*) as cnt FROM email_messages;")
    docs       = query("SELECT count(*) as cnt FROM documents;")
    activities = query("SELECT count(*) as cnt FROM activity_events;")
    entities   = query("SELECT count(*) as cnt FROM entity_canonical;")
    chunks     = query("SELECT count(*) as cnt FROM content_chunks;")
    relations  = query("SELECT count(*) as cnt FROM file_relations;")
    etl_status = query(
        "SELECT category, etl_status, count(*) as cnt "
        "FROM files GROUP BY category, etl_status ORDER BY category, cnt DESC;"
    )
    return {
        "files":      int(files[0]["cnt"])      if files      else 0,
        "emails":     int(emails[0]["cnt"])     if emails     else 0,
        "documents":  int(docs[0]["cnt"])       if docs       else 0,
        "activities": int(activities[0]["cnt"]) if activities else 0,
        "entities":   int(entities[0]["cnt"])   if entities   else 0,
        "chunks":     int(chunks[0]["cnt"])     if chunks     else 0,
        "relations":  int(relations[0]["cnt"])  if relations  else 0,
        "etl_status": etl_status,
    }


@router.get("/files/{file_id}")
def get_file(file_id: str):
    require_uuid(file_id, "file_id")
    rows = query(
        f"SELECT f.*, es.source_label "
        f"FROM files f JOIN evidence_sources es ON es.id = f.evidence_source_id "
        f"WHERE f.id='{file_id}';"
    )
    if not rows:
        raise HTTPException(404, "File not found")
    return rows[0]


@router.get("/emails/{email_id}")
def get_email(email_id: str):
    require_uuid(email_id, "email_id")
    rows = query(
        f"SELECT em.*, f.filename as source_file, es.source_label "
        f"FROM email_messages em "
        f"JOIN files f ON f.id = em.source_file_id "
        f"JOIN evidence_sources es ON es.id = f.evidence_source_id "
        f"WHERE em.id='{email_id}';"
    )
    if not rows:
        raise HTTPException(404, "Email not found")
    return rows[0]


@router.get("/entities")
def list_entities(
    entity_type: Optional[str] = None,
    limit: int = Query(50, le=500),
):
    type_filter = f"WHERE entity_type={esc(entity_type)}" if entity_type else ""
    return query(
        f"SELECT ec.id, ec.entity_type, ec.canonical_value, "
        f"count(e.id) as mention_count "
        f"FROM entity_canonical ec "
        f"LEFT JOIN entities e ON e.canonical_entity_id = ec.id "
        f"{type_filter} "
        f"GROUP BY ec.id ORDER BY mention_count DESC LIMIT {limit};"
    )
