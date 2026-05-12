# etl/stages/image_vision.py
# 역할: 파이프라인 11단계(옵션) — 이미지 설명 생성
#   .png/.jpg 등 이미지를 OpenAI GPT vision API로 설명 텍스트 생성.
#   process_images: True 옵션일 때만 실행.
#   환경변수: OPENAI_API_KEY, openai_vision_model(기본 gpt-5-mini)
# 쓰는 테이블: images, extracted_contents, content_chunks, files(etl_status)
# 반환: {processed, success, failed, skipped}

import base64
import json
import mimetypes
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image

from etl.common import esc, psql_csv, psql_run_checked
from etl.content_store import replace_file_text_content


load_dotenv()

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
PROMPT_VERSION = "image-vision-v1"


def load_targets(options: dict) -> list[dict]:
    limit = int(options.get("image_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    return psql_csv(
        "SELECT id, original_path, relative_path, extension "
        "FROM files WHERE category='image' AND etl_status IN ('pending','failed') "
        "AND replace(relative_path, chr(92), '/') LIKE '%/C/Users/%' "
        "AND replace(relative_path, chr(92), '/') NOT LIKE '%/AppData/%' "
        "ORDER BY file_size NULLS LAST, id"
        f"{limit_sql};"
    )


def _image_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _extract_json(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except Exception:
        return {"description": text, "visible_text": "", "tags": [], "investigative_relevance": "unknown"}


def _analyze(client: OpenAI, path: Path, model: str) -> dict:
    prompt = (
        "다음 이미지를 수사 증거 DB에 넣기 위해 분석한다. "
        "JSON만 반환하라. 필드: description, visible_text, people, objects, places, "
        "document_or_receipt_clues, investigative_relevance, tags. "
        "추측은 낮은 확신으로 표현하고, 보이지 않는 내용은 만들지 말라."
    )
    response = client.responses.create(
        model=model,
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": _image_data_url(path), "detail": "auto"},
            ],
        }],
    )
    return _extract_json(response.output_text)


def _process_one(row: dict, client: OpenAI, model: str) -> dict:
    file_id = row["id"]
    ext = (row.get("extension") or "").lower()
    if ext not in SUPPORTED_EXTS:
        return {"file_id": file_id, "status": "skipped", "reason": "unsupported extension"}
    path = Path(row["original_path"])
    if not path.exists():
        return {"file_id": file_id, "status": "failed", "error": f"file not found: {path}"}
    try:
        width = height = color_mode = None
        try:
            with Image.open(path) as img:
                width, height = img.size
                color_mode = img.mode
        except Exception:
            pass
        result = _analyze(client, path, model)
        description = str(result.get("description") or "")
        visible_text = str(result.get("visible_text") or "")
        content = "\n\n".join(p for p in [description, visible_text] if p.strip()).strip()
        if not content:
            raise RuntimeError("empty vision result")
        return {
            "file_id": file_id,
            "status": "ok",
            "result": result,
            "description": description,
            "content": content,
            "width": width,
            "height": height,
            "color_mode": color_mode,
            "relative_path": row.get("relative_path"),
        }
    except Exception as exc:
        return {"file_id": file_id, "status": "failed", "error": str(exc)[:500]}


def run(options: dict) -> dict:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")
    model = options.get("openai_vision_model") or os.getenv("OPENAI_VISION_MODEL", "gpt-5-mini")
    concurrency = int(options.get("image_concurrency") or os.getenv("IMAGE_VISION_CONCURRENCY", "8"))
    client = OpenAI()
    targets = load_targets(options)
    success = failed = skipped = 0

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(_process_one, row, client, model): row for row in targets}
        for i, future in enumerate(as_completed(futures), start=1):
            out = future.result()
            file_id = out["file_id"]
            status = out["status"]
            print(f"[vision] {i}/{len(targets)} {status} {file_id[:8]}", flush=True)
            if status == "skipped":
                skipped += 1
                psql_run_checked(
                    "UPDATE files SET etl_status='skipped', etl_error='unsupported OpenAI vision image extension', "
                    f"etl_processed_at=NOW() WHERE id='{file_id}';"
                )
            elif status == "ok":
                result = out["result"]
                replace_file_text_content(
                    file_id=file_id,
                    text=out["content"],
                    content_kind="image_analysis",
                    unit_type="image",
                    processor_name="openai-vision",
                    model_name=model,
                    prompt_version=PROMPT_VERSION,
                    metadata={"vision": result, "relative_path": out.get("relative_path")},
                )
                w, h, cm = out["width"], out["height"], out["color_mode"]
                psql_run_checked(
                    "INSERT INTO images(file_id,width,height,color_mode,vision_description,model_name,prompt_version,vision_tags,vision_processed_at,vision_error) "
                    f"VALUES('{file_id}', {w or 'NULL'}, {h or 'NULL'}, {esc(cm)}, {esc(out['description'])}, "
                    f"{esc(model)}, {esc(PROMPT_VERSION)}, {esc(json.dumps(result, ensure_ascii=False))}::jsonb, NOW(), NULL) "
                    "ON CONFLICT(file_id) DO UPDATE SET "
                    "width=EXCLUDED.width, height=EXCLUDED.height, color_mode=EXCLUDED.color_mode, "
                    "vision_description=EXCLUDED.vision_description, model_name=EXCLUDED.model_name, "
                    "prompt_version=EXCLUDED.prompt_version, vision_tags=EXCLUDED.vision_tags, "
                    "vision_processed_at=EXCLUDED.vision_processed_at, vision_error=NULL;"
                    "UPDATE files SET etl_status='done', etl_error=NULL, etl_processed_at=NOW() "
                    f"WHERE id='{file_id}';"
                )
                success += 1
            else:
                failed += 1
                err = out.get("error", "unknown")
                psql_run_checked(
                    "INSERT INTO images(file_id,model_name,prompt_version,vision_processed_at,vision_error) "
                    f"VALUES('{file_id}', {esc(model)}, {esc(PROMPT_VERSION)}, NOW(), {esc(err)}) "
                    "ON CONFLICT(file_id) DO UPDATE SET vision_error=EXCLUDED.vision_error, vision_processed_at=EXCLUDED.vision_processed_at;"
                    "UPDATE files SET etl_status='failed', "
                    f"etl_error={esc(err)}, etl_processed_at=NOW() WHERE id='{file_id}';"
                )
    return {"processed": len(targets), "success": success, "failed": failed, "skipped": skipped}


if __name__ == "__main__":
    print(run({}))

