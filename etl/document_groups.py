# etl/document_groups.py
# 역할: document_processing_groups 테이블 관리 유틸 (stage 모듈이 아님)
#   scan 이후 파일을 sha256 해시 기준으로 그룹화하는 로직.
#   etl/stages/document_groups.py가 이 모듈을 호출한다.
# 쓰는 테이블: document_processing_groups, document_processing_group_files

import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from etl.common import psql_csv, psql_run_checked


FORM_PATH_SQL = (
    "original_path ILIKE '%업무관련 서식%' "
    "OR original_path ILIKE '%\\\\Downloads\\\\업무관련%' "
    "OR original_path ILIKE '%\\\\Desktop\\\\업무\\\\업무관련%'"
)

FORM_NAME_SQL = (
    "filename ~ '^[123]\\\\.(hwp|doc|xls)$' "
    "OR filename ILIKE 'user_회사서식_%' "
    "OR filename ILIKE 'form%.hwp' "
    "OR filename ILIKE 'form%.doc'"
)


def rebuild_document_processing_groups() -> None:
    sql = f"""
    BEGIN;

    TRUNCATE document_processing_group_files;
    TRUNCATE document_processing_groups CASCADE;

    WITH grouped AS (
        SELECT
            sha256_hash,
            extension,
            count(*) AS total_files,
            bool_or({FORM_PATH_SQL} OR {FORM_NAME_SQL}) AS has_form_pattern,
            bool_and({FORM_PATH_SQL} OR {FORM_NAME_SQL}) AS all_form_pattern
        FROM files
        WHERE category='document'
          AND is_user_content=TRUE
          AND sha256_hash IS NOT NULL
          AND extension IS NOT NULL
        GROUP BY sha256_hash, extension
    ),
    reps AS (
        SELECT DISTINCT ON (f.sha256_hash, f.extension)
            f.sha256_hash,
            f.extension,
            f.id AS representative_file_id
        FROM files f
        WHERE f.category='document'
          AND f.is_user_content=TRUE
          AND f.sha256_hash IS NOT NULL
          AND f.extension IS NOT NULL
        ORDER BY
            f.sha256_hash,
            f.extension,
            CASE WHEN ({FORM_PATH_SQL} OR {FORM_NAME_SQL}) THEN 1 ELSE 0 END,
            f.file_modified_at DESC NULLS LAST,
            f.file_size DESC NULLS LAST,
            f.id
    )
    INSERT INTO document_processing_groups(
        sha256_hash, extension, representative_file_id, total_files,
        priority, is_likely_form, status, convert_status, extract_status, metadata
    )
    SELECT
        g.sha256_hash,
        g.extension,
        r.representative_file_id,
        g.total_files,
        CASE
            WHEN NOT g.has_form_pattern THEN 10
            WHEN NOT g.all_form_pattern THEN 30
            WHEN g.total_files = 1 THEN 60
            ELSE 90
        END AS priority,
        g.all_form_pattern AS is_likely_form,
        'pending',
        'pending',
        'pending',
        jsonb_build_object(
            'has_form_pattern', g.has_form_pattern,
            'all_form_pattern', g.all_form_pattern,
            'grouping', 'sha256_hash+extension'
        )
    FROM grouped g
    JOIN reps r ON r.sha256_hash=g.sha256_hash AND r.extension=g.extension;

    INSERT INTO document_processing_group_files(group_id, file_id, is_representative)
    SELECT
        g.id,
        f.id,
        f.id = g.representative_file_id
    FROM document_processing_groups g
    JOIN files f ON f.sha256_hash=g.sha256_hash AND f.extension=g.extension
    WHERE f.category='document'
      AND f.is_user_content=TRUE;

    INSERT INTO file_relations(source_file_id, target_file_id, relation_type, confidence, metadata, created_at)
    SELECT
        gf.file_id,
        g.representative_file_id,
        'duplicate',
        1.0,
        jsonb_build_object(
            'sha256_hash', g.sha256_hash,
            'document_processing_group_id', g.id,
            'reason', 'same_sha256_hash'
        ),
        NOW()
    FROM document_processing_group_files gf
    JOIN document_processing_groups g ON g.id=gf.group_id
    WHERE gf.file_id <> g.representative_file_id
    ON CONFLICT DO NOTHING;

    COMMIT;
    """
    psql_run_checked(sql)


def group_summary() -> list[dict]:
    return psql_csv(
        "SELECT extension, count(*) AS groups, sum(total_files) AS file_rows, "
        "count(*) FILTER (WHERE total_files=1) AS singleton_groups, "
        "count(*) FILTER (WHERE total_files>1) AS duplicate_groups, "
        "max(total_files) AS max_group_size, "
        "count(*) FILTER (WHERE priority<=30) AS high_priority_groups, "
        "count(*) FILTER (WHERE is_likely_form) AS likely_form_groups "
        "FROM document_processing_groups "
        "GROUP BY extension ORDER BY file_rows DESC;"
    )


def main() -> None:
    rebuild_document_processing_groups()
    print("[OK] document processing groups rebuilt")
    for row in group_summary():
        print(row)


if __name__ == "__main__":
    main()
