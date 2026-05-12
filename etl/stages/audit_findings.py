# etl/stages/audit_findings.py
# 역할: 파이프라인 15단계(옵션) — 감사 이상 탐지
#   이메일 패턴을 분석하여 아래 3가지 유형의 의심 행위를 탐지:
#     1) anonymous_recipient: 프로톤메일/튜타노타 등 익명 서비스 발송 (high)
#     2) external_email_with_attachment: 외부 수신자에 첨부파일 발송 (medium)
#     3) bulk_external_send: 외부 수신자에 다량(5건↑) 발송 (medium)
#   process_audit_findings: True 옵션일 때만 실행.
# 쓰는 테이블: audit_findings
# 반환: {processed, success, failed}

import json
from dotenv import load_dotenv

from etl.common import esc, psql_csv, psql_run_checked

load_dotenv()

ANONYMOUS_DOMAINS = ("protonmail", "tutanota", "guerrillamail", "mailnull", "dispostable")
BULK_THRESHOLD = 5


def reset_findings() -> None:
    psql_run_checked("DELETE FROM audit_findings;")


def _jsonb(value: dict) -> str:
    return esc(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def _flush(rows: list[dict]) -> None:
    if not rows:
        return
    values = []
    for r in rows:
        values.append(
            f"('{r['evidence_source_id']}', "
            f"{esc(r.get('source_file_id'))},"
            f"{esc(r['finding_type'])}, {esc(r['severity'])}, "
            f"{esc(r.get('actor'))}, {esc(r['description'])}, "
            f"{_jsonb(r.get('evidence_detail') or {})}, NOW(), FALSE)"
        )
    psql_run_checked(
        "INSERT INTO audit_findings"
        "(evidence_source_id, source_file_id, finding_type, severity, actor, description, evidence_detail, detected_at, reviewed)"
        " VALUES " + ",\n".join(values) +
        " ON CONFLICT DO NOTHING;"
    )


def detect_anonymous_recipients(options: dict) -> list[dict]:
    domain_conditions = " OR ".join(
        f"em.recipients_to::text ILIKE '%{d}%'" for d in ANONYMOUS_DOMAINS
    )
    rows = psql_csv(
        "SELECT em.id AS email_id, em.sender, em.subject, em.sent_at, "
        "em.recipients_to::text AS recipients, em.has_attachments, "
        "f.id AS file_id, es.id AS evidence_source_id "
        "FROM email_messages em "
        "JOIN files f ON f.id = em.source_file_id "
        "JOIN evidence_sources es ON es.id = f.evidence_source_id "
        f"WHERE em.sender ILIKE '%hb.%' AND ({domain_conditions});"
    )
    results = []
    for r in rows:
        results.append({
            "evidence_source_id": r["evidence_source_id"],
            "source_file_id": r["file_id"],
            "finding_type": "anonymous_recipient",
            "severity": "high",
            "actor": r["sender"],
            "description": f"내부 사용자가 익명 이메일 서비스로 이메일을 발송했습니다: {r['subject'] or '(제목없음)'}",
            "evidence_detail": {
                "email_id": r["email_id"],
                "recipients": r["recipients"],
                "subject": r["subject"],
                "sent_at": r["sent_at"],
                "has_attachments": r["has_attachments"],
            },
        })
    return results


def detect_external_with_attachment(options: dict) -> list[dict]:
    rows = psql_csv(
        "SELECT em.id AS email_id, em.sender, em.subject, em.sent_at, "
        "em.recipients_to::text AS recipients, "
        "f.id AS file_id, es.id AS evidence_source_id "
        "FROM email_messages em "
        "JOIN files f ON f.id = em.source_file_id "
        "JOIN evidence_sources es ON es.id = f.evidence_source_id "
        "WHERE em.sender ILIKE '%hb.%' "
        "  AND em.has_attachments = TRUE "
        "  AND em.recipients_to IS NOT NULL "
        "  AND em.recipients_to != '[]'::jsonb "
        "  AND em.recipients_to::text NOT ILIKE '%hb.%' "
        "  AND em.recipients_to::text NOT ILIKE '%noreply%' "
        "  AND em.recipients_to::text NOT ILIKE '%undisclosed%';"
    )
    results = []
    for r in rows:
        results.append({
            "evidence_source_id": r["evidence_source_id"],
            "source_file_id": r["file_id"],
            "finding_type": "external_email_with_attachment",
            "severity": "medium",
            "actor": r["sender"],
            "description": f"내부 사용자가 외부 수신자에게 첨부파일을 발송했습니다: {r['subject'] or '(제목없음)'}",
            "evidence_detail": {
                "email_id": r["email_id"],
                "recipients": r["recipients"],
                "subject": r["subject"],
                "sent_at": r["sent_at"],
            },
        })
    return results


def detect_bulk_external_send(options: dict) -> list[dict]:
    rows = psql_csv(
        "SELECT em.sender, COUNT(*) AS cnt, "
        "MIN(em.sent_at)::text AS first_sent, MAX(em.sent_at)::text AS last_sent, "
        "MIN(es.id::text) AS evidence_source_id "
        "FROM email_messages em "
        "JOIN files f ON f.id = em.source_file_id "
        "JOIN evidence_sources es ON es.id = f.evidence_source_id "
        "WHERE em.sender ILIKE '%hb.%' "
        "  AND em.recipients_to IS NOT NULL "
        "  AND em.recipients_to != '[]'::jsonb "
        "  AND em.recipients_to::text NOT ILIKE '%hb.%' "
        "  AND em.recipients_to::text NOT ILIKE '%noreply%' "
        "  AND em.recipients_to::text NOT ILIKE '%undisclosed%' "
        f"GROUP BY em.sender HAVING COUNT(*) >= {BULK_THRESHOLD};"
    )
    results = []
    for r in rows:
        results.append({
            "evidence_source_id": r["evidence_source_id"],
            "source_file_id": None,
            "finding_type": "bulk_external_send",
            "severity": "medium",
            "actor": r["sender"],
            "description": f"내부 사용자가 외부 수신자에게 {r['cnt']}건의 이메일을 발송했습니다.",
            "evidence_detail": {
                "send_count": int(r["cnt"]),
                "first_sent": r["first_sent"],
                "last_sent": r["last_sent"],
            },
        })
    return results


def run(options: dict) -> dict:
    if options.get("reset_audit_findings", False):
        reset_findings()

    all_findings: list[dict] = []
    all_findings += detect_anonymous_recipients(options)
    all_findings += detect_external_with_attachment(options)
    all_findings += detect_bulk_external_send(options)

    _flush(all_findings)

    by_severity = {"high": 0, "medium": 0, "low": 0}
    for f in all_findings:
        by_severity[f["severity"]] += 1

    print(
        f"[audit_findings] total={len(all_findings)} "
        f"high={by_severity['high']} medium={by_severity['medium']}",
        flush=True,
    )
    return {
        "processed": len(all_findings),
        "success": len(all_findings),
        "failed": 0,
    }


if __name__ == "__main__":
    print(run({"reset_audit_findings": True}))
