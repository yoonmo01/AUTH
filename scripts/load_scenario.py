"""
scripts/load_scenario.py
시나리오 3개(강수민 HIGH, 이지수 MEDIUM, 장국주 LOW)의 파일을
PostgreSQL + Qdrant + Neo4j에 직접 적재한다.

실행:
    python scripts/load_scenario.py
"""
import json
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

import psycopg2
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http.models import PointStruct
from neo4j import GraphDatabase

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

EVIDENCE_SOURCE_ID = "5b121f32-3871-43fe-a505-3c4c2766916a"
SOURCE_LABEL = "HYENA CTF"
QDRANT_COLLECTION = "hyena_content_chunks"

# ---------------------------------------------------------------------------
# 연결
# ---------------------------------------------------------------------------

def get_pg_conn():
    return psycopg2.connect(
        host="localhost", port=55432,
        dbname=os.getenv("HYENA_POSTGRES_DB", "hyena"),
        user=os.getenv("HYENA_POSTGRES_USER", "hyena"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )

def get_qdrant():
    return QdrantClient(url=os.getenv("QDRANT_URL", "http://127.0.0.1:6333"), check_compatibility=False)

def get_neo4j():
    return GraphDatabase.driver(
        os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        auth=(os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "")),
    )

# ---------------------------------------------------------------------------
# 텍스트 추출
# ---------------------------------------------------------------------------

def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    try:
        if ext == ".xlsx":
            import openpyxl
            wb = openpyxl.load_workbook(path, data_only=True)
            lines = []
            for sheet in wb.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    line = " ".join(str(c) for c in row if c is not None)
                    if line.strip():
                        lines.append(line)
            return "\n".join(lines)
        elif ext == ".pdf":
            try:
                import pdfplumber
                with pdfplumber.open(path) as pdf:
                    return "\n".join(p.extract_text() or "" for p in pdf.pages)
            except ImportError:
                import PyPDF2
                reader = PyPDF2.PdfReader(str(path))
                return "\n".join(p.extract_text() or "" for p in reader.pages)
        elif ext == ".eml":
            import email as emaillib
            msg = emaillib.message_from_bytes(path.read_bytes())
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    return part.get_payload(decode=True).decode("utf-8", errors="replace")
            return ""
    except Exception as e:
        print(f"    [WARN] 텍스트 추출 실패 {path.name}: {e}")
        return path.stem
    return ""

# ---------------------------------------------------------------------------
# 청크 분할
# ---------------------------------------------------------------------------

def chunk_text(text: str, size: int = 1500, overlap: int = 150):
    if not text or not text.strip():
        return []
    chunks, start = [], 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return chunks

# ---------------------------------------------------------------------------
# Upstage 임베딩
# ---------------------------------------------------------------------------

def embed(text: str) -> list:
    client = OpenAI(
        api_key=os.getenv("UPSTAGE_API_KEY"),
        base_url="https://api.upstage.ai/v1/solar",
    )
    resp = client.embeddings.create(
        model=os.getenv("UPSTAGE_EMBED_MODEL", "solar-embedding-1-large-passage"),
        input=text[:8000],
    )
    return resp.data[0].embedding

# ---------------------------------------------------------------------------
# 시나리오 정의
# ---------------------------------------------------------------------------

SCENARIOS = [
    {
        "user_name": "강수민",
        "files": [
            {
                "path": ROOT / "data/HYENA CTF/구매팀_강수민(대리)/C/Users/HB_sumin/Desktop/행복의류/거래처/행복의류_거래처별_단가표_2021.xlsx",
                "relative_path": "HYENA CTF\\구매팀_강수민(대리)\\C\\Users\\HB_sumin\\Desktop\\행복의류\\거래처\\행복의류_거래처별_단가표_2021.xlsx",
                "entities": ["삼색원단나라", "HYT인터내셔날", "동방섬유", "청림직물", "코코메이드", "강수민"],
            },
            {
                "path": ROOT / "data/HYENA CTF/구매팀_강수민(대리)/C/Users/HB_sumin/Desktop/행복의류/거래처/삼색원단나라_원단_공급계약서.pdf",
                "relative_path": "HYENA CTF\\구매팀_강수민(대리)\\C\\Users\\HB_sumin\\Desktop\\행복의류\\거래처\\삼색원단나라_원단_공급계약서.pdf",
                "entities": ["삼색원단나라", "강수민", "행복의류"],
            },
        ],
        "email": {
            "relative_path": "HYENA CTF\\구매팀_강수민(대리)\\C\\Users\\HB_sumin\\Desktop\\행복의류\\거래처\\자료전달_kanatree.eml",
            "message_id": "scenario-kang-001",
            "subject": "자료 전달드립니다",
            "sender": "강수민 <researchLit0320@gmail.com>",
            "recipients_to": ["kanatreeoffitial@protonmail.com"],
            "sent_at": "2021-01-22 03:00:00+09",
            "body_text": "요청하신 자료 첨부 드립니다.",
            "metadata": {"source": "thunderbird", "attachments": ["행복의류_거래처별_단가표_2021.xlsx", "삼색원단나라_원단_공급계약서.pdf"]},
        },
        "deleted": [
            {"original_path": "C:\\Users\\HB_sumin\\Desktop\\행복의류\\거래처\\행복의류_거래처별_단가표_2021.xlsx",
             "original_filename": "행복의류_거래처별_단가표_2021.xlsx", "extension": "xlsx",
             "file_size_bytes": 9216, "deleted_at": "2021-01-22 03:15:00+09"},
            {"original_path": "C:\\Users\\HB_sumin\\Desktop\\행복의류\\거래처\\삼색원단나라_원단_공급계약서.pdf",
             "original_filename": "삼색원단나라_원단_공급계약서.pdf", "extension": "pdf",
             "file_size_bytes": 59392, "deleted_at": "2021-01-22 03:16:00+09"},
        ],
    },
    {
        "user_name": "이지수",
        "files": [
            {
                "path": ROOT / "data/HYENA CTF/구매팀_이지수(과장)/C/Users/HB/Desktop/행복의류/공급업체/공급업체_연락처_리스트.xlsx",
                "relative_path": "HYENA CTF\\구매팀_이지수(과장)\\C\\Users\\HB\\Desktop\\행복의류\\공급업체\\공급업체_연락처_리스트.xlsx",
                "entities": ["삼색원단나라", "HYT인터내셔날", "동방섬유", "청림직물", "코코메이드", "이지수"],
            },
            {
                "path": ROOT / "data/HYENA CTF/구매팀_이지수(과장)/C/Users/HB/Desktop/행복의류/공급업체/2021_구매계획서.xlsx",
                "relative_path": "HYENA CTF\\구매팀_이지수(과장)\\C\\Users\\HB\\Desktop\\행복의류\\공급업체\\2021_구매계획서.xlsx",
                "entities": ["이지수", "삼색원단나라", "HYT인터내셔날", "동방섬유", "코코메이드"],
            },
        ],
        "email": {
            "relative_path": "HYENA CTF\\구매팀_이지수(과장)\\C\\Users\\HB\\Desktop\\행복의류\\공급업체\\참고자료.eml",
            "message_id": "scenario-lee-001",
            "subject": "참고자료",
            "sender": "이지수 <researchLit0320@gmail.com>",
            "recipients_to": ["jisu.lee.personal@gmail.com"],
            "sent_at": "2021-02-10 22:30:00+09",
            "body_text": "나중에 참고할 자료 백업해둠.",
            "metadata": {"source": "thunderbird", "attachments": ["공급업체_연락처_리스트.xlsx", "2021_구매계획서.xlsx"]},
        },
        "deleted": [
            {"original_path": "C:\\Users\\HB\\Desktop\\행복의류\\공급업체\\공급업체_연락처_리스트.xlsx",
             "original_filename": "공급업체_연락처_리스트.xlsx", "extension": "xlsx",
             "file_size_bytes": 8192, "deleted_at": "2021-02-10 22:45:00+09"},
            {"original_path": "C:\\Users\\HB\\Desktop\\행복의류\\공급업체\\2021_구매계획서.xlsx",
             "original_filename": "2021_구매계획서.xlsx", "extension": "xlsx",
             "file_size_bytes": 7168, "deleted_at": "2021-02-10 22:46:00+09"},
        ],
    },
    {
        "user_name": "장국주",
        "files": [
            {
                "path": ROOT / "data/HYENA CTF/구매팀_장국주(팀장)/C/Users/장국주/Desktop/행복의류/팀자료/2021_하반기_구매전략.xlsx",
                "relative_path": "HYENA CTF\\구매팀_장국주(팀장)\\C\\Users\\장국주\\Desktop\\행복의류\\팀자료\\2021_하반기_구매전략.xlsx",
                "entities": ["장국주", "이지수", "강수민"],
            },
            {
                "path": ROOT / "data/HYENA CTF/구매팀_장국주(팀장)/C/Users/장국주/Desktop/행복의류/팀자료/팀원_업무분장.xlsx",
                "relative_path": "HYENA CTF\\구매팀_장국주(팀장)\\C\\Users\\장국주\\Desktop\\행복의류\\팀자료\\팀원_업무분장.xlsx",
                "entities": ["장국주", "이지수", "강수민", "삼색원단나라", "HYT인터내셔날", "코코메이드"],
            },
        ],
        "email": None,
        "deleted": [],
    },
]

# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def main():
    conn = get_pg_conn()
    qdrant = get_qdrant()
    neo4j_driver = get_neo4j()

    for scenario in SCENARIOS:
        user = scenario["user_name"]
        print(f"\n{'='*50}")
        print(f"[{user}] 적재 시작")

        # ── 1. 파일 적재 (PostgreSQL + Qdrant + Neo4j) ──────────────
        for finfo in scenario["files"]:
            path: Path = finfo["path"]
            rel_path: str = finfo["relative_path"]
            entities: list = finfo["entities"]

            print(f"\n  [파일] {path.name}")

            # ── PostgreSQL files 테이블 INSERT ──
            file_id = str(uuid.uuid4())
            file_size = path.stat().st_size if path.exists() else 0
            ext = path.suffix.lstrip(".")

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO files (id, evidence_source_id, relative_path, original_path, filename, extension, file_size, category)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (file_id, EVIDENCE_SOURCE_ID, rel_path, rel_path, path.name, ext, file_size, "document"))
            conn.commit()
            print(f"    PostgreSQL files → {file_id}")

            # ── 텍스트 추출 ──
            text = extract_text(path)
            if not text.strip():
                text = f"{path.stem} 파일입니다."
            print(f"    텍스트 추출: {len(text)}자")

            # ── Qdrant 벡터 적재 ──
            chunks = chunk_text(text)
            qdrant_points = []
            for i, chunk in enumerate(chunks):
                vec = embed(chunk)
                point_id = str(uuid.uuid4())
                qdrant_points.append(PointStruct(
                    id=point_id,
                    vector=vec,
                    payload={
                        "file_id": file_id,
                        "filename": path.name,
                        "relative_path": rel_path,
                        "chunk_index": i,
                        "source_label": SOURCE_LABEL,
                        "user_name": user,
                    }
                ))
            if qdrant_points:
                qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_points)
                print(f"    Qdrant → {len(qdrant_points)}개 청크 적재")

            # ── Neo4j 노드 + MENTIONS 엣지 ──
            node_id = f"file:{file_id}"
            with neo4j_driver.session() as session:
                session.run(
                    "MERGE (f:GNode {node_id: $node_id}) "
                    "SET f.node_type = 'file', f.label = $label, f.stub = false",
                    node_id=node_id, label=path.name,
                )
                for entity in entities:
                    entity_node_id = f"entity:{entity}"
                    session.run(
                        "MERGE (e:GNode {node_id: $eid}) "
                        "SET e.node_type = 'organization', e.label = $label, e.stub = false",
                        eid=entity_node_id, label=entity,
                    )
                    session.run(
                        "MATCH (f:GNode {node_id: $fid}) "
                        "MATCH (e:GNode {node_id: $eid}) "
                        "MERGE (f)-[:MENTIONS {edge_id: $edge_id}]->(e)",
                        fid=node_id, eid=entity_node_id,
                        edge_id=f"{file_id}_{entity}",
                    )
            print(f"    Neo4j → 노드 + {len(entities)}개 MENTIONS 엣지")

        # ── 2. 이메일 적재 (PostgreSQL) ─────────────────────────────
        if scenario["email"]:
            em = scenario["email"]
            print(f"\n  [이메일] {em['subject']}")

            email_file_id = str(uuid.uuid4())
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO files (id, evidence_source_id, relative_path, original_path, filename, extension, file_size, category)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (email_file_id, EVIDENCE_SOURCE_ID, em["relative_path"], em["relative_path"],
                      Path(em["relative_path"]).name, "eml", 1024, "email_store"))
                cur.execute("""
                    INSERT INTO email_messages
                        (source_file_id, message_id, subject, sender, recipients_to, sent_at, body_text, has_attachments, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (subject, sender, sent_at) DO NOTHING
                """, (
                    email_file_id, em["message_id"], em["subject"], em["sender"],
                    json.dumps(em["recipients_to"], ensure_ascii=False),
                    em["sent_at"], em["body_text"], True,
                    json.dumps(em["metadata"], ensure_ascii=False),
                ))
            conn.commit()
            print(f"    PostgreSQL email_messages → OK")

        # ── 3. 삭제 파일 적재 (PostgreSQL) ──────────────────────────
        if scenario["deleted"]:
            print(f"\n  [삭제파일] {len(scenario['deleted'])}개")
            with conn.cursor() as cur:
                for d in scenario["deleted"]:
                    cur.execute("""
                        INSERT INTO deleted_files
                            (source_label, user_name, original_path, original_filename, extension, file_size_bytes, deleted_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (SOURCE_LABEL, user, d["original_path"], d["original_filename"],
                          d["extension"], d["file_size_bytes"], d["deleted_at"]))
            conn.commit()
            print(f"    PostgreSQL deleted_files → OK")

    conn.close()
    neo4j_driver.close()
    print(f"\n{'='*50}")
    print("전체 적재 완료")


if __name__ == "__main__":
    main()
