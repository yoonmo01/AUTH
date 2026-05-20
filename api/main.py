# api/main.py
# 역할: FastAPI 앱 생성 및 전체 라우터 등록. 진입점.
#   미들웨어(CORS) 설정, 각 도메인 라우터를 app에 연결하는 것만 담당.
# 실행: uvicorn api.main:app --host 0.0.0.0 --port 8000
# 등록 라우터:
#   /ingest/*   → api/ingest.py   (파이프라인 작업 제어)
#   /cases/*    → api/cases.py    (수사 사건 관리)
#   /sessions/* → api/sessions.py (수사 세션)
#   /findings/* → api/findings.py (수사 결과 및 증거)
#   /search/*   → api/search.py   (이메일/파일/콘텐츠 검색)
#   /graph/*    → api/graph.py    (그래프DB 노드/엣지 조회)
#   /summary, /files/*, /emails/*, /entities
#               → api/evidence.py (증거 데이터 조회)
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.ingest        import router as ingest_router
from api.cases         import router as cases_router
from api.sessions      import router as sessions_router
from api.findings      import router as findings_router
from api.search        import router as search_router
from api.graph         import router as graph_router
from api.evidence      import router as evidence_router
from api.agent_runner  import router as agent_runner_router

app = FastAPI(title="HYENA Investigation API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(cases_router)
app.include_router(sessions_router)
app.include_router(findings_router)
app.include_router(search_router)
app.include_router(graph_router)
app.include_router(evidence_router)
app.include_router(agent_runner_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)
