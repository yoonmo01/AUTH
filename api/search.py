# api/search.py
# 역할: 텍스트 기반 검색 라우터 (PostgreSQL GIN/trigram 인덱스 활용)
#   GET /search/emails    → 이메일 본문·제목·발신자 ILIKE 검색
#                           반환: [{id, subject, sender, sent_at, body_preview(300자), source_file}]
#   GET /search/files     → 파일명·경로 검색, category 필터 옵션
#                           반환: [{id, filename, extension, category, file_size, file_modified_at, ...}]
#   GET /search/content   → extracted_contents 전문 검색
#                           반환: [{id, file_id, content_kind, text_preview(400자), filename, category}]
# 공통 파라미터: q(필수), limit(기본 20, 최대 100)

import re
from typing import Optional

from fastapi import APIRouter, Query

from api.db import query
from api.models import require_category

router = APIRouter()

_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def _safe(q: str) -> str:
    return _CTRL_RE.sub('', q).replace("'", "''")


@router.get("/search/emails")
def search_emails(
    q: str = Query(..., description="검색어"),
    limit: int = Query(20, le=100),
):
    safe_q = _safe(q)
    return query(
        f"SELECT em.id, em.subject, em.sender, em.sent_at, "
        f"left(em.body_text, 300) as body_preview, "
        f"f.filename as source_file "
        f"FROM email_messages em "
        f"JOIN files f ON f.id = em.source_file_id "
        f"WHERE em.body_text ILIKE '%{safe_q}%' "
        f"   OR em.subject ILIKE '%{safe_q}%' "
        f"   OR em.sender ILIKE '%{safe_q}%' "
        f"ORDER BY em.sent_at DESC NULLS LAST LIMIT {limit};"
    )


@router.get("/search/files")
def search_files(
    q: str = Query(...),
    category: Optional[str] = None,
    limit: int = Query(20, le=100),
):
    require_category(category)
    safe_q = _safe(q)
    cat_filter = f"AND f.category='{category}'" if category else ""
    return query(
        f"SELECT f.id, f.filename, f.extension, f.category, "
        f"f.file_size, f.file_modified_at, f.relative_path, "
        f"es.source_label "
        f"FROM files f "
        f"JOIN evidence_sources es ON es.id = f.evidence_source_id "
        f"WHERE f.filename ILIKE '%{safe_q}%' "
        f"   OR f.relative_path ILIKE '%{safe_q}%' "
        f"{cat_filter} "
        f"ORDER BY f.file_modified_at DESC NULLS LAST LIMIT {limit};"
    )


@router.get("/search/content")
def search_content(
    q: str = Query(...),
    limit: int = Query(20, le=100),
):
    safe_q = _safe(q)
    return query(
        f"SELECT ec.id, ec.file_id, ec.content_kind, ec.unit_type, "
        f"left(ec.text_content, 400) as text_preview, "
        f"f.filename, f.category "
        f"FROM extracted_contents ec "
        f"JOIN files f ON f.id = ec.file_id "
        f"WHERE ec.text_content ILIKE '%{safe_q}%' "
        f"LIMIT {limit};"
    )
