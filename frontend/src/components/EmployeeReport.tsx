import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSession, fetchFindings, postExplanation } from '../api/client'
import type { Finding } from '../types'
import { classifyReport } from '../report'

type Props = {
  sessionId: string
  employeeId: string
  employeeName: string
  quarter: string
  onSubmitted: () => void
  readOnly?: boolean
  explanationText?: string
}

const VERDICT_KO: Record<string, { label: string; cls: string }> = {
  HIGH:   { label: '중점 소명 필요', cls: 'erpt__badge--high' },
  MEDIUM: { label: '주의',      cls: 'erpt__badge--med'  },
  LOW:    { label: '확인 필요', cls: 'erpt__badge--low'  },
  CLEAN:  { label: '특이사항 없음', cls: 'erpt__badge--clean'},
}

const SEVERITY_KO: Record<string, string> = {
  HIGH:   '높음',
  MEDIUM: '중간',
  LOW:    '낮음',
  INFO:   '정보',
}

function severityOrder(s: string) {
  return { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 }[s] ?? 4
}

type ReportItem = {
  id: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title: string
  description: string
  meta?: string
}

function severityFromWeight(weight: number): ReportItem['severity'] {
  if (weight >= 18) return 'HIGH'
  if (weight >= 10) return 'MEDIUM'
  if (weight > 0) return 'LOW'
  return 'INFO'
}

function findingsFromReport(reportJson: unknown): {
  verdict: string
  riskScore: number
  summary: string
  items: ReportItem[]
} | null {
  const classified = classifyReport(reportJson)

  if (classified.kind === 'clean') {
    return {
      verdict: classified.report.verdict,
      riskScore: classified.report.risk_score,
      summary: classified.report.summary,
      items: [],
    }
  }

  if (classified.kind !== 'exfiltration') return null

  const report = classified.report
  const emailItems: ReportItem[] = report.suspicious_emails.map((email) => ({
    id: email.email_id || `${email.channel_type}-${email.sent_at}-${email.recipient}`,
    severity: severityFromWeight(email.risk_weight),
    title: email.subject || `${email.recipient} 발신 메일`,
    description: email.suspicion_reason,
    meta: `${email.sender} -> ${email.recipient} / ${email.sent_at}`,
  }))

  const fileItems: ReportItem[] = report.suspicious_files.slice(0, 5).map((file) => ({
    id: file.file_id || file.relative_path,
    severity: file.sensitivity_score >= 0.9 ? 'HIGH' : 'MEDIUM',
    title: `민감 문서: ${file.filename}`,
    description: `${file.sensitivity_category} 문서로 분류되었습니다. 주요 키워드: ${file.matched_keywords.join(', ') || '없음'}`,
    meta: file.relative_path,
  }))

  return {
    verdict: report.verdict,
    riskScore: report.risk_score,
    summary: report.summary,
    items: [...emailItems, ...fileItems],
  }
}

function findingsFromTable(findings: Finding[]): ReportItem[] {
  return findings
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
    .filter((f) => f.severity === 'HIGH' || f.severity === 'MEDIUM' || f.severity === 'LOW')
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description ?? '',
      meta: f.agent_name ? `담당: ${f.agent_name}` : undefined,
    }))
}

export function EmployeeReport({
  sessionId,
  employeeId,
  employeeName,
  quarter,
  onSubmitted,
  readOnly = false,
  explanationText,
}: Props) {
  const [explanationInput, setExplanationInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
  })

  const { data: findings = [], isLoading: findingsLoading } = useQuery({
    queryKey: ['findings', sessionId],
    queryFn: () => fetchFindings(sessionId),
    enabled: !!sessionId,
  })

  async function handleSubmit() {
    if (explanationInput.trim().length < 5) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await postExplanation(sessionId, { employee_id: employeeId, text: explanationInput.trim() })
      onSubmitted()
    } catch {
      setSubmitError('제출 실패. 다시 시도해주세요.')
      setSubmitting(false)
    }
  }

  if (sessionLoading || findingsLoading) {
    return (
      <div className="erpt">
        <p className="erpt__loading">점검 보고서 불러오는 중…</p>
      </div>
    )
  }

  const reportView = findingsFromReport(session?.report_json)
  const verdict = reportView?.verdict ?? (session?.verdict as string) ?? ''
  const riskScore = reportView?.riskScore ?? session?.risk_score ?? 0
  const verdictInfo = VERDICT_KO[verdict] ?? { label: verdict || '분석 중', cls: '' }

  const displayFindings = reportView
    ? reportView.items
    : findingsFromTable([...findings])

  return (
    <div className="erpt">
      <div className="erpt__header">
        <p className="erpt__sub">{quarter} 정기 점검 결과</p>
        <h1 className="erpt__name">{employeeName}</h1>
      </div>

      <div className="erpt__verdict-row">
        <span className={`erpt__badge ${verdictInfo.cls}`}>{verdictInfo.label}</span>
        <span className="erpt__risk">위험 점수: {riskScore}점</span>
      </div>

      {reportView?.summary && <p className="erpt__summary">{reportView.summary}</p>}

      <div className="erpt__findings">
        <h2 className="erpt__findings-title">점검 항목</h2>
        {displayFindings.length === 0 ? (
          <p className="erpt__empty">특이 사항이 발견되지 않았습니다.</p>
        ) : (
          displayFindings.map((f, i) => (
            <div key={f.id} className="erpt__item">
              <span className="erpt__item-num">{i + 1}.</span>
              <p className="erpt__item-title">{f.title}</p>
              {f.description && <p className="erpt__item-desc">{f.description}</p>}
              {f.meta && <p className="erpt__item-meta">{f.meta}</p>}
              <p className="erpt__item-sev">심각도: {SEVERITY_KO[f.severity] ?? f.severity}</p>
            </div>
          ))
        )}
      </div>

      {!readOnly && (
        <div className="erpt__explain">
          <label className="erpt__explain-label">
            위 활동에 대한 소명을 입력해주세요
            <small>(예: "3번은 거래처 A사에 공유한 정기 보고서입니다")</small>
          </label>
          <textarea
            className="erpt__explain-area"
            rows={5}
            value={explanationInput}
            onChange={(e) => setExplanationInput(e.target.value)}
            placeholder="해당 활동에 대해 설명해주세요..."
          />
          {submitError && <p className="erpt__err">{submitError}</p>}
          <button
            className="erpt__submit-btn"
            disabled={explanationInput.trim().length < 5 || submitting}
            onClick={handleSubmit}
          >
            {submitting ? '제출 중...' : '제출하기'}
          </button>
        </div>
      )}

      {readOnly && explanationText && (
        <div className="erpt__explain-readonly">
          <h4 className="erpt__explain-label">직원 소명</h4>
          <p className="erpt__explain-text">{explanationText}</p>
        </div>
      )}
    </div>
  )
}
