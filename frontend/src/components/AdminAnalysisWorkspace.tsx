import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSession, type InboxEntry } from '../api/client'
import { classifyReport } from '../report'
import {
  channelLabel,
  channelPlain,
  emailRecordFromSuspicious,
  fileRecordFromSuspicious,
  sensitivityCategoryPlain,
} from '../reportLabels'
import { formatDate } from '../format'
import { ContentViewer } from './ContentViewer'
import { FileBodyModal } from './FileBodyModal'
import { EmailBodyModal } from './EmailBodyModal'
import type {
  ExfiltrationReport,
  Session,
  SuspiciousEmail,
  SuspiciousFile,
} from '../types'

type Props = {
  sessionId: string
  entry: InboxEntry
}

function riskTone(weight: number): { mark: string; cls: string } {
  if (weight >= 30) return { mark: '🔴', cls: 'adetail-analysis__pill--high' }
  if (weight >= 15) return { mark: '🟡', cls: 'adetail-analysis__pill--med' }
  return { mark: '', cls: '' }
}

function ExplanationPanel({ text }: { text: string | null }) {
  const trimmed = text?.trim()

  return (
    <section className="adetail-analysis__panel adetail-analysis__explain" aria-label="직원 소명">
      <header className="adetail-analysis__head">
        <h2 className="adetail-analysis__title">직원 소명</h2>
      </header>
      <div className="adetail-analysis__explain-body">
        {trimmed ? (
          <p className="adetail-analysis__explain-text">{trimmed}</p>
        ) : (
          <p className="adetail-analysis__state">제출된 직원 소명이 없습니다.</p>
        )}
      </div>
    </section>
  )
}

function extractKeyChecks(report: ExfiltrationReport): string[] {
  const checks: string[] = []

  const topEmail = [...report.suspicious_emails].sort((a, b) => b.risk_weight - a.risk_weight)[0]
  if (topEmail) {
    checks.push(
      `외부 메일(${channelPlain(topEmail.channel_type)})로 발송된 메일 ${report.suspicious_emails.length}건`,
    )
  }

  const outOfHours = report.behavior_summary.out_of_hours_activity?.length ?? 0
  if (outOfHours > 0) checks.push(`업무 외 시간에 발생한 활동 ${outOfHours}건`)

  const deleted = report.behavior_summary.deleted_files?.length ?? 0
  if (deleted > 0) checks.push(`퇴사 직전 삭제된 파일 ${deleted}건`)

  if (checks.length < 3) {
    const topFile = [...report.suspicious_files].sort(
      (a, b) => b.sensitivity_score - a.sensitivity_score,
    )[0]
    if (topFile) {
      checks.push(`${sensitivityCategoryPlain(topFile.sensitivity_category)} 파일 (예: ${topFile.filename})`)
    }
  }

  return checks.slice(0, 3)
}

function StepCard({
  num,
  emoji,
  title,
  hint,
  children,
}: {
  num: 2 | 3 | 4 | 5
  emoji: string
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="adetail-summary__card">
      <div className="adetail-summary__card-head">
        <span className="adetail-summary__card-num">{emoji}</span>
        <div className="adetail-summary__card-titles">
          <p className="adetail-summary__card-title">{title}</p>
          <p className="adetail-summary__card-hint">{hint}</p>
        </div>
        <span className="adetail-summary__card-tag">STEP {num}</span>
      </div>
      <div className="adetail-summary__card-body">{children}</div>
    </div>
  )
}

function AgentSummaryHeader({ report }: { report: ExfiltrationReport | null }) {
  if (!report) {
    return (
      <section className="adetail-summary" aria-label="에이전트 분석 요약">
        <p className="adetail-summary__empty">분석 요약이 아직 준비되지 않았습니다.</p>
      </section>
    )
  }

  const keyChecks = extractKeyChecks(report)
  const counterEvidence = report.risk_breakdown.counter_evidence ?? 0
  const counterText =
    counterEvidence < 0
      ? '단순 업무로 보기 어려운 정황이 더 많아요'
      : '반증 근거가 발견되지 않았어요'

  const topEmails = [...report.suspicious_emails]
    .sort((a, b) => b.risk_weight - a.risk_weight)
    .slice(0, 2)
  const fileGroups = groupBy(report.suspicious_files, (f) => f.sensitivity_category).slice(0, 3)
  const outOfHours = report.behavior_summary.out_of_hours_activity?.length ?? 0
  const deleted = report.behavior_summary.deleted_files?.length ?? 0

  return (
    <section className="adetail-summary" aria-label="에이전트 분석 요약">
      <div className="adetail-summary__focus">
        <h3 className="adetail-summary__focus-title">🎯 중점 확인 항목</h3>
        {keyChecks.length === 0 ? (
          <p className="adetail-summary__empty">중점 확인 항목이 없습니다.</p>
        ) : (
          <ol className="adetail-summary__focus-list">
            {keyChecks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="adetail-summary__grid">
        <StepCard
          num={2}
          emoji="📤"
          title="어디로 자료가 나갔는지"
          hint={`외부 발신 ${report.suspicious_emails.length}건`}
        >
          {topEmails.length === 0 ? (
            <p className="adetail-summary__muted">의심 발신 기록 없음</p>
          ) : (
            <ul className="adetail-summary__list">
              {topEmails.map((e) => (
                <li key={e.email_id}>
                  <strong>{formatDate(e.sent_at)}</strong> · {channelPlain(e.channel_type)} →{' '}
                  {e.recipient}
                </li>
              ))}
              {report.suspicious_emails.length > topEmails.length && (
                <li className="adetail-summary__muted">
                  외 {report.suspicious_emails.length - topEmails.length}건 더 있음
                </li>
              )}
            </ul>
          )}
        </StepCard>

        <StepCard
          num={3}
          emoji="📁"
          title="어떤 자료가 다뤄졌는지"
          hint={`민감 파일 ${report.suspicious_files.length}건`}
        >
          {fileGroups.length === 0 ? (
            <p className="adetail-summary__muted">의심 파일 없음</p>
          ) : (
            <ul className="adetail-summary__list">
              {fileGroups.map(([cat, files]) => (
                <li key={cat}>
                  <strong>{sensitivityCategoryPlain(cat)}</strong>: {files.length}건
                </li>
              ))}
            </ul>
          )}
        </StepCard>

        <StepCard
          num={4}
          emoji="🕒"
          title="평소와 다른 행동"
          hint={`업무 외 ${outOfHours}건 · 삭제 ${deleted}건`}
        >
          {report.behavior_summary.notes ? (
            <p className="adetail-summary__notes">{report.behavior_summary.notes}</p>
          ) : (
            <p className="adetail-summary__muted">특이 행동 기록 없음</p>
          )}
        </StepCard>

        <StepCard
          num={5}
          emoji="⚖️"
          title="다른 해석 가능성"
          hint={counterEvidence < 0 ? '반증 일부 인정' : '반증 없음'}
        >
          <p className="adetail-summary__notes">{counterText}</p>
        </StepCard>
      </div>
    </section>
  )
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = keyFn(item) || '(기타)'
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return [...map.entries()]
}

export function AdminAnalysisWorkspace({ sessionId, entry }: Props) {
  const [contentTab, setContentTab] = useState(0)
  const [selectedFile, setSelectedFile] = useState<SuspiciousFile | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<SuspiciousEmail | null>(null)

  const { data: session, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  const exfilReport = useMemo<ExfiltrationReport | null>(() => {
    if (!session) return null
    const classified = classifyReport(session.report_json)
    return classified.kind === 'exfiltration' ? classified.report : null
  }, [session])

  const reportItems = useMemo(() => {
    if (!exfilReport) return { files: [] as SuspiciousFile[], emails: [] as SuspiciousEmail[] }
    return {
      files: exfilReport.suspicious_files,
      emails: exfilReport.suspicious_emails,
    }
  }, [exfilReport])

  return (
    <div className="adetail-analysis">
      <aside className="adetail-analysis__side" aria-label="직원 소명과 의심 항목">
        <ExplanationPanel text={entry.explanation_text} />

        <section className="adetail-analysis__panel adetail-analysis__middle" aria-label="의심 파일과 이메일">
          <header className="adetail-analysis__head">
            <h2 className="adetail-analysis__title">의심 파일 · 이메일</h2>
            <span className="adetail-analysis__count">
              {reportItems.files.length + reportItems.emails.length}
            </span>
          </header>

          {isLoading ? (
            <p className="adetail-analysis__state">의심 항목을 불러오는 중...</p>
          ) : isError ? (
            <p className="adetail-analysis__state adetail-analysis__state--error">
              세션 리포트를 불러오지 못했습니다.
            </p>
          ) : reportItems.files.length === 0 && reportItems.emails.length === 0 ? (
            <p className="adetail-analysis__state">표시할 의심 항목이 없습니다.</p>
          ) : (
            <div className="adetail-analysis__list">
              <div className="adetail-analysis__section-title">
                의심 파일 ({reportItems.files.length})
              </div>
              {reportItems.files.map((file) => (
                <button
                  key={file.file_id}
                  type="button"
                  className="adetail-analysis__item"
                  onClick={() => setSelectedFile(file)}
                >
                  <span className="adetail-analysis__item-top">
                    <strong>{file.filename}</strong>
                  </span>
                  <span className="adetail-analysis__item-meta">
                    {sensitivityCategoryPlain(file.sensitivity_category)}
                  </span>
                  <span className="adetail-analysis__item-desc">
                    {file.matched_keywords.join(', ') || '매칭 키워드 없음'}
                  </span>
                  <span className="adetail-analysis__path">{file.relative_path}</span>
                </button>
              ))}

              <div className="adetail-analysis__section-title adetail-analysis__section-title--gap">
                의심 이메일 ({reportItems.emails.length})
              </div>
              {reportItems.emails.map((email) => {
                const tone = riskTone(email.risk_weight)
                return (
                  <button
                    key={email.email_id}
                    type="button"
                    className="adetail-analysis__item"
                    onClick={() => setSelectedEmail(email)}
                  >
                    <span className="adetail-analysis__item-top">
                      <strong>{email.subject || '(제목 없음)'}</strong>
                      {tone.mark && (
                        <span
                          className={`adetail-analysis__pill ${tone.cls}`}
                          title={`risk_weight: ${email.risk_weight}`}
                        >
                          {tone.mark}
                        </span>
                      )}
                    </span>
                    <span className="adetail-analysis__item-meta">
                      {channelLabel(email.channel_type)} · {formatDate(email.sent_at)}
                    </span>
                    <span className="adetail-analysis__item-desc">
                      {email.sender} → {email.recipient}
                    </span>
                    <span className="adetail-analysis__path">
                      {email.suspicion_reason}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </aside>

      <section className="adetail-analysis__panel adetail-analysis__right" aria-label="상세 판정">
        <AgentSummaryHeader report={exfilReport} />
        <div className="adetail-analysis__right-content">
          <ContentViewer
            selectedSessionId={sessionId}
            tab={contentTab}
            onTab={setContentTab}
            layout="expanded"
          />
        </div>
      </section>

      {selectedFile && (
        <FileBodyModal
          file={fileRecordFromSuspicious(selectedFile)}
          highlightKeywords={selectedFile.matched_keywords}
          onClose={() => setSelectedFile(null)}
        />
      )}

      {selectedEmail && (
        <EmailBodyModal
          email={emailRecordFromSuspicious(selectedEmail)}
          suspicionReason={selectedEmail.suspicion_reason}
          onClose={() => setSelectedEmail(null)}
        />
      )}
    </div>
  )
}
