# api/graph.py
# 역할: 그래프DB(Neo4j) 시각화용 노드/엣지 데이터 조회 라우터
#   GET /graph/nodes              → v_gdb_nodes 뷰 조회
#                                   반환: [{node_id, node_type, label, properties}]
#                                   node_type: user|file|entity|event|email|email_identity|external_recipient
#   GET /graph/edges/email        → v_gdb_edges_email 뷰 (이메일 발신-수신 관계)
#                                   반환: [{edge_id, source_id, target_id, relation_type, label, confidence, sent_at}]
#   GET /graph/edges/activity     → v_gdb_edges_activity 뷰 (사용자-이벤트 관계)
#                                   반환: [{edge_id, source_id, target_id, relation_type, label, confidence, event_at}]
# 공통 파라미터: limit(기본 500, 최대 2000)

from fastapi import APIRouter, Query

from api.db import query

router = APIRouter()


@router.get("/graph/nodes")
def get_graph_nodes(limit: int = Query(500, le=2000)):
    return query(
        f"SELECT node_id, node_type, label, properties "
        f"FROM v_gdb_nodes LIMIT {limit};"
    )


@router.get("/graph/edges/email")
def get_email_edges(limit: int = Query(500, le=2000)):
    return query(
        f"SELECT edge_id, source_id, target_id, relation_type, label, confidence, sent_at "
        f"FROM v_gdb_edges_email LIMIT {limit};"
    )


@router.get("/graph/edges/activity")
def get_activity_edges(limit: int = Query(500, le=2000)):
    return query(
        f"SELECT edge_id, source_id, target_id, relation_type, label, confidence, event_at "
        f"FROM v_gdb_edges_activity LIMIT {limit};"
    )
