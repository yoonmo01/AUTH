# scripts/run_pipeline.py
# 역할: 파이프라인 실행 편의 스크립트
#   API 서버(uvicorn)가 실행 중인 상태에서 POST /ingest/drive를 호출하여
#   파이프라인을 시작하고, 10초 간격으로 상태를 폴링하여 완료까지 대기.
#   완료 후 scripts/audit_rdb_quality.py를 자동 실행.
# 사전 조건: uvicorn api.main:app --port 8000 이 실행 중이어야 함
# 실행: python scripts/run_pipeline.py --drive-root-path ".\data\HYENA CTF"
# 옵션: --host(기본 127.0.0.1), --port(기본 8000), --source-label(기본 "HYENA CTF")
import argparse, time, requests, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

OPTIONS = {
    "reset_existing_source":          False,
    "convert_doc_hwp":                True,
    "group_by_hash":                  True,
    "process_all_document_groups":    True,
    "hancom_fallback":                False,
    "reuse_existing_converted_files": True,
    "create_missing_converted_files": False,
    "process_pending_documents":      True,
    "process_audio":                  True,
    "process_images":                 True,
    "process_embeddings":             True,
    "process_entities":               True,
    "process_graphdb":                True,
    "process_audit_findings":         True,
    "process_upstage":                False,
    "process_upstage_parse":          False,
    "reset_entities":                 False,
    "reset_graphdb":                  True,
    "reset_audit_findings":           True,
    "llm_entity_batch_size":          4,
    "llm_entity_concurrency":         15,
    "embedding_batch_size":           16,
    "graph_batch_size":               500,
    "entity_llm_provider":            "upstage",
    "entity_llm_model":               "solar-pro3",
    "openai_vision_model":            "gpt-5-mini",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--source-label", default="HYENA CTF")
    parser.add_argument("--drive-root-path", required=True)
    args = parser.parse_args()

    base = f"http://{args.host}:{args.port}"

    resp = requests.post(f"{base}/ingest/drive", json={
        "source_label": args.source_label,
        "drive_root_path": args.drive_root_path,
        "options": OPTIONS,
    })
    resp.raise_for_status()
    job_id = resp.json()["job_id"]
    print(f"[run_pipeline] job_id={job_id}")

    while True:
        time.sleep(10)
        job = requests.get(f"{base}/ingest/jobs/{job_id}").json()
        status = job.get("status")
        stage  = job.get("current_stage", "-")
        print(f"[run_pipeline] status={status} stage={stage}")
        if status in ("done", "done_with_errors", "failed", "cancelled"):
            break

    print("[run_pipeline] running audit_rdb_quality...")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "audit_rdb_quality.py")], cwd=str(ROOT))
    sys.exit(0 if status == "done" else 1)

if __name__ == "__main__":
    main()
