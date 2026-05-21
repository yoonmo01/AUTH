from typing import Optional, TypedDict
from datetime import datetime, timedelta


class InvestigationState(TypedDict):
    # 초기 입력
    subject_name: str
    subject_position: str
    hire_date: str
    resignation_date: str
    analysis_start: str   # DB 실제 데이터 시작일 (외부 주입) 또는 resignation_date - 90일
    source_label: str
    session_id: str       # 진행 이벤트 큐 키 (api/progress.py)

    # 각 Sub-Agent 출력 (순서대로 채워짐)
    baseline_profile: dict
    suspicious_channels: list
    sensitive_files: list
    behavior_anomalies: dict
    cross_reference: list
    verified_findings: list
    risk_score: int
    risk_breakdown: dict
    verdict: str
    final_report: dict
    supervisor_context: dict


def make_initial_state(
    subject_name: str,
    subject_position: str,
    hire_date: str,
    resignation_date: str,
    source_label: str,
    analysis_start: Optional[str] = None,
    session_id: str = "",
) -> InvestigationState:
    if analysis_start is None:
        resign_dt = datetime.strptime(resignation_date, "%Y-%m-%d")
        analysis_start = (resign_dt - timedelta(days=90)).strftime("%Y-%m-%d")
    return InvestigationState(
        subject_name=subject_name,
        subject_position=subject_position,
        hire_date=hire_date,
        resignation_date=resignation_date,
        analysis_start=analysis_start,
        source_label=source_label,
        session_id=session_id,
        baseline_profile={},
        suspicious_channels=[],
        sensitive_files=[],
        behavior_anomalies={},
        cross_reference=[],
        verified_findings=[],
        risk_score=0,
        risk_breakdown={},
        verdict="",
        final_report={},
        supervisor_context={},
    )
