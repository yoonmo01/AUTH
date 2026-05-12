# etl/pipeline.py
# 역할: 전체 ETL 파이프라인 오케스트레이터
#   ingest_jobs / ingest_stage_runs 테이블에 진행 상황을 기록하면서
#   아래 순서로 각 stage를 순차 실행한다:
#   scan → classify → email_pst → document_groups → document_convert →
#   document_extract → hwp_doc_variant → document_propagate →
#   (옵션) pending_documents → audio_stt → image_vision →
#   upstage_embeddings → entity_extract → graphdb_load →
#   audit_findings → audit → complete
# 진입점 두 가지:
#   1) API 경로: api/ingest.py가 subprocess로 `python -m etl.pipeline --job-id XXX` 실행
#   2) CLI 폴백: `python -m etl.pipeline --source-label "..." --drive-root-path "..."` 직접 실행
# 공개 함수:
#   run_pipeline(job_id, options) → 파이프라인 전체 실행
#   create_job(source_label, drive_root_path, options) → DB에 잡 생성 후 job_id 반환

import argparse
import json
from pathlib import Path

from etl.common import esc, psql_csv, psql_run_checked
from etl.stages import (
    audio_stt,
    audit,
    audit_findings,
    classify,
    document_convert,
    document_extract,
    document_groups,
    document_propagate,
    email_pst,
    entity_extract,
    graphdb_load,
    hwp_doc_variant,
    image_vision,
    pending_documents,
    scan,
    upstage_embeddings,
)


ROOT = Path(__file__).resolve().parents[1]


STAGES_BASE = [
    "scan",
    "classify",
    "email_pst",
    "document_groups",
    "document_convert",
    "document_extract",
    "hwp_doc_variant",
    "document_propagate",
    "pending_documents",
    "audio_stt",
    "image_vision",
    "upstage_embeddings",
    "entity_extract",
    "graphdb_load",
    "audit_findings",
    "audit",
    "complete",
]


def create_job(source_label: str, drive_root_path: str, options: dict) -> str:
    rows = psql_csv(
        "WITH inserted AS ("
        "INSERT INTO ingest_jobs(source_label, drive_root_path, status, options, created_at) "
        f"VALUES({esc(source_label)}, {esc(drive_root_path)}, 'queued', "
        f"{esc(json.dumps(options, ensure_ascii=False))}::jsonb, NOW()) "
        "RETURNING id"
        ") SELECT id FROM inserted;"
    )
    return rows[0]["id"]


def set_job(job_id: str, status: str, current_stage: str | None = None, error: str | None = None) -> None:
    started = ", started_at=COALESCE(started_at,NOW())" if status == "running" else ""
    completed = ", completed_at=NOW()" if status in {"done", "done_with_errors", "failed", "cancelled"} else ""
    psql_run_checked(
        "UPDATE ingest_jobs SET "
        f"status={esc(status)}, current_stage={esc(current_stage)}, error={esc(error)}"
        f"{started}{completed} WHERE id='{job_id}';"
    )


def set_stage(
    job_id: str,
    stage: str,
    status: str,
    processed: int = 0,
    success: int = 0,
    failed: int = 0,
    skipped: int = 0,
    error: str | None = None,
) -> None:
    started = "NOW()" if status == "running" else "NULL"
    completed = "NOW()" if status in {"done", "failed", "skipped"} else "NULL"
    psql_run_checked(
        "INSERT INTO ingest_stage_runs("
        "job_id,stage_name,status,processed_count,success_count,failed_count,skipped_count,error,started_at,completed_at"
        ") VALUES ("
        f"'{job_id}',{esc(stage)},{esc(status)},{processed},{success},{failed},{skipped},"
        f"{esc(error)},{started},{completed}) "
        "ON CONFLICT (job_id, stage_name) DO UPDATE SET "
        "status=EXCLUDED.status, "
        "processed_count=EXCLUDED.processed_count, "
        "success_count=EXCLUDED.success_count, "
        "failed_count=EXCLUDED.failed_count, "
        "skipped_count=EXCLUDED.skipped_count, "
        "error=EXCLUDED.error, "
        "started_at=COALESCE(ingest_stage_runs.started_at, EXCLUDED.started_at), "
        "completed_at=EXCLUDED.completed_at;"
    )


def count(sql: str) -> int:
    rows = psql_csv(sql)
    return int(rows[0]["cnt"]) if rows else 0


def get_job(job_id: str) -> dict:
    rows = psql_csv(
        "SELECT id, source_label, drive_root_path, options "
        f"FROM ingest_jobs WHERE id='{job_id}' LIMIT 1;"
    )
    if not rows:
        raise RuntimeError(f"ingest job not found: {job_id}")
    return rows[0]


def run_stage(job_id: str, stage_name: str, fn, *args) -> dict:
    set_job(job_id, "running", stage_name)
    set_stage(job_id, stage_name, "running")
    try:
        result = fn(*args) or {}
    except Exception as exc:
        error_msg = str(exc)[:500]
        set_stage(job_id, stage_name, "failed", error=error_msg)
        raise
    status = "done"
    if result.get("status") in {"skipped", "failed"}:
        status = result["status"]
    set_stage(
        job_id,
        stage_name,
        status,
        processed=int(result.get("processed", 0) or 0),
        success=int(result.get("success", 0) or 0),
        failed=int(result.get("failed", 0) or 0),
        skipped=int(result.get("skipped", 0) or 0),
        error=result.get("message"),
    )
    return result


def mark_deferred_stages(job_id: str, options: dict) -> None:
    if not options.get("process_pending_documents", False):
        set_stage(job_id, "pending_documents", "skipped", error="pending document pass disabled")
    if not options.get("process_images", False):
        set_stage(job_id, "image_vision", "skipped", error="OpenAI vision disabled")
    if not options.get("process_audio", False):
        set_stage(job_id, "audio_stt", "skipped", error="CLOVA STT disabled")
    if not options.get("process_embeddings", False):
        set_stage(job_id, "upstage_embeddings", "skipped", error="Upstage embedding disabled")
    if not options.get("process_entities", False):
        set_stage(job_id, "entity_extract", "skipped", error="entity extraction disabled")
    if not options.get("process_graphdb", False):
        set_stage(job_id, "graphdb_load", "skipped", error="GraphDB load disabled")
    if not options.get("process_upstage", False):
        set_stage(job_id, "upstage", "skipped", error="Upstage key not configured")
    if not options.get("process_audit_findings", False):
        set_stage(job_id, "audit_findings", "skipped", error="audit findings disabled")


def run_pipeline(job_id: str, options: dict) -> None:
    try:
        job = get_job(job_id)
        options = {**(json.loads(job.get("options") or "{}") if isinstance(job.get("options"), str) else {}), **options}
        set_job(job_id, "running", "start")
        mark_deferred_stages(job_id, options)
        scan_result = run_stage(
            job_id,
            "scan",
            scan.run,
            job["source_label"],
            job["drive_root_path"],
            options.get("reset_existing_source", False),
        )
        run_stage(job_id, "classify", classify.run, scan_result.get("source_id"))
        run_stage(job_id, "email_pst", email_pst.run, options)
        run_stage(job_id, "document_groups", document_groups.run)
        convert_result = run_stage(job_id, "document_convert", document_convert.run, options)
        extract_result = run_stage(job_id, "document_extract", document_extract.run, options)
        variant_result = run_stage(job_id, "hwp_doc_variant", hwp_doc_variant.run, options)
        propagate_result = run_stage(job_id, "document_propagate", document_propagate.run, options)
        pending_result = {"failed": 0}
        audio_result = {"failed": 0}
        image_result = {"failed": 0}
        embedding_result = {"failed": 0}
        entity_result = {"failed": 0}
        graphdb_result = {"failed": 0}
        if options.get("process_pending_documents", False):
            pending_result = run_stage(job_id, "pending_documents", pending_documents.run, options)
        if options.get("process_audio", False):
            audio_result = run_stage(job_id, "audio_stt", audio_stt.run, options)
        if options.get("process_images", False):
            image_result = run_stage(job_id, "image_vision", image_vision.run, options)
        if options.get("process_embeddings", False):
            embedding_result = run_stage(job_id, "upstage_embeddings", upstage_embeddings.run, options)
        if options.get("process_entities", False):
            entity_result = run_stage(job_id, "entity_extract", entity_extract.run, options)
        if options.get("process_graphdb", False):
            graphdb_result = run_stage(job_id, "graphdb_load", graphdb_load.run, options)
        if options.get("process_audit_findings", False):
            run_stage(job_id, "audit_findings", audit_findings.run, options)
        audit_result = run_stage(job_id, "audit", audit.run, options)
        set_stage(job_id, "complete", "done", processed=1, success=1)
        has_errors = any(
            int(result.get("failed", 0) or 0) > 0
            for result in (
                convert_result,
                extract_result,
                variant_result,
                propagate_result,
                pending_result,
                audio_result,
                image_result,
                embedding_result,
                entity_result,
                graphdb_result,
                audit_result,
            )
        )
        has_pending = int(audit_result.get("skipped", 0) or 0) > 0
        final_status = "done_with_errors" if has_errors or has_pending else "done"
        set_job(job_id, final_status, "complete", audit_result.get("message"))
    except Exception as exc:
        set_job(job_id, "failed", "failed", str(exc))
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id")
    parser.add_argument("--source-label")
    parser.add_argument("--drive-root-path")
    parser.add_argument("--options", default="{}")
    parser.add_argument("--options-file")
    args = parser.parse_args()

    if args.options_file:
        options = json.loads(Path(args.options_file).read_text(encoding="utf-8-sig"))
    else:
        options = json.loads(args.options)
    job_id = args.job_id or create_job(args.source_label or "manual", args.drive_root_path or "", options)
    run_pipeline(job_id, options)
    print(job_id)


if __name__ == "__main__":
    main()
