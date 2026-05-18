"""
agent/tools/graph_tools.py
Neo4j 그래프 쿼리 Tool 함수 모음.

- STEP 3 (민감 파일 분류): get_files_by_entity, query_graph, get_related_nodes  ← TODO (동료)
- STEP 5 (Counter-evidence): query_graph, get_related_nodes 공유 사용
"""
import json
import os

from langchain_core.tools import tool
from neo4j import GraphDatabase

# ---------------------------------------------------------------------------
# 드라이버 초기화
# ---------------------------------------------------------------------------

def get_neo4j_driver():
    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "")
    driver = GraphDatabase.driver(uri, auth=(user, password))
    driver.verify_connectivity()
    return driver


# ---------------------------------------------------------------------------
# STEP 3 / STEP 5 — Neo4j Tool 함수  (TODO: 동료 구현)
# ---------------------------------------------------------------------------

@tool
def get_files_by_entity(entity_names: str, source_label: str) -> str:
    """Neo4j에서 특정 엔티티(조직/인물)를 언급하는 파일 목록을 조회합니다.

    Args:
        entity_names: 검색할 엔티티 이름 (콤마 구분, 예: "HYT인터내셔날,가나트리")
        source_label: 데이터 소스 레이블 (예: "HYENA CTF")

    Returns:
        파일 목록 JSON 문자열 (filename, file_id, mentioned_entities)
    """
    entity_list = [e.strip() for e in entity_names.split(",")]
    driver = get_neo4j_driver()
    try:
        with driver.session() as session:
            result = session.run(
                """
                MATCH (f:GNode {node_type:'file'})-[:MENTIONS]->(e:GNode)
                WHERE e.node_type IN ['organization', 'person']
                  AND e.label IN $entity_list
                RETURN split(f.node_id, ':')[1] AS file_id,
                       collect(e.label) AS mentioned_entities
                ORDER BY size(collect(e.label)) DESC
                LIMIT 30
                """,
                entity_list=entity_list,
            )
            records = [dict(record) for record in result]
    finally:
        driver.close()
    return json.dumps(records, ensure_ascii=False, default=str)


@tool
def query_graph(cypher_query: str) -> str:
    """임의의 Cypher 쿼리를 Neo4j에서 실행하고 결과를 반환합니다.

    Args:
        cypher_query: 실행할 Cypher 쿼리 문자열

    Returns:
        쿼리 결과 JSON 문자열
    """
    # TODO: 동료 구현
    # 힌트:
    # driver = get_neo4j_driver()
    # with driver.session() as session:
    #     result = session.run(cypher_query)
    #     records = [dict(record) for record in result]
    # return json.dumps(records, ensure_ascii=False, default=str)
    raise NotImplementedError("query_graph 구현 필요 — graph_tools.py 참고")


@tool
def get_related_nodes(node_id: str, rel_types: str, depth: int = 1) -> str:
    """특정 노드와 연결된 관련 노드를 조회합니다.

    Args:
        node_id: 시작 노드의 node_id
        rel_types: 관계 유형 (콤마 구분, 예: "MENTIONS,SENT_BY")
        depth: 탐색 깊이 (기본값 1)

    Returns:
        연관 노드 목록 JSON 문자열
    """
    # TODO: 동료 구현
    # 힌트:
    # MATCH (n:GNode {node_id: $node_id})-[r*1..$depth]-(m:GNode)
    # WHERE type(r[-1]) IN $rel_types
    # RETURN m.label, m.node_type, m.node_id
    raise NotImplementedError("get_related_nodes 구현 필요 — graph_tools.py 참고")


@tool
def get_file_metadata(file_id: str) -> str:
    """files 테이블에서 특정 파일의 메타데이터를 조회합니다.

    Args:
        file_id: files 테이블의 UUID

    Returns:
        파일 메타데이터 JSON 문자열 (filename, relative_path, extension, file_size_bytes 등)
    """
    from agent.tools.rdb_tools import get_pg_conn
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, relative_path, filename, extension, file_size,
                       file_created_at, file_modified_at, category
                FROM files
                WHERE id = %s
                """,
                (file_id,),
            )
            row = cur.fetchone()
            if row is None:
                return json.dumps({})
            col_names = [desc[0] for desc in cur.description]
            return json.dumps(dict(zip(col_names, row)), ensure_ascii=False, default=str)
    finally:
        conn.close()
