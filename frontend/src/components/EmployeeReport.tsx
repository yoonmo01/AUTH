import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSession, fetchFindings, postExplanation, skipExplanation } from '../api/client'
import type { Finding, SuspiciousEmail, SuspiciousFile } from '../types'
import { classifyReport } from '../report'
import {
  emailRecordFromSuspicious,
  fileRecordFromSuspicious,
  sensitivityCategoryPlain,
  whyCheckForEmail,
  whyCheckForFile,
} from '../reportLabels'
import { formatDate } from '../format'
import { FileBodyModal } from './FileBodyModal'
import { EmailBodyModal } from './EmailBodyModal'

type Props = {
  sessionId: string
  employeeId: string
  employeeName: string
  quarter: string
  onSubmitted: () => void
  readOnly?: boolean
  explanationText?: string
}

type BadgeKind = 'explain' | 'ok'

const BADGE_LABELS: Record<BadgeKind, { label: string; cls: string }> = {
  explain: { label: '소명 필요', cls: 'erpt__badge--explain' },
  ok:      { label: '확인만', cls: 'erpt__badge--ok' },
}

function badgeKindFor(verdict: string): BadgeKind {
  if (verdict === 'HIGH' || verdict === 'MEDIUM') return 'explain'
  return 'ok'
}

type ReportItem = {
  id: string
  what: string
  whyCheck: string
  detail: string
  view:
    | { kind: 'file'; data: SuspiciousFile }
    | { kind: 'email'; data: SuspiciousEmail }
    | null
}

function pathReadable(relativePath: string): string {
  if (!relativePath) return '경로 정보 없음'
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  const tail = parts.slice(-3, -1)
  if (tail.length === 0) return relativePath
  return tail.join(' > ')
}

function findingsFromReport(reportJson: unknown): {
  verdict: string
  items: ReportItem[]
} | null {
  const classified = classifyReport(reportJson)

  if (classified.kind === 'clean') {
    return { verdict: classified.report.verdict, items: [] }
  }

  if (classified.kind !== 'exfiltration') return null

  const report = classified.report

  const emailItems: ReportItem[] = report.suspicious_emails.map((email) => ({
    id: email.email_id || `${email.channel_type}-${email.sent_at}-${email.recipient}`,
    what: email.subject
      ? `'${email.subject}' 메일이 외부로 발송된 기록이 있어요`
      : `외부로 발송된 메일 기록이 있어요`,
    whyCheck: whyCheckForEmail(email),
    detail: `발송 시각: ${formatDate(email.sent_at)} · 받는 사람: ${email.recipient}`,
    view: { kind: 'email', data: email },
  }))

  const fileItems: ReportItem[] = report.suspicious_files.slice(0, 5).map((file) => ({
    id: file.file_id || file.relative_path,
    what: `${sensitivityCategoryPlain(file.sensitivity_category)} 파일이 다뤄진 기록이 있어요`,
    whyCheck: whyCheckForFile(file),
    detail: `파일 이름: ${file.filename} · 위치: ${pathReadable(file.relative_path)}`,
    view: { kind: 'file', data: file },
  }))

  return {
    verdict: report.verdict,
    items: [...emailItems, ...fileItems],
  }
}

function findingsFromTable(findings: Finding[]): ReportItem[] {
  return findings
    .filter((f) => f.severity === 'HIGH' || f.severity === 'MEDIUM' || f.severity === 'LOW')
    .map((f) => ({
      id: f.id,
      what: f.title,
      whyCheck: f.description ?? '확인이 필요한 활동으로 분류된 항목이에요',
      detail: f.agent_name ? `담당 점검: ${f.agent_name}` : '',
      view: null,
    }))
}

function requiresExplanation(verdict: string, riskScore: number): boolean {
  if (verdict === 'LOW' || verdict === 'CLEAN') return false
  return riskScore > 20
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
  const [viewingFile, setViewingFile] = useState<SuspiciousFile | null>(null)
  const [viewingEmail, setViewingEmail] = useState<SuspiciousEmail | null>(null)

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

  async function handleSkipExplanation() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await skipExplanation(sessionId, { employee_id: employeeId })
      onSubmitted()
    } catch {
      setSubmitError('확인 완료 처리에 실패했습니다. 다시 시도해주세요.')
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
  const riskScore = session?.risk_score ?? 0
  const badge = BADGE_LABELS[badgeKindFor(verdict)]
  const explanationRequired = requiresExplanation(verdict, Number(riskScore))

  const displayFindings = reportView
    ? reportView.items
    : findingsFromTable([...findings])

  return (
    <div className="erpt">
      <div className="erpt__layout">
        {/* ── 왼쪽: 헤더 + 안내 + 발견 항목 ── */}
        <div className="erpt__main">
          <div className="erpt__header">
            <p className="erpt__sub">{quarter} 정기 점검 결과</p>
            <h1 className="erpt__name">{employeeName}</h1>
          </div>

          <div className="erpt__verdict-row">
            <span className={`erpt__badge ${badge.cls}`}>{badge.label}</span>
          </div>

          <p className="erpt__guide">
            정기 점검에서 자동 확인된 활동 목록입니다.
            각 항목은 <strong>확인이 필요한</strong> 활동이며, '내용 보기'로 직접 자료를 열람할 수 있습니다.
          </p>

          <div className="erpt__findings">
            <h2 className="erpt__findings-title">확인이 필요한 항목</h2>
            {displayFindings.length === 0 ? (
              <p className="erpt__empty">특이 사항이 발견되지 않았습니다.</p>
            ) : (
              displayFindings.map((f, i) => (
                <div key={f.id} className="erpt__item">
                  <p className="erpt__item-title">
                    <span className="erpt__item-num">{i + 1}.</span>
                    {f.what}
                  </p>

                  <ul className="erpt__item-facts">
                    {f.detail && <li>{f.detail}</li>}
                    <li>{f.whyCheck}</li>
                  </ul>

                  {f.view?.kind === 'file' && (
                    <div className="erpt__item-actions">
                      <button
                        type="button"
                        className="erpt__view-btn"
                        onClick={() => setViewingFile(f.view!.data as SuspiciousFile)}
                      >
                        파일 내용 보기
                      </button>
                    </div>
                  )}
                  {f.view?.kind === 'email' && (
                    <div className="erpt__item-actions">
                      <button
                        type="button"
                        className="erpt__view-btn"
                        onClick={() => setViewingEmail(f.view!.data as SuspiciousEmail)}
                      >
                        메일 내용 보기
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── 오른쪽: 소명 패널 (sticky) ── */}
        <aside className="erpt__side">
          <header className="erpt__side-hdr">
            <h2 className="erpt__side-title">점검 제출</h2>
          </header>
          {!readOnly && explanationRequired && (
            <div className="erpt__explain">
              <p className="erpt__explain-title">소명 작성</p>
              <p className="erpt__explain-desc">
                위 항목 중 해당되는 내용에 대해 업무상 사정이나 이유를 작성해주세요.
                항목 번호를 함께 적어주시면 검토에 도움이 됩니다.
              </p>
              <textarea
                className="erpt__explain-area"
                rows={8}
                value={explanationInput}
                onChange={(e) => setExplanationInput(e.target.value)}
                placeholder="예) 1번은 거래처 A사와 정기적으로 공유하는 보고서입니다. 2번은 …"
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

          {!readOnly && !explanationRequired && (
            <div className="erpt__explain erpt__explain--skip">
              <p className="erpt__explain-desc">
                확인이 필요한 추가 항목이 없습니다. 아래 버튼을 눌러 점검을 마무리해주세요.
              </p>
              {submitError && <p className="erpt__err">{submitError}</p>}
              <button
                className="erpt__submit-btn"
                disabled={submitting}
                onClick={handleSkipExplanation}
              >
                {submitting ? '처리 중...' : '확인 완료'}
              </button>
            </div>
          )}

          {readOnly && explanationText && (
            <div className="erpt__explain">
              <p className="erpt__explain-title">직원 소명</p>
              <p className="erpt__explain-text">{explanationText}</p>
            </div>
          )}
        </aside>
      </div>

      {viewingFile && (
        <FileBodyModal
          file={fileRecordFromSuspicious(viewingFile)}
          highlightKeywords={viewingFile.matched_keywords}
          onClose={() => setViewingFile(null)}
        />
      )}

      {viewingEmail && (
        <EmailBodyModal
          email={emailRecordFromSuspicious(viewingEmail)}
          suspicionReason={viewingEmail.suspicion_reason}
          onClose={() => setViewingEmail(null)}
        />
      )}
    </div>
  )
}
