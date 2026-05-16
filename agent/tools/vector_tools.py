"""
agent/tools/vector_tools.py
Qdrant 벡터 검색 Tool 함수 모음.

- embed(): Upstage 임베딩 모델로 텍스트 임베딩 (내부 유틸)
- STEP 3 (민감 파일 분류): search_vector_db, get_chunk_by_file  ← TODO (동료)

주의: Qdrant 컬렉션(hyena_content_chunks)은 Upstage 임베딩으로 적재됨.
      반드시 ETL에서 사용한 것과 동일한 모델로 쿼리해야 함 (UPSTAGE_EMBED_MODEL).
"""
import os
from typing import Optional

from langchain_core.tools import tool
from openai import OpenAI
from qdrant_client import QdrantClient

# ---------------------------------------------------------------------------
# 클라이언트 초기화 — 모두 환경변수에서 읽음
# ---------------------------------------------------------------------------

UPSTAGE_BASE_URL = "https://api.upstage.ai/v1/solar"
COLLECTION = "hyena_content_chunks"


def _get_embed_model() -> str:
    return os.getenv("UPSTAGE_EMBED_MODEL", "solar-embedding-1-large-passage")


def get_qdrant_client() -> QdrantClient:
    url = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
    return QdrantClient(url=url, check_compatibility=False)


def embed(text: str) -> list[float]:
    """UPSTAGE_EMBED_MODEL 환경변수에 지정된 모델로 텍스트를 임베딩합니다."""
    client = OpenAI(
        api_key=os.getenv("UPSTAGE_API_KEY"),
        base_url=UPSTAGE_BASE_URL,
    )
    resp = client.embeddings.create(model=_get_embed_model(), input=text)
    return resp.data[0].embedding


# ---------------------------------------------------------------------------
# STEP 3 — 민감 파일 분류 Agent Tools  (TODO: 동료 구현)
# ---------------------------------------------------------------------------

@tool
def search_vector_db(query_text: str, top_k: int = 50, threshold: float = 0.75) -> str:
    """Qdrant에서 의미적으로 유사한 문서 청크를 검색합니다.

    Args:
        query_text: 검색 쿼리 텍스트 (예: "기밀 단가 계약 거래처 원가")
        top_k: 반환할 최대 결과 수 (기본값 50)
        threshold: 최소 유사도 점수 (기본값 0.75)

    Returns:
        유사 청크 목록 JSON 문자열 (file_id, chunk_text, score, metadata 포함)
    """
    # TODO: 동료 구현
    # 힌트:
    # client = get_qdrant_client()
    # query_vector = embed(query_text)
    # results = client.search(
    #     collection_name=COLLECTION,
    #     query_vector=query_vector,
    #     limit=top_k,
    #     score_threshold=threshold,
    # )
    # → results[i].payload 에서 file_id, chunk_text 등 추출
    raise NotImplementedError("search_vector_db 구현 필요 — vector_tools.py 참고")


@tool
def get_chunk_by_file(file_id: str) -> str:
    """특정 파일 ID에 해당하는 모든 벡터 청크를 조회합니다.

    Args:
        file_id: files 테이블의 UUID

    Returns:
        청크 목록 JSON 문자열
    """
    # TODO: 동료 구현
    # 힌트:
    # client = get_qdrant_client()
    # results = client.scroll(
    #     collection_name=COLLECTION,
    #     scroll_filter=Filter(must=[FieldCondition(key="file_id", match=MatchValue(value=file_id))]),
    #     limit=100,
    # )
    raise NotImplementedError("get_chunk_by_file 구현 필요 — vector_tools.py 참고")
