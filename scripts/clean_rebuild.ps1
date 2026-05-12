# scripts/clean_rebuild.ps1
# 역할: 새 컴퓨터/재현 환경 인프라 셋업 스크립트 (DB 초기화 포함)
#   파이프라인 실행은 포함하지 않는다.
# 실행 순서:
#   1) docker compose up -d  (PostgreSQL + Neo4j 컨테이너 기동)
#   2) python scripts/init_db.py  (스키마 초기화)
# 완료 후 안내:
#   [NEXT 1] uvicorn api.main:app --host 0.0.0.0 --port 8000
#   [NEXT 2] python scripts/run_pipeline.py --drive-root-path '.\data\HYENA CTF'
# 옵션: -SkipDocker (Docker 기동 건너뜀, 이미 컨테이너가 실행 중일 때)

param([switch]$SkipDocker)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$env:HYENA_POSTGRES_CONTAINER = "hyena_clean_postgres"
$env:HYENA_POSTGRES_USER      = "hyena"
$env:HYENA_POSTGRES_DB        = "hyena"

if (-not $SkipDocker) {
    docker compose -f docker\docker-compose.yml up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
}

$Python = if (Test-Path ".venv\Scripts\python.exe") { ".venv\Scripts\python.exe" } else { "python" }

& $Python scripts\init_db.py
if ($LASTEXITCODE -ne 0) { throw "init_db failed" }

Write-Host "[OK] 인프라 준비 완료."
Write-Host "[NEXT 1] uvicorn api.main:app --host 0.0.0.0 --port 8000"
Write-Host "[NEXT 2] python scripts\run_pipeline.py --drive-root-path '.\data\HYENA CTF'"
Write-Host ""
Write-Host "[NOTE] Neo4j / Qdrant 가 필요한 경우 (그래프DB, 임베딩 스테이지):"
Write-Host "       docker compose -f docker\docker-compose.yml --profile ai up -d"
