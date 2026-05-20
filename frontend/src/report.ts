// Pure, dependency-free modules for the verdict panel (S9).
//   - classifyReport: report_json → tagged union (EXFILTRATION / CLEAN / INVALID)
//   - selectLatestCompletedSession: pick the session to auto-open on launch
// Kept side-effect free so they can be unit tested in isolation.

import type {
  Session,
  ExfiltrationReport,
  CleanReport,
  SuspiciousEmail,
  SuspiciousFile,
  EvidenceNode,
  EvidenceEdge,
  AnalysisSummary,
  ReportSubject,
  RiskBreakdown,
  BehaviorSummary,
  DeletedFileEntry,
  OutOfHoursActivity,
  ReportTimelineEntry,
  ChannelType,
  EvidenceNodeType,
  EvidenceRelation,
} from './types'

export type ClassifiedReport =
  | { kind: 'exfiltration'; report: ExfiltrationReport }
  | { kind: 'clean'; report: CleanReport }
  | { kind: 'invalid'; reason: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function bool(v: unknown): boolean {
  return v === true
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function objOf(v: unknown): Record<string, unknown> {
  return isObject(v) ? v : {}
}

function subjectOf(v: unknown): ReportSubject {
  const o = objOf(v)
  return {
    name: str(o.name),
    position: str(o.position),
    hire_date: str(o.hire_date),
    resignation_date: str(o.resignation_date),
  }
}

function emailOf(v: unknown): SuspiciousEmail {
  const o = objOf(v)
  return {
    email_id: str(o.email_id),
    // Cast: the channel code is whatever the backend sent; unknown values
    // are tolerated and surface raw in the label map (S2).
    channel_type: str(o.channel_type) as ChannelType,
    sender: str(o.sender),
    recipient: str(o.recipient),
    subject: str(o.subject),
    sent_at: str(o.sent_at),
    has_attachment: bool(o.has_attachment),
    suspicion_reason: str(o.suspicion_reason),
    risk_weight: num(o.risk_weight),
  }
}

function riskBreakdownOf(v: unknown): RiskBreakdown {
  const o = objOf(v)
  const keys = ['cross_ref', 'deleted_files', 'anon_channel', 'anomaly', 'counter_evidence'] as const
  const out: RiskBreakdown = {}
  for (const k of keys) {
    if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = o[k] as number
  }
  return out
}

function deletedFileOf(v: unknown): DeletedFileEntry {
  const o = objOf(v)
  return {
    original_filename: str(o.original_filename),
    deleted_at: str(o.deleted_at),
    file_size_bytes: num(o.file_size_bytes),
    reason: str(o.reason),
  }
}

function outOfHoursOf(v: unknown): OutOfHoursActivity {
  const o = objOf(v)
  return {
    event_type: str(o.event_type),
    event_at: str(o.event_at),
    detail: str(o.detail),
  }
}

function behaviorSummaryOf(v: unknown): BehaviorSummary {
  const o = objOf(v)
  return {
    highlight_dates: strArray(o.highlight_dates),
    deleted_files: (Array.isArray(o.deleted_files) ? o.deleted_files : []).map(deletedFileOf),
    out_of_hours_activity: (Array.isArray(o.out_of_hours_activity) ? o.out_of_hours_activity : []).map(outOfHoursOf),
    notes: str(o.notes),
  }
}

function timelineOf(v: unknown): ReportTimelineEntry[] {
  return (Array.isArray(v) ? v : []).map((e) => {
    const o = objOf(e)
    return { date: str(o.date), events: strArray(o.events) }
  })
}

function fileOf(v: unknown): SuspiciousFile {
  const o = objOf(v)
  return {
    file_id: str(o.file_id),
    filename: str(o.filename),
    relative_path: str(o.relative_path),
    sensitivity_score: num(o.sensitivity_score),
    sensitivity_category: str(o.sensitivity_category),
    matched_keywords: strArray(o.matched_keywords),
  }
}

function evidenceNetworkOf(v: unknown): { nodes: EvidenceNode[]; edges: EvidenceEdge[] } {
  const o = objOf(v)
  const nodes: EvidenceNode[] = (Array.isArray(o.nodes) ? o.nodes : []).map((n) => {
    const x = objOf(n)
    return { id: str(x.id), type: str(x.type) as EvidenceNodeType, label: str(x.label) }
  })
  const edges: EvidenceEdge[] = (Array.isArray(o.edges) ? o.edges : []).map((e) => {
    const x = objOf(e)
    return {
      source: str(x.source),
      target: str(x.target),
      relation: str(x.relation) as EvidenceRelation,
    }
  })
  return { nodes, edges }
}

function analysisSummaryOf(v: unknown): AnalysisSummary {
  const o = objOf(v)
  return {
    emails_analyzed: num(o.emails_analyzed),
    files_analyzed: num(o.files_analyzed),
    anomalies_found: num(o.anomalies_found),
    false_positives_removed: num(o.false_positives_removed),
  }
}

const EXFIL_VERDICTS = new Set(['HIGH', 'MEDIUM', 'LOW'])

// The backend wraps the report in a `final_report` key. Unwrap it if
// present; tolerate an already-unwrapped body too (fixture/transition safety).
function unwrapFinalReport(raw: unknown): unknown {
  if (isObject(raw) && 'final_report' in raw) return raw.final_report
  return raw
}

/**
 * Classify a raw report_json value into a discriminated union the UI can
 * branch on. The `final_report` wrapper is stripped first. Anything that is
 * not a recognised report shape — null, a non-object, or an unknown
 * report_type — falls into the 'invalid' branch.
 */
export function classifyReport(raw: unknown): ClassifiedReport {
  const body = unwrapFinalReport(raw)
  if (!isObject(body)) {
    return { kind: 'invalid', reason: '리포트 데이터가 비어 있거나 객체가 아닙니다' }
  }
  const reportType = body.report_type

  if (reportType === 'CLEAN_CERTIFICATE') {
    return {
      kind: 'clean',
      report: {
        report_type: 'CLEAN_CERTIFICATE',
        verdict: 'CLEAN',
        risk_score: num(body.risk_score),
        risk_breakdown: riskBreakdownOf(body.risk_breakdown),
        subject: subjectOf(body.subject),
        summary: str(body.summary),
        analysis_summary: analysisSummaryOf(body.analysis_summary),
        issued_at: str(body.issued_at),
      },
    }
  }

  if (reportType === 'EXFILTRATION_SUSPECTED') {
    const verdict = str(body.verdict)
    return {
      kind: 'exfiltration',
      report: {
        report_type: 'EXFILTRATION_SUSPECTED',
        verdict: (EXFIL_VERDICTS.has(verdict) ? verdict : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
        risk_score: num(body.risk_score),
        risk_breakdown: riskBreakdownOf(body.risk_breakdown),
        subject: subjectOf(body.subject),
        summary: str(body.summary),
        suspicious_emails: (Array.isArray(body.suspicious_emails) ? body.suspicious_emails : []).map(emailOf),
        suspicious_files: (Array.isArray(body.suspicious_files) ? body.suspicious_files : []).map(fileOf),
        behavior_summary: behaviorSummaryOf(body.behavior_summary),
        timeline: timelineOf(body.timeline),
        evidence_network: evidenceNetworkOf(body.evidence_network),
      },
    }
  }

  return {
    kind: 'invalid',
    reason: `알 수 없는 report_type: ${JSON.stringify(reportType)}`,
  }
}

/**
 * Choose the session to auto-select when the app launches.
 * Prefers the most recently completed session; if none are completed,
 * falls back to the most recently started session; empty list → null.
 */
export function selectLatestCompletedSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null

  const completed = sessions.filter(
    (s) => s.status === 'completed' && !!s.completed_at,
  )
  if (completed.length > 0) {
    return completed.reduce((latest, s) =>
      (s.completed_at ?? '') > (latest.completed_at ?? '') ? s : latest,
    )
  }

  // Fallback: nothing completed yet — surface the newest session anyway.
  return sessions.reduce((latest, s) =>
    (s.started_at ?? '') > (latest.started_at ?? '') ? s : latest,
  )
}
