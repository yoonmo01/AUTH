# api/ingest.py
# 역할: 증거 데이터 수집 파이프라인 제어 라우터 (prefix: /ingest)
#   POST /ingest/drive               → 파이프라인 비동기 실행 시작, job_id 반환
#                                      etl/pipeline.py를 subprocess로 기동
#   GET  /ingest/jobs                → 전체 잡 목록 (최신순)
#   GET  /ingest/jobs/{job_id}       → 잡 상태 + 각 스테이지 결과 조회
#   POST /ingest/jobs/{job_id}/cancel → 잡 취소
#   GET  /ingest/document-groups/summary → 문서 그룹(해시 중복) 통계
# 옵션 모델: IngestOptions (Pydantic) — 파이프라인 각 스테이지 ON/OFF 및 파라미터

import json
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.db import execute, query
from api.models import esc


ROOT = Path(__file__).resolve().parents[1]
router = APIRouter(prefix="/ingest", tags=["ingest"])


class IngestOptions(BaseModel):
    reset_existing_source: bool = False
    process_images: bool = False
    process_audio: bool = False
    process_embeddings: bool = False
    process_entities: bool = False
    process_graphdb: bool = False
    process_upstage: bool = False
    process_pending_documents: bool = False
    process_upstage_parse: bool = False
    reset_entities: bool = False
    reset_graphdb: bool = False
    process_regex_entities: bool = True
    process_entity_llm: bool = True
    convert_doc_hwp: bool = True
    group_by_hash: bool = True
    process_all_document_groups: bool = True
    hancom_fallback: bool = False
    reuse_existing_converted_files: bool = True
    create_missing_converted_files: bool = False
    pending_documents_limit: int = 0
    audio_limit: int = 0
    image_limit: int = 0
    embedding_limit: int = 0
    regex_entity_limit: int = 0
    llm_entity_limit: int = 0
    embedding_batch_size: int = 16
    llm_entity_batch_size: int = 4
    llm_entity_concurrency: int = 15
    graph_batch_size: int = 500
    graph_node_limit: int = 0
    graph_edge_limit: int = 0
    openai_vision_model: str = "gpt-5-mini"
    entity_llm_provider: str = "upstage"
    entity_llm_model: str = "solar-pro3"
    process_audit_findings: bool = True
    reset_audit_findings: bool = False


class IngestDriveRequest(BaseModel):
    source_label: str
    drive_root_path: str
    options: IngestOptions = Field(default_factory=IngestOptions)


def create_job(body: IngestDriveRequest) -> str:
    options_json = json.dumps(body.options.model_dump(), ensure_ascii=False)
    rows = query(
        "WITH inserted AS ("
        "INSERT INTO ingest_jobs(source_label, drive_root_path, status, options, created_at) "
        f"VALUES({esc(body.source_label)}, {esc(body.drive_root_path)}, "
        f"'queued', {esc(options_json)}::jsonb, NOW()) "
        "RETURNING id"
        ") SELECT id FROM inserted;"
    )
    if not rows:
        raise RuntimeError("failed to create ingest job")
    return rows[0]["id"]


@router.post("/drive", status_code=202)
def ingest_drive(body: IngestDriveRequest):
    job_id = create_job(body)
    options_json = json.dumps(body.options.model_dump(), ensure_ascii=False)
    log_dir = ROOT / "logs"
    log_dir.mkdir(exist_ok=True)
    stdout = log_dir / f"ingest_{job_id}.out.log"
    stderr = log_dir / f"ingest_{job_id}.err.log"
    python_exe = ROOT / ".venv" / "Scripts" / "python.exe"
    cmd = [
        str(python_exe if python_exe.exists() else sys.executable),
        "-m", "etl.pipeline",
        "--job-id", job_id,
        "--options", options_json,
    ]
    with stdout.open("w", encoding="utf-8") as out, stderr.open("w", encoding="utf-8") as err:
        subprocess.Popen(cmd, cwd=str(ROOT), stdout=out, stderr=err)
    execute(f"UPDATE ingest_jobs SET status='queued', current_stage='queued' WHERE id='{job_id}';")
    return {"job_id": job_id, "status": "queued", "stdout_log": str(stdout), "stderr_log": str(stderr)}


@router.get("/jobs")
def list_jobs(limit: int = 20):
    return query(
        "SELECT id,source_label,drive_root_path,status,current_stage,error,created_at,started_at,completed_at "
        f"FROM ingest_jobs ORDER BY created_at DESC LIMIT {limit};"
    )


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    rows = query(
        "SELECT id,source_label,drive_root_path,status,current_stage,options,error,"
        f"created_at,started_at,completed_at FROM ingest_jobs WHERE id='{job_id}';"
    )
    if not rows:
        raise HTTPException(404, "Ingest job not found")
    stages = query(
        "SELECT stage_name,status,processed_count,success_count,failed_count,skipped_count,"
        f"error,started_at,completed_at FROM ingest_stage_runs WHERE job_id='{job_id}' ORDER BY created_at;"
    )
    job = rows[0]
    job["stages"] = stages
    return job


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    execute(
        "UPDATE ingest_jobs SET status='cancelled', current_stage='cancelled', "
        f"completed_at=NOW() WHERE id='{job_id}';"
    )
    return {"job_id": job_id, "status": "cancelled"}


@router.get("/document-groups/summary")
def document_group_summary():
    return query(
        "SELECT extension, count(*) AS groups, sum(total_files) AS file_rows, "
        "count(*) FILTER (WHERE total_files=1) AS singleton_groups, "
        "count(*) FILTER (WHERE total_files>1) AS duplicate_groups, "
        "max(total_files) AS max_group_size, "
        "count(*) FILTER (WHERE priority<=30) AS high_priority_groups, "
        "count(*) FILTER (WHERE is_likely_form) AS likely_form_groups "
        "FROM document_processing_groups "
        "GROUP BY extension ORDER BY file_rows DESC;"
    )
