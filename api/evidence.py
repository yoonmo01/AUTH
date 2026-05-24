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

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from api.db import query
from api.models import esc, require_uuid

router = APIRouter()

_DATA_ROOT = (Path(__file__).resolve().parents[1] / "data").resolve()
_CONVERTED_ROOT = (_DATA_ROOT / "converted_documents").resolve()


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


@router.get("/timeline")
def get_timeline(limit: int = Query(200, le=500)):
    return query(
        f"SELECT id, event_type, actor, target_path, process_name, event_at "
        f"FROM activity_events ORDER BY event_at DESC LIMIT {limit};"
    )


@router.get("/files/{file_id}/raw")
def get_file_raw(file_id: str):
    require_uuid(file_id, "file_id")
    rows = query(f"SELECT relative_path FROM files WHERE id='{file_id}';")
    if not rows:
        raise HTTPException(404, "File not found")
    full_path = (_DATA_ROOT / rows[0]["relative_path"]).resolve()
    if not str(full_path).startswith(str(_DATA_ROOT)):
        raise HTTPException(403, "Access denied")
    if not full_path.is_file():
        raise HTTPException(404, "File not on disk")
    return FileResponse(str(full_path))


@router.get("/files/{file_id}/converted")
def get_file_converted(file_id: str):
    """변환된 파일 서빙: doc→docx, hwp→hwpx. converted_documents/{docx|hwpx}/{id}.ext"""
    require_uuid(file_id, "file_id")
    for subdir, ext in [("docx", ".docx"), ("hwpx", ".hwpx")]:
        candidate = (_CONVERTED_ROOT / subdir / f"{file_id}{ext}").resolve()
        if not str(candidate).startswith(str(_CONVERTED_ROOT)):
            raise HTTPException(403, "Access denied")
        if candidate.is_file():
            return FileResponse(str(candidate))
    raise HTTPException(404, "No converted file available")


@router.get("/files/{file_id}/content")
def get_file_content(file_id: str):
    require_uuid(file_id, "file_id")
    chunks = query(
        f"SELECT chunk_text FROM content_chunks "
        f"WHERE file_id='{file_id}' ORDER BY chunk_index;"
    )
    if not chunks:
        raise HTTPException(404, "No content available")
    html = "\n".join(
        f"<p>{c['chunk_text']}</p>" for c in chunks if c.get("chunk_text")
    )
    return {
        "html": html,
        "file_id": file_id,
        "filename": "",
        "content_kind": "text",
        "highlights": [],
        "total_chunks": len(chunks),
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
