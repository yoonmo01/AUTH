# etl/stages/audio_stt.py
# 역할: 파이프라인 10단계(옵션) — 음성 파일 STT
#   .m4a 등 오디오 파일을 CLOVA Speech(NCloud)로 전사(STT).
#   process_audio: True 옵션일 때만 실행.
#   환경변수: NCLOUD_ACCESS_KEY, NCLOUD_SECRET_KEY, NCLOUD_INVOKE_URL
# 쓰는 테이블: audios, extracted_contents, content_chunks, files(etl_status)
# 반환: {processed, success, failed, skipped}

import json
import os
from pathlib import Path

import boto3
import requests
from botocore.config import Config
from dotenv import load_dotenv

from etl.common import esc, psql_csv, psql_run_checked
from etl.content_store import replace_file_text_content


load_dotenv()


def _truthy(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).strip().lower() == "true"


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("NCLOUD_OBJECT_STORAGE_ENDPOINT"),
        region_name=os.getenv("NCLOUD_REGION"),
        aws_access_key_id=os.getenv("NCLOUD_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("NCLOUD_SECRET_KEY"),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def _require_env() -> None:
    required = [
        "CLOVA_SPEECH_INVOKE_URL",
        "CLOVA_SPEECH_SECRET_KEY",
        "NCLOUD_ACCESS_KEY",
        "NCLOUD_SECRET_KEY",
        "NCLOUD_OBJECT_STORAGE_ENDPOINT",
        "NCLOUD_REGION",
        "NCLOUD_BUCKET_NAME",
    ]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError("missing env: " + ", ".join(missing))


def load_targets(options: dict) -> list[dict]:
    limit = int(options.get("audio_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    return psql_csv(
        "SELECT id, original_path, relative_path, filename "
        "FROM files WHERE category='audio' AND extension='.m4a' "
        "AND etl_status IN ('pending','failed') "
        "ORDER BY file_size NULLS LAST, id"
        f"{limit_sql};"
    )


def _stt_text(result: dict) -> str:
    if isinstance(result.get("text"), str):
        return result["text"]
    segments = result.get("segments")
    if isinstance(segments, list):
        texts = [str(seg.get("text") or "").strip() for seg in segments if isinstance(seg, dict)]
        return " ".join(text for text in texts if text).strip()
    nested = result.get("result")
    if isinstance(nested, dict):
        return _stt_text(nested)
    return ""


def _request_stt(data_key: str) -> dict:
    completion = os.getenv("CLOVA_COMPLETION_MODE", "sync")
    body = {
        "dataKey": data_key,
        "language": os.getenv("CLOVA_LANGUAGE", "ko-KR"),
        "completion": completion,
        "wordAlignment": True,
        "fullText": True,
    }
    if _truthy("CLOVA_ENABLE_DIARIZATION"):
        body["diarization"] = {"enable": True}
    if _truthy("CLOVA_ENABLE_EVENT_DETECTION"):
        body["sed"] = {"enable": True}
    if completion == "async":
        body["resultToObs"] = True
    response = requests.post(
        os.getenv("CLOVA_SPEECH_INVOKE_URL", "").rstrip("/") + "/recognizer/object-storage",
        headers={
            "Accept": "application/json;UTF-8",
            "Content-Type": "application/json;UTF-8",
            "X-CLOVASPEECH-API-KEY": os.getenv("CLOVA_SPEECH_SECRET_KEY", ""),
        },
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        timeout=60 * 30,
    )
    if response.status_code >= 400:
        raise RuntimeError(response.text[:1000])
    return response.json()


def run(options: dict) -> dict:
    _require_env()
    bucket = os.getenv("NCLOUD_BUCKET_NAME")
    input_prefix = os.getenv("NCLOUD_CLOVA_INPUT_PREFIX", "original-mp4").strip("/")
    output_prefix = os.getenv("NCLOUD_CLOVA_OUTPUT_PREFIX", "result-stt").strip("/")
    s3 = _s3_client()
    targets = load_targets(options)
    success = failed = skipped = 0
    for row in targets:
        file_id = row["id"]
        input_key = f"{input_prefix}/{file_id}.m4a"
        output_key = f"{output_prefix}/{file_id}.json"
        try:
            path = Path(row["original_path"])
            if not path.exists():
                raise FileNotFoundError(str(path))
            s3.put_object(Bucket=bucket, Key=input_key, Body=path.read_bytes(), ContentType="audio/mp4")
            result = _request_stt(input_key)
            s3.put_object(
                Bucket=bucket,
                Key=output_key,
                Body=json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"),
                ContentType="application/json; charset=utf-8",
            )
            text = _stt_text(result)
            if not text:
                skipped += 1
                raise RuntimeError("empty STT text")
            replace_file_text_content(
                file_id=file_id,
                text=text,
                content_kind="text",
                unit_type="audio_transcript",
                processor_name="clova-speech-object-storage",
                model_name="clova-speech",
                language=os.getenv("CLOVA_LANGUAGE", "ko-KR"),
                metadata={
                    "input_object_key": input_key,
                    "result_object_key": output_key,
                    "segments": len(result.get("segments") or []),
                    "speakers": len(result.get("speakers") or []),
                },
            )
            psql_run_checked(
                "INSERT INTO audios(file_id, stt_provider, model_name, provider_job_id, stt_language, stt_processed_at, stt_error) "
                f"VALUES('{file_id}', 'clova', 'clova-speech', {esc(output_key)}, {esc(os.getenv('CLOVA_LANGUAGE', 'ko-KR'))}, NOW(), NULL) "
                "ON CONFLICT(file_id) DO UPDATE SET "
                "stt_provider=EXCLUDED.stt_provider, model_name=EXCLUDED.model_name, provider_job_id=EXCLUDED.provider_job_id, "
                "stt_language=EXCLUDED.stt_language, stt_processed_at=EXCLUDED.stt_processed_at, stt_error=NULL;"
                "UPDATE files SET etl_status='done', etl_error=NULL, etl_processed_at=NOW() "
                f"WHERE id='{file_id}';"
            )
            success += 1
        except Exception as exc:
            failed += 1
            psql_run_checked(
                "INSERT INTO audios(file_id, stt_provider, model_name, provider_job_id, stt_language, stt_processed_at, stt_error) "
                f"VALUES('{file_id}', 'clova', 'clova-speech', {esc(output_key)}, {esc(os.getenv('CLOVA_LANGUAGE', 'ko-KR'))}, NOW(), {esc(str(exc)[:500])}) "
                "ON CONFLICT(file_id) DO UPDATE SET stt_error=EXCLUDED.stt_error, stt_processed_at=EXCLUDED.stt_processed_at;"
                "UPDATE files SET etl_status='failed', "
                f"etl_error={esc(str(exc)[:500])}, etl_processed_at=NOW() WHERE id='{file_id}';"
            )
    return {"processed": len(targets), "success": success, "failed": failed, "skipped": skipped}


if __name__ == "__main__":
    print(run({}))

