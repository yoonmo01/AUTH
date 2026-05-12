# etl/stages/upstage_embeddings.py
# 역할: 파이프라인 12단계(옵션) — 벡터 임베딩 생성
#   content_chunks 텍스트를 Upstage solar-embedding-1-large-passage로 임베딩 후
#   Qdrant 벡터DB에 저장. embedding_refs 테이블에 참조 기록.
#   process_embeddings: True 옵션일 때만 실행.
#   환경변수: UPSTAGE_API_KEY, QDRANT_HOST, QDRANT_PORT
# 쓰는 테이블: embedding_refs
# 반환: {processed, success, failed, skipped}

import hashlib
import os
import time
from typing import Iterable

import requests
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, PointStruct, VectorParams

from etl.common import esc, psql_csv, psql_run_checked


load_dotenv()

UPSTAGE_URL = "https://api.upstage.ai/v1/solar/embeddings"
MODEL = "solar-embedding-1-large-passage"
COLLECTION = "hyena_content_chunks"
DIMENSION = 4096


def _chunks(items: list[dict], size: int) -> Iterable[list[dict]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def load_targets(options: dict) -> list[dict]:
    limit = int(options.get("embedding_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    return psql_csv(
        "SELECT cc.id AS chunk_id, cc.file_id, cc.chunk_text, f.original_path, f.relative_path, "
        "f.category::text AS category, f.extension, es.source_label "
        "FROM content_chunks cc "
        "JOIN files f ON f.id=cc.file_id "
        "JOIN evidence_sources es ON es.id=f.evidence_source_id "
        "LEFT JOIN embedding_refs er ON er.chunk_id=cc.id "
        f"AND er.embedding_model={esc(MODEL)} AND er.vector_db_collection={esc(COLLECTION)} "
        "WHERE er.id IS NULL AND btrim(cc.chunk_text) <> '' "
        "ORDER BY cc.id"
        f"{limit_sql};"
    )


def ensure_collection(client: QdrantClient) -> None:
    collections = {c.name for c in client.get_collections().collections}
    if COLLECTION not in collections:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=DIMENSION, distance=Distance.COSINE),
        )


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not os.getenv("UPSTAGE_API_KEY"):
        raise RuntimeError("UPSTAGE_API_KEY is not set")
    max_retries = int(os.getenv("UPSTAGE_EMBEDDING_MAX_RETRIES", "8"))
    response = None
    for attempt in range(max_retries + 1):
        response = requests.post(
            UPSTAGE_URL,
            headers={
                "Authorization": f"Bearer {os.getenv('UPSTAGE_API_KEY')}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"input": texts, "model": MODEL},
            timeout=120,
        )
        if response.status_code != 429:
            break
        retry_after = response.headers.get("Retry-After")
        if retry_after and retry_after.isdigit():
            delay = int(retry_after)
        else:
            delay = min(300, int(os.getenv("UPSTAGE_EMBEDDING_RETRY_SECONDS", "60")) * (attempt + 1))
        time.sleep(delay)
    assert response is not None
    if response.status_code >= 400:
        raise RuntimeError(response.text[:1000])
    payload = response.json()
    data = payload.get("data") or []
    embeddings = [row["embedding"] for row in sorted(data, key=lambda item: item.get("index", 0))]
    if len(embeddings) != len(texts):
        raise RuntimeError(f"embedding count mismatch: expected={len(texts)} actual={len(embeddings)}")
    for index, embedding in enumerate(embeddings):
        if len(embedding) != DIMENSION:
            raise RuntimeError(f"embedding dimension mismatch at index {index}: {len(embedding)}")
    return embeddings


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def _flush_refs(rows: list[dict]) -> None:
    if not rows:
        return
    values = []
    for row in rows:
        values.append(
            f"('{row['chunk_id']}','{row['file_id']}',{esc(COLLECTION)},"
            f"{esc(row['vector_id'])},{esc(MODEL)},{DIMENSION},{esc(row['content_hash'])},NOW())"
        )
    psql_run_checked(
        "INSERT INTO embedding_refs("
        "chunk_id,file_id,vector_db_collection,vector_db_id,embedding_model,vector_dimension,content_hash,embedded_at"
        ") VALUES "
        + ",".join(values)
        + " ON CONFLICT (chunk_id, embedding_model, vector_db_collection) DO NOTHING;"
    )


def run(options: dict) -> dict:
    targets = load_targets(options)
    if not targets:
        return {"processed": 0, "success": 0}
    qdrant_url = options.get("qdrant_url") or os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
    client = QdrantClient(url=qdrant_url, check_compatibility=False)
    ensure_collection(client)
    batch_size = int(options.get("embedding_batch_size") or 16)
    request_delay = float(options.get("embedding_request_delay") or os.getenv("UPSTAGE_EMBEDDING_REQUEST_DELAY", "0"))
    success = failed = 0
    total_batches = (len(targets) + batch_size - 1) // batch_size
    for batch_index, batch in enumerate(_chunks(targets, batch_size), start=1):
        try:
            if request_delay > 0:
                time.sleep(request_delay)
            print(
                f"[embedding] batch {batch_index}/{total_batches} "
                f"items={len(batch)} done={success} remaining={len(targets)-success}",
                flush=True,
            )
            vectors = embed_texts([row["chunk_text"] for row in batch])
            points = []
            refs = []
            for row, vector in zip(batch, vectors):
                vector_id = row["chunk_id"]
                points.append(
                    PointStruct(
                        id=vector_id,
                        vector=vector,
                        payload={
                            "chunk_id": row["chunk_id"],
                            "file_id": row["file_id"],
                            "source_label": row.get("source_label"),
                            "original_path": row.get("original_path"),
                            "relative_path": row.get("relative_path"),
                            "category": row.get("category"),
                            "extension": row.get("extension"),
                        },
                    )
                )
                refs.append({
                    "chunk_id": row["chunk_id"],
                    "file_id": row["file_id"],
                    "vector_id": vector_id,
                    "content_hash": _hash(row["chunk_text"]),
                })
            client.upsert(collection_name=COLLECTION, points=points)
            _flush_refs(refs)
            success += len(batch)
            print(f"[embedding] batch {batch_index}/{total_batches} ok total_done={success}", flush=True)
        except Exception:
            failed += len(batch)
            raise
    return {"processed": len(targets), "success": success, "failed": failed}


if __name__ == "__main__":
    print(run({"embedding_limit": 10}))
