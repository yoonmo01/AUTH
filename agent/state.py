from typing import TypedDict
from datetime import datetime, timedelta


class InvestigationState(TypedDict):
    # 초기 입력
    subject_name: str
    subject_position: str
    hire_date: str
    resignation_date: str
    analysis_start: str   # resignation_date - 90일 자동 계산
    source_label: str

    # 각 Sub-Agent 출력 (순서대로 채워짐)
    baseline_profile: dict
    suspicious_channels: list
    sensitive_files: list
    behavior_anomalies: dict
    cross_reference: list
    verified_findings: list
    risk_score: int
    verdict: str
    final_report: dict


def make_initial_state(
    subject_name: str,
    subject_position: str,
    hire_date: str,
    resignation_date: str,
    source_label: str,
) -> InvestigationState:
    resign_dt = datetime.strptime(resignation_date, "%Y-%m-%d")
    analysis_start = (resign_dt - timedelta(days=90)).strftime("%Y-%m-%d")
    return InvestigationState(
        subject_name=subject_name,
        subject_position=subject_position,
        hire_date=hire_date,
        resignation_date=resignation_date,
        analysis_start=analysis_start,
        source_label=source_label,
        baseline_profile={},
        suspicious_channels=[],
        sensitive_files=[],
        behavior_anomalies={},
        cross_reference=[],
        verified_findings=[],
        risk_score=0,
        verdict="",
        final_report={},
    )
