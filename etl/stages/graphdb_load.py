# etl/stages/graphdb_load.py
# 역할: 파이프라인 14단계(옵션) — Neo4j 그래프DB 적재
#   v_gdb_nodes, v_gdb_edges_* 뷰에서 데이터를 읽어 Neo4j에 Cypher MERGE로 적재.
#   process_graphdb: True 옵션일 때만 실행.
#   환경변수: NEO4J_URI(기본 bolt://localhost:7687), NEO4J_USER(기본 neo4j), NEO4J_PASSWORD
# 쓰는 대상: Neo4j 컨테이너 (RDB 미기록)
# 반환: {processed, success, failed}

import os
import re
from collections import defaultdict
from typing import Iterable

from dotenv import load_dotenv
from neo4j import GraphDatabase

from etl.common import psql_csv


load_dotenv()

EDGE_VIEWS = [
    "v_gdb_edges_email",
    "v_gdb_edges_mailbox",
    "v_gdb_edges_file_rel",
    "v_gdb_edges_mentions",
    "v_gdb_edges_activity",
]


def _chunks(items: list[dict], size: int) -> Iterable[list[dict]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def _relation_type(value: str | None) -> str:
    rel = re.sub(r"[^A-Za-z0-9_]", "_", (value or "RELATED_TO").upper()).strip("_")
    if not rel:
        rel = "RELATED_TO"
    if rel[0].isdigit():
        rel = "REL_" + rel
    return rel[:80]


def _get_driver():
    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    candidates = ["hyena_pw"]
    env_pw = os.getenv("NEO4J_PASSWORD")
    if env_pw and env_pw not in candidates:
        candidates.append(env_pw)
    last_err = None
    for pw in candidates:
        try:
            driver = GraphDatabase.driver(uri, auth=(user, pw))
            driver.verify_connectivity()
            return driver
        except Exception as e:
            last_err = e
    raise RuntimeError(f"Neo4j 연결 실패: {last_err}")


def reset_graph(driver) -> None:
    with driver.session() as session:
        session.run("MATCH (n) DETACH DELETE n")


def ensure_schema(driver) -> None:
    with driver.session() as session:
        session.run(
            "CREATE CONSTRAINT gnode_node_id IF NOT EXISTS "
            "FOR (n:GNode) REQUIRE n.node_id IS UNIQUE"
        )
        session.run(
            "CREATE INDEX gnode_node_type IF NOT EXISTS "
            "FOR (n:GNode) ON (n.node_type)"
        )


def load_nodes(driver, options: dict) -> int:
    limit = int(options.get("graph_node_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    edge_union = " UNION ALL ".join(
        f"SELECT source_type, source_id, target_type, target_id FROM {view}" for view in EDGE_VIEWS
    )
    rows = psql_csv(
        "WITH edge_endpoints AS ("
        + edge_union
        + "), endpoints AS ("
        "SELECT source_id AS node_id, source_type AS node_type FROM edge_endpoints "
        "UNION SELECT target_id AS node_id, target_type AS node_type FROM edge_endpoints"
        "), base_nodes AS ("
        "SELECT node_id, node_type, label::text AS label, COALESCE(properties::text, '{}') AS properties_json, false AS stub "
        "FROM v_gdb_nodes"
        "), stub_nodes AS ("
        "SELECT e.node_id, e.node_type, e.node_id AS label, '{\"stub\":true}' AS properties_json, true AS stub "
        "FROM endpoints e WHERE e.node_id IS NOT NULL AND NOT EXISTS ("
        "SELECT 1 FROM base_nodes b WHERE b.node_id=e.node_id"
        ")"
        "), combined AS ("
        "SELECT * FROM base_nodes UNION ALL SELECT * FROM stub_nodes"
        ") "
        "SELECT DISTINCT ON (node_id) node_id, node_type, label, properties_json, stub::text AS stub "
        "FROM combined WHERE node_id IS NOT NULL ORDER BY node_id, stub"
        f"{limit_sql};"
    )
    batch_size = int(options.get("graph_batch_size") or 500)
    total = 0
    with driver.session() as session:
        for batch in _chunks(rows, batch_size):
            params = [
                {
                    "node_id": r["node_id"],
                    "node_type": r["node_type"],
                    "label": r["label"],
                    "properties_json": r["properties_json"],
                    "stub": r["stub"] == "true",
                }
                for r in batch
            ]
            session.run(
                "UNWIND $rows AS row "
                "MERGE (n:GNode {node_id: row.node_id}) "
                "SET n.node_type = row.node_type, "
                "    n.label = row.label, "
                "    n.properties_json = row.properties_json, "
                "    n.stub = row.stub",
                rows=params,
            )
            total += len(batch)
            print(f"[graphdb] nodes loaded={total}/{len(rows)}", flush=True)
    return total


def load_edges(driver, options: dict) -> int:
    limit = int(options.get("graph_edge_limit") or 0)
    limit_sql = f" LIMIT {limit}" if limit > 0 else ""
    edge_union = " UNION ALL ".join(
        "SELECT edge_id, source_id, target_id, relation_type, label, confidence::text AS confidence "
        f"FROM {view}"
        for view in EDGE_VIEWS
    )
    rows = psql_csv(
        "SELECT edge_id, source_id, target_id, relation_type, label, confidence "
        "FROM ("
        + edge_union
        + ") e WHERE edge_id IS NOT NULL AND source_id IS NOT NULL AND target_id IS NOT NULL "
        "ORDER BY edge_id"
        f"{limit_sql};"
    )
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[_relation_type(row.get("relation_type"))].append(row)

    batch_size = int(options.get("graph_batch_size") or 500)
    total = 0
    with driver.session() as session:
        for rel_type, rel_rows in grouped.items():
            for batch in _chunks(rel_rows, batch_size):
                params = [
                    {
                        "edge_id": r["edge_id"],
                        "source_id": r["source_id"],
                        "target_id": r["target_id"],
                        "label": r["label"],
                        "confidence": float(r["confidence"]) if r.get("confidence") else None,
                    }
                    for r in batch
                ]
                session.run(
                    "UNWIND $rows AS row "
                    "MATCH (s:GNode {node_id: row.source_id}) "
                    "MATCH (t:GNode {node_id: row.target_id}) "
                    f"MERGE (s)-[r:{rel_type} {{edge_id: row.edge_id}}]->(t) "
                    "SET r.label = row.label, r.confidence = row.confidence",
                    rows=params,
                )
                total += len(batch)
                print(f"[graphdb] edges loaded={total}/{len(rows)}", flush=True)
    return total


def verify(driver) -> dict:
    with driver.session() as session:
        result = session.run(
            "MATCH (n:GNode) WITH count(n) AS nodes "
            "MATCH ()-[r]->() RETURN nodes, count(r) AS relationships"
        )
        record = result.single()
        neo4j_summary = f"nodes={record['nodes']}, relationships={record['relationships']}" if record else "no data"
    rows = psql_csv(
        "SELECT 'view_nodes' AS name, count(*) FROM v_gdb_nodes "
        "UNION ALL SELECT 'edge_sum', ("
        "SELECT count(*) FROM v_gdb_edges_email) + (SELECT count(*) FROM v_gdb_edges_mailbox) + "
        "(SELECT count(*) FROM v_gdb_edges_file_rel) + (SELECT count(*) FROM v_gdb_edges_mentions) + "
        "(SELECT count(*) FROM v_gdb_edges_activity);"
    )
    return {"neo4j": neo4j_summary, "rdb": rows}


def run(options: dict) -> dict:
    driver = _get_driver()
    try:
        if options.get("reset_graphdb", False):
            reset_graph(driver)
        ensure_schema(driver)
        nodes = load_nodes(driver, options)
        edges = load_edges(driver, options)
        validation = verify(driver)
    finally:
        driver.close()
    return {
        "processed": nodes + edges,
        "success": nodes + edges,
        "failed": 0,
        "message": str(validation)[:500],
    }


if __name__ == "__main__":
    print(run({"reset_graphdb": False, "graph_node_limit": 100, "graph_edge_limit": 100}))
