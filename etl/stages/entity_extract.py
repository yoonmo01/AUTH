# etl/stages/entity_extract.py
# 역할: 파이프라인 13단계(옵션) — 개체명 추출
#   정규식으로 이메일/전화/날짜/금액/문서참조를 추출 (regex 경로).
#   Upstage solar-pro3 LLM으로 인물/조직/장소 등 시맨틱 엔티티 추출 (LLM 경로).
#   process_entities: True 옵션일 때만 실행.
#   환경변수: UPSTAGE_API_KEY
# 쓰는 테이블: entity_canonical, entities
# 반환: {processed, success, failed}

import asyncio
import json
import os
import re
import time
from datetime import datetime
from typing import Any, Iterable

import aiohttp
import requests
from dotenv import load_dotenv
from json_repair import repair_json

from etl.common import esc, esc_body, psql_csv, psql_run_checked


load_dotenv()

UPSTAGE_CHAT_URL = "https://api.upstage.ai/v1/chat/completions"
DEFAULT_MODEL = "solar-pro3"
SEMANTIC_TYPES = {"person", "organization", "product", "location", "other"}

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(r"(?<!\d)(?:\+?82[-.\s]?)?0(?:10|2|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)")
DATE_RE = re.compile(
    r"(?<!\d)(?:20\d{2}|19\d{2})[./-]\s?(?:0?[1-9]|1[0-2])[./-]\s?(?:0?[1-9]|[12]\d|3[01])(?!\d)"
    r"|(?<!\d)(?:20\d{2}|19\d{2})\s*년\s*(?:0?[1-9]|1[0-2])\s*월\s*(?:0?[1-9]|[12]\d|3[01])\s*일"
)
AMOUNT_RE = re.compile(
    r"(?<!\w)(?:KRW|USD|EUR|JPY|₩|\$)?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?\s?(?:원|달러|만원|억원|KRW|USD|EUR|JPY)?(?!\w)",
    re.IGNORECASE,
)
DOC_REF_RE = re.compile(r"(?<![\w.-])[\w가-힣()\[\] -]{2,80}\.(?:pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx|txt|csv|pst|m4a|jpg|jpeg|png)(?![\w.-])", re.IGNORECASE)


def _chunks(items: list[dict], size: int) -> Iterable[list[dict]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def _jsonb(value: dict[str, Any]) -> str:
    return esc(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def reset_entities() -> None:
    psql_run_checked(
        "BEGIN;"
        "DELETE FROM entities;"
        "DELETE FROM entity_canonical;"
        "DELETE FROM activity_events WHERE metadata->>'source' IN "
        "('regex-entity-extract','upstage-solar-pro3-entity-extract');"
        "COMMIT;"
    )


def _normalize(entity_type: str, value: str) -> str:
    text = re.sub(r"\s+", " ", value.replace("\x00", "")).strip()
    if entity_type == "contact":
        if "@" in text:
            return text.lower()
        digits = re.sub(r"\D", "", text)
        return digits or text
    if entity_type == "document_ref":
        return text.lower()
    if entity_type == "amount":
        return re.sub(r"\s+", "", text).upper()
    if entity_type == "date":
        compact = re.sub(r"\s+", "", text)
        for pattern, fmt in (
            (r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})", "%Y-%m-%d"),
            (r"(\d{4})년(\d{1,2})월(\d{1,2})일", "%Y-%m-%d"),
        ):
            m = re.match(pattern, compact)
            if m:
                return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return text


def _snippet(text: str, start: int, end: int, radius: int = 80) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return text[left:right].replace("\x00", "").strip()


def _regex_matches(row: dict) -> list[dict]:
    text = row.get("chunk_text") or ""
    specs = [
        ("contact", EMAIL_RE, 0.99),
        ("contact", PHONE_RE, 0.95),
        ("date", DATE_RE, 0.90),
        ("document_ref", DOC_REF_RE, 0.88),
    ]
    seen = set()
    results = []
    for entity_type, pattern, confidence in specs:
        for match in pattern.finditer(text):
            raw = match.group(0).strip()
            canonical = _normalize(entity_type, raw)
            key = (entity_type, canonical, match.start())
            if not raw or key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "file_id": row["file_id"],
                    "content_id": row["content_id"],
                    "chunk_id": row["chunk_id"],
                    "entity_type": entity_type,
                    "raw_value": raw,
                    "canonical_value": canonical,
                    "confidence": confidence,
                    "context_snippet": _snippet(text, match.start(), match.end()),
                    "char_offset": int(row.get("char_start") or 0) + match.start(),
                    "metadata": {"source": "regex-entity-extract"},
                }
            )
    return results


def _flush_entities(rows: list[dict]) -> None:
    if not rows:
        return
    canonical_values = []
    entity_values = []
    seen_canonical = set()
    seen_entities = set()
    for row in rows:
        canonical_key = (row["entity_type"], row["canonical_value"])
        if canonical_key not in seen_canonical:
            seen_canonical.add(canonical_key)
            canonical_values.append(
                "("
                f"{esc(row['entity_type'])}::entity_kind,"
                f"{esc(row['canonical_value'])},"
                f"{_jsonb([row['raw_value']])},"
                f"{_jsonb(row.get('metadata') or {})}"
                ")"
            )
        entity_key = (row["chunk_id"], row["entity_type"], row["raw_value"])
        if entity_key in seen_entities:
            continue
        seen_entities.add(entity_key)
        entity_values.append(
            "("
            f"'{row['file_id']}',"
            f"'{row['content_id']}',"
            f"'{row['chunk_id']}',"
            f"{esc(row['entity_type'])}::entity_kind,"
            f"{esc(row['raw_value'])},"
            f"{esc(row['canonical_value'])},"
            f"{float(row.get('confidence') or 0.75)},"
            f"{esc_body(row.get('context_snippet') or '')},"
            f"{int(row.get('char_offset') or 0)}"
            ")"
        )
    if not canonical_values or not entity_values:
        return
    psql_run_checked(
        "WITH canonical_input(entity_type, canonical_value, aliases, metadata) AS (VALUES "
        + ",".join(canonical_values)
        + "), upserted AS ("
        "INSERT INTO entity_canonical(entity_type, canonical_value, aliases, metadata) "
        "SELECT entity_type, canonical_value, aliases, metadata FROM canonical_input "
        "ON CONFLICT (entity_type, canonical_value) DO UPDATE SET "
        "aliases=COALESCE(entity_canonical.aliases, '[]'::jsonb) || EXCLUDED.aliases "
        "RETURNING id, entity_type, canonical_value"
        "), entity_input(file_id, content_id, chunk_id, entity_type, raw_value, canonical_value, confidence, context_snippet, char_offset) AS (VALUES "
        + ",".join(entity_values)
        + ") "
        "INSERT INTO entities(file_id, content_id, chunk_id, canonical_entity_id, entity_type, raw_value, confidence, context_snippet, char_offset) "
        "SELECT ei.file_id::uuid, ei.content_id::uuid, ei.chunk_id::uuid, u.id, ei.entity_type, ei.raw_value, "
        "ei.confidence, ei.context_snippet, ei.char_offset "
        "FROM entity_input ei "
        "JOIN upserted u ON u.entity_type=ei.entity_type AND u.canonical_value=ei.canonical_value "
        "WHERE NOT EXISTS ("
        "SELECT 1 FROM entities e WHERE e.chunk_id=ei.chunk_id::uuid "
        "AND e.entity_type=ei.entity_type AND e.raw_value=ei.raw_value"
        ");"
    )


def load_regex_targets(options: dict) -> list[dict]:
    limit = int(options.get("regex_entity_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    return psql_csv(
        "SELECT cc.id AS chunk_id, cc.content_id, cc.file_id, cc.chunk_text, cc.char_start "
        "FROM content_chunks cc "
        "WHERE btrim(cc.chunk_text) <> '' "
        "ORDER BY cc.id"
        f"{limit_sql};"
    )


def run_regex(options: dict) -> dict:
    targets = load_regex_targets(options)
    success = 0
    buffer: list[dict] = []
    for row in targets:
        matches = _regex_matches(row)
        success += len(matches)
        buffer.extend(matches)
        if len(buffer) >= 500:
            _flush_entities(buffer)
            buffer.clear()
    _flush_entities(buffer)
    return {"processed": len(targets), "success": success, "failed": 0}


def load_llm_targets(options: dict) -> list[dict]:
    limit = int(options.get("llm_entity_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    return psql_csv(
        "SELECT cc.id AS chunk_id, cc.content_id, cc.file_id, cc.chunk_text, "
        "ec.content_kind, ec.unit_type, ec.processor_name, f.original_path, f.relative_path, "
        "f.extension, f.category::text AS category, f.evidence_source_id "
        "FROM content_chunks cc "
        "JOIN extracted_contents ec ON ec.id=cc.content_id "
        "JOIN files f ON f.id=cc.file_id "
        "WHERE btrim(cc.chunk_text) <> '' AND ("
        "ec.unit_type IN ('email_body','audio_transcript') "
        "OR ec.content_kind='image_analysis' "
        "OR (ec.unit_type='document' AND f.original_path ILIKE '%\\Users\\%' AND f.original_path NOT ILIKE '%\\AppData\\%')"
        ") AND NOT ("
        "ec.unit_type='email_body' AND ec.email_message_id IN ("
        "SELECT id FROM email_messages WHERE "
        "sender ILIKE '%axios%' OR sender ILIKE '%morningbrew%' OR sender ILIKE '%uppity%' "
        "OR sender ILIKE '%newneek%' OR sender ILIKE '%farfetch%' OR sender ILIKE '%ssense%' "
        "OR sender ILIKE '%theoutnet%' OR sender ILIKE '%strictlyvc%' OR sender ILIKE '%davenetics%' "
        "OR sender ILIKE '%mkinternet%' OR sender ILIKE '%incizor%' OR sender ILIKE '%clubmonaco%' "
        "OR sender ILIKE '%godowon%' OR sender ILIKE '%googlealerts%' OR sender ILIKE '%moleg%'"
        ")"
        ") AND NOT EXISTS ("
        "SELECT 1 FROM entities e WHERE e.chunk_id=cc.id AND e.entity_type IN "
        "('person','organization','product','location','other')"
        ") AND NOT EXISTS ("
        "SELECT 1 FROM activity_events ae WHERE ae.metadata->>'source'='upstage-solar-pro3-entity-extract' "
        "AND ae.metadata->>'chunk_id'=cc.id::text"
        ") "
        "ORDER BY "
        "CASE WHEN ec.unit_type='audio_transcript' THEN 0 "
        "WHEN ec.content_kind='image_analysis' THEN 1 "
        "WHEN ec.unit_type='email_body' THEN 2 ELSE 3 END, "
        "f.id, cc.char_start"
        f"{limit_sql};"
    )


def _build_prompt(batch: list[dict]) -> list[dict]:
    items = []
    for row in batch:
        text = (row.get("chunk_text") or "")[:3500]
        items.append(
            {
                "chunk_id": row["chunk_id"],
                "source": {
                    "kind": row.get("content_kind"),
                    "unit": row.get("unit_type"),
                    "path": row.get("relative_path") or row.get("original_path"),
                },
                "text": text,
            }
        )
    system = (
        "당신은 한국 무역회사 구매팀 비리 수사를 위한 디지털 포렌식 그래프 분석 전문가입니다.\n"
        "수사 대상: 구매팀 장국주(팀장), 강수민(대리), 이지수(과장) 3명의 업무 문서, 이메일, 카카오톡, 음성 녹취록.\n"
        "수사 핵심: 불법 발주, 킥백, 업체 편의 제공, 부정 거래 관계.\n\n"
        "규칙:\n"
        "1. 반드시 JSON만 반환. 마크다운 금지.\n"
        "2. 이메일 주소, 전화번호, 날짜, 금액, 파일명은 추출하지 않는다 (별도 처리됨).\n"
        "3. 사람 이름은 반드시 풀네임으로 정규화한다. '팀장', '차주', '대리', '과장' 단독은 엔터티로 추출하지 않는다.\n"
        "4. location은 실제 지명·건물명·국가명만 허용한다. 시간 표현('오후 3시', '5시')은 절대 location이 아니다.\n"
        "5. confidence: 텍스트에 직접 명시=0.9+, 문맥 추론=0.7, 불확실=0.5 미만은 반환하지 않는다.\n"
        "6. 같은 사람의 오타·약칭 변형은 canonical을 동일하게 통일한다. 예: '강소민'→'강수민'.\n"
        "7. 'other' 타입은 사용하지 않는다.\n"
        "8. event_at은 텍스트에 날짜가 명시된 경우만 YYYY-MM-DD. 아니면 반드시 null."
    )
    user = {
        "task": "각 텍스트에서 Neo4j 수사 그래프용 의미 엔터티와 이벤트를 추출하라.",
        "schema": {
            "items": [
                {
                    "chunk_id": "input chunk_id",
                    "entities": [
                        {
                            "type": "person | organization | location | product",
                            "raw": "텍스트에 나온 표현 그대로",
                            "canonical": "정규화된 이름 (동일 인물/조직은 항상 동일한 canonical 사용)",
                            "confidence": 0.0,
                        }
                    ],
                    "events": [
                        {
                            "event_type": "동사 중심 한국어 짧은 구 (예: '발주 지시', '킥백 수수', '업체 접대')",
                            "event_at": "YYYY-MM-DD 또는 null (텍스트에 날짜 명시 시에만)",
                            "actor": "행위자 사람/조직 이름 또는 null",
                            "target": "행위 대상 상품/경로/조직 또는 null",
                            "title": "이벤트를 한 문장으로 요약",
                            "confidence": 0.0,
                        }
                    ],
                }
            ]
        },
        "entity_types": {
            "person": "실명 또는 직책+이름 조합. 직책 단독('팀장', '대리', '과장') 불가",
            "organization": "회사명, 부서명, 거래처명",
            "location": "지명, 건물명, 국가명만. 시간 표현 절대 불가",
            "product": "거래 상품명, 계약 대상, 품목명",
        },
        "investigation_context": {
            "known_persons": ["장국주 (구매팀 팀장)", "강수민 (구매팀 대리)", "이지수 (구매팀 과장)"],
            "known_companies": ["HYT 인터네셔널", "왕스덕"],
            "investigation_keywords": ["킥백", "발주", "편의 제공", "부정 거래", "불법", "수수"],
        },
        "items": items,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]


def _extract_json(text: str) -> dict:
    clean = (text or "").strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean)
        clean = re.sub(r"\s*```$", "", clean)
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        start = clean.find("{")
        end = clean.rfind("}")
        if start >= 0 and end > start:
            candidate = clean[start : end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                return json.loads(repair_json(candidate))
        return json.loads(repair_json(clean))


def call_upstage(batch: list[dict], model: str) -> dict:
    api_key = os.getenv("UPSTAGE_API_KEY")
    if not api_key:
        raise RuntimeError("UPSTAGE_API_KEY is not set")
    max_retries = int(os.getenv("UPSTAGE_ENTITY_MAX_RETRIES", "6"))
    response = None
    for attempt in range(max_retries + 1):
        response = requests.post(
            UPSTAGE_CHAT_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": _build_prompt(batch),
                "temperature": 0,
                "stream": False,
            },
            timeout=180,
        )
        if response.status_code != 429:
            break
        delay = int(response.headers.get("Retry-After") or min(300, 20 * (attempt + 1)))
        time.sleep(delay)
    assert response is not None
    if response.status_code >= 400:
        raise RuntimeError(response.text[:1000])
    content = response.json()["choices"][0]["message"]["content"]
    return _extract_json(content)


async def _call_upstage_async(
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
    batch: list[dict],
    model: str,
    api_key: str,
    batch_index: int,
    total_batches: int,
    counters: dict,
) -> None:
    max_retries = int(os.getenv("UPSTAGE_ENTITY_MAX_RETRIES", "3"))
    async with semaphore:
        for attempt in range(max_retries + 1):
            try:
                async with session.post(
                    UPSTAGE_CHAT_URL,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": _build_prompt(batch),
                        "temperature": 0,
                        "stream": False,
                    },
                    timeout=aiohttp.ClientTimeout(total=45),
                ) as resp:
                    if resp.status == 429:
                        retry_after = int(resp.headers.get("Retry-After") or min(60, 10 * (attempt + 1)))
                        await asyncio.sleep(retry_after)
                        continue
                    if resp.status >= 400:
                        raise RuntimeError(await resp.text())
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"]
                    payload = _extract_json(content)
                    batch_by_chunk = {row["chunk_id"]: row for row in batch}
                    entity_rows, event_rows = _rows_from_llm(payload, batch_by_chunk, model)
                    _flush_entities(entity_rows)
                    _flush_events(event_rows)
                    counters["success"] += len(batch)
                    print(
                        f"[entities:upstage] batch {batch_index}/{total_batches} ok"
                        f" total_done={counters['success']}",
                        flush=True,
                    )
                    return
            except Exception as exc:
                if attempt == max_retries:
                    counters["failed"] += len(batch)
                    print(
                        f"[entities:upstage][WARN] batch {batch_index}/{total_batches} failed: {str(exc)[:200]}",
                        flush=True,
                    )
                    return
                await asyncio.sleep(2 ** attempt)


def _parse_event_at(value: Any) -> str:
    if not value:
        return "NULL"
    text = str(value).strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return "NULL"
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return "NULL"
    return esc(text + "T00:00:00+09:00") + "::timestamptz"


def _flush_events(rows: list[dict]) -> None:
    if not rows:
        return
    values = []
    for row in rows:
        values.append(
            "("
            f"'{row['file_id']}',"
            f"'{row['evidence_source_id']}',"
            f"{esc(row['event_type'])},"
            f"{_parse_event_at(row.get('event_at'))},"
            f"{esc(row.get('actor'))},"
            "NULL,"
            "NULL,"
            f"{esc(row.get('target'))},"
            "NULL,"
            f"{esc(row.get('title'))},"
            "NULL,"
            f"{float(row.get('confidence') or 0.7)},"
            f"{_jsonb(row.get('metadata') or {})}"
            ")"
        )
    psql_run_checked(
        "INSERT INTO activity_events("
        "source_file_id,evidence_source_id,event_type,event_at,actor,process_name,executable_path,"
        "target_path,url,title,run_count,confidence,metadata"
        ") VALUES "
        + ",".join(values)
        + " ON CONFLICT DO NOTHING;"
    )


def _rows_from_llm(payload: dict, batch_by_chunk: dict[str, dict], model: str) -> tuple[list[dict], list[dict]]:
    entities: list[dict] = []
    events: list[dict] = []
    for item in payload.get("items") or []:
        chunk_id = str(item.get("chunk_id") or "")
        source = batch_by_chunk.get(chunk_id)
        if not source:
            continue
        text = source.get("chunk_text") or ""
        for ent in item.get("entities") or []:
            entity_type = str(ent.get("type") or "").strip().lower()
            raw = str(ent.get("raw") or "").strip()
            canonical = str(ent.get("canonical") or raw).strip()
            if entity_type not in SEMANTIC_TYPES or not raw or not canonical:
                continue
            offset = text.find(raw)
            entities.append(
                {
                    "file_id": source["file_id"],
                    "content_id": source["content_id"],
                    "chunk_id": source["chunk_id"],
                    "entity_type": entity_type,
                    "raw_value": raw,
                    "canonical_value": canonical,
                    "confidence": max(0.0, min(1.0, float(ent.get("confidence") or 0.75))),
                    "context_snippet": _snippet(text, offset, offset + len(raw)) if offset >= 0 else text[:160],
                    "char_offset": int(offset if offset >= 0 else 0),
                    "metadata": {"source": "upstage-solar-pro3-entity-extract", "model": model},
                }
            )
        for event in item.get("events") or []:
            event_type = str(event.get("event_type") or "").strip()
            title = str(event.get("title") or "").strip()
            if not event_type or not title:
                continue
            events.append(
                {
                    "file_id": source["file_id"],
                    "evidence_source_id": source["evidence_source_id"],
                    "event_type": event_type[:200],
                    "event_at": event.get("event_at"),
                    "actor": event.get("actor"),
                    "target": event.get("target"),
                    "title": title[:500],
                    "confidence": max(0.0, min(1.0, float(event.get("confidence") or 0.7))),
                    "metadata": {
                        "source": "upstage-solar-pro3-entity-extract",
                        "model": model,
                        "chunk_id": source["chunk_id"],
                        "content_id": source["content_id"],
                        "relative_path": source.get("relative_path"),
                    },
                }
            )
    return entities, events


def run_llm(options: dict) -> dict:
    model = options.get("entity_llm_model") or os.getenv("UPSTAGE_ENTITY_MODEL", DEFAULT_MODEL)
    provider = options.get("entity_llm_provider") or "upstage"
    if provider != "upstage":
        raise RuntimeError("Only Upstage entity extraction is supported in this pipeline")
    api_key = os.getenv("UPSTAGE_API_KEY")
    if not api_key:
        raise RuntimeError("UPSTAGE_API_KEY is not set")
    targets = load_llm_targets(options)
    batch_size = int(options.get("llm_entity_batch_size") or 8)
    concurrency = int(options.get("llm_entity_concurrency") or os.getenv("UPSTAGE_ENTITY_CONCURRENCY", "15"))
    batches = list(_chunks(targets, batch_size))
    total_batches = len(batches)
    counters = {"success": 0, "failed": 0}

    print(f"[entities:upstage] starting {total_batches} batches, concurrency={concurrency}", flush=True)

    async def _run_all():
        semaphore = asyncio.Semaphore(concurrency)
        connector = aiohttp.TCPConnector(limit=concurrency + 5)
        async with aiohttp.ClientSession(connector=connector) as session:
            tasks = [
                _call_upstage_async(session, semaphore, batch, model, api_key, idx + 1, total_batches, counters)
                for idx, batch in enumerate(batches)
            ]
            await asyncio.gather(*tasks)

    asyncio.run(_run_all())
    return {"processed": len(targets), "success": counters["success"], "failed": counters["failed"]}


def run(options: dict) -> dict:
    if options.get("reset_entities", False):
        reset_entities()
    regex_result = {"processed": 0, "success": 0, "failed": 0}
    if options.get("process_regex_entities", True):
        regex_result = run_regex(options)
    llm_result = {"processed": 0, "success": 0, "failed": 0}
    if options.get("process_entity_llm", True):
        llm_result = run_llm(options)
    return {
        "processed": regex_result["processed"] + llm_result["processed"],
        "success": regex_result["success"] + llm_result["success"],
        "failed": regex_result["failed"] + llm_result["failed"],
    }


if __name__ == "__main__":
    print(run({"regex_entity_limit": 100, "llm_entity_limit": 20, "llm_entity_batch_size": 5}))
