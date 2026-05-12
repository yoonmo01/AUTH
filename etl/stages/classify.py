# etl/stages/classify.py
# 역할: 파이프라인 2단계 — 파일 분류
#   확장자 기준으로 files.category를 설정
#   (document/image/audio/email_store/archive/system_artifact/unknown).
#   is_system_path, is_user_content 플래그도 경로 패턴으로 판별.
# 쓰는 테이블: files (UPDATE)
# 반환: {processed, success}

from etl.common import psql_csv, psql_run_checked


def run(source_id: str | None = None) -> dict:
    source_filter = f"AND evidence_source_id='{source_id}'" if source_id else ""
    sql = f"""
    UPDATE files
    SET
      extension = lower(extension),
      category = CASE
        WHEN lower(extension) IN ('.hwp','.doc','.docx','.txt','.xls','.xlsx','.xltx','.pdf','.ppt','.pptx','.csv','.rtf') THEN 'document'::file_category
        WHEN lower(extension) IN ('.png','.jpg','.jpeg','.gif','.bmp','.tiff','.tif','.webp') THEN 'image'::file_category
        WHEN lower(extension) IN ('.m4a') THEN 'audio'::file_category
        WHEN lower(extension) IN ('.pst','.ost','.msg') THEN 'email_store'::file_category
        WHEN lower(extension) IN ('.zip','.7z','.rar','.tar','.gz') THEN 'archive'::file_category
        WHEN lower(extension) IN ('.lnk','.evtx','.pf','.db','.sqlite','.dat','.log') THEN 'system_artifact'::file_category
        ELSE 'unknown'::file_category
      END,
      is_system_path = (
        lower(relative_path) LIKE 'c\\windows\\%%'
        OR lower(relative_path) LIKE 'c\\program files\\%%'
        OR lower(relative_path) LIKE 'c\\program files (x86)\\%%'
        OR lower(relative_path) LIKE 'c\\programdata\\%%'
      ),
      is_user_content = (
        lower(relative_path) LIKE '%%\\desktop\\%%'
        OR lower(relative_path) LIKE '%%\\documents\\%%'
        OR lower(relative_path) LIKE '%%\\downloads\\%%'
        OR relative_path LIKE '%%\\바탕 화면\\%%'
        OR relative_path LIKE '%%\\문서\\%%'
        OR relative_path LIKE '%%\\다운로드\\%%'
      )
    WHERE 1=1 {source_filter};
    """
    psql_run_checked(sql)
    rows = psql_csv(
        "SELECT count(*) AS cnt FROM files WHERE 1=1 "
        f"{source_filter};"
    )
    processed = int(rows[0]["cnt"]) if rows else 0
    return {"processed": processed, "success": processed}
