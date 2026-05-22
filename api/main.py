# api/main.py
# 역할: FastAPI 앱 생성 및 전체 라우터 등록. 진입점.
#   미들웨어(CORS) 설정, 각 도메인 라우터를 app에 연결하는 것만 담당.
# 실행: uvicorn api.main:app --host 0.0.0.0 --port 8000
# 등록 라우터:
#   /ingest/*   → api/ingest.py   (파이프라인 작업 제어)
#   /cases/*    → api/cases.py    (점검 케이스 관리)
#   /sessions/* → api/sessions.py (점검 세션)
#   /findings/* → api/findings.py (점검 결과 및 증거)
#   /search/*   → api/search.py   (이메일/파일/콘텐츠 검색)
#   /graph/*    → api/graph.py    (그래프DB 노드/엣지 조회)
#   /summary, /files/*, /emails/*, /entities
#               → api/evidence.py (증거 데이터 조회)
#   /auth/*     → api/auth.py     (사원/관리자 로그인)
#   /employees/*→ api/employees.py(직원 프로필 조회)
#   /audits/*   → api/audits.py   (사원 정기 점검 세션 생성)
#   /sessions/{id}/consents      → api/consents.py    (동의 전자서명 저장)
#   /sessions/{id}/explanations  → api/explanations.py(소명 제출 → admin inbox)
#   /admin/*    → api/admin.py    (관리자 inbox 조회/검토)
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
from api.auth          import router as auth_router
from api.employees     import router as employees_router
from api.audits        import router as audits_router
from api.consents      import router as consents_router
from api.explanations  import router as explanations_router
from api.admin         import router as admin_router

app = FastAPI(title="HYENA Audit API", version="1.0.0")
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
app.include_router(auth_router)
app.include_router(employees_router)
app.include_router(audits_router)
app.include_router(consents_router)
app.include_router(explanations_router)
app.include_router(admin_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)
