import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSession, fetchAdminNarrative, type InboxEntry } from '../api/client'
import { classifyReport } from '../report'
import {
  channelLabel,
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
  if (weight >= 30) return { mark: 'HIGH', cls: 'adetail-analysis__pill--high' }
  if (weight >= 15) return { mark: 'MED', cls: 'adetail-analysis__pill--med' }
  return { mark: '', cls: '' }
}

function fileExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return 'FILE'
  return filename.slice(dot + 1).toUpperCase().slice(0, 4)
}

function ExplanationPanel({ text }: { text: string | null }) {
  const trimmed = text?.trim()

  return (
    <section className="adetail-analysis__panel adetail-analysis__explain" aria-label="직원 소명">
      {/* <header className="adetail-analysis__head">
        <h2 className="adetail-analysis__title">직원 소명</h2>
      </header> */}
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

type ListTab = 'all' | 'file' | 'email'

export function AdminAnalysisWorkspace({ sessionId, entry }: Props) {
  const [contentTab, setContentTab] = useState(0)
  const [listTab, setListTab] = useState<ListTab>('all')
  const [selectedFile, setSelectedFile] = useState<SuspiciousFile | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<SuspiciousEmail | null>(null)
  const queryClient = useQueryClient()

  const { data: session, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  const exfilReport = useMemo<ExfiltrationReport | null>(() => {
    if (!session) return null
    const classified = classifyReport(session.report_json)
    return classified.kind === 'exfiltration' ? classified.report : null
  }, [session])

  // 상세분석 화면이 열리는 즉시 narrative를 백그라운드 prefetch —
  // "분석 결과" 탭을 클릭하기 전에 캐시를 채워두기 위함.
  useEffect(() => {
    if (!exfilReport) return
    queryClient.prefetchQuery({
      queryKey: ['admin-narrative', sessionId],
      queryFn: () => fetchAdminNarrative(sessionId),
      staleTime: Infinity,
    })
  }, [exfilReport, sessionId, queryClient])

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

          <div className="adetail-analysis__tabs" role="tablist">
            {([
              ['all',   '전체', reportItems.files.length + reportItems.emails.length],
              ['file',  '파일', reportItems.files.length],
              ['email', '메일', reportItems.emails.length],
            ] as [ListTab, string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                type="button"
                className={`adetail-analysis__tab${listTab === key ? ' adetail-analysis__tab--on' : ''}`}
                onClick={() => setListTab(key)}
              >
                {label}
                <span className="adetail-analysis__tab-count">{count}</span>
              </button>
            ))}
          </div>

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
              {(listTab === 'all' || listTab === 'file') && reportItems.files.map((file) => (
                <button
                  key={file.file_id}
                  type="button"
                  className="adetail-analysis__item adetail-analysis__item--file"
                  onClick={() => setSelectedFile(file)}
                >
                  <span className="adetail-analysis__item-icon" aria-hidden="true">
                    {fileExt(file.filename)}
                  </span>
                  <span className="adetail-analysis__item-body">
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
                  </span>
                  <span className="adetail-analysis__item-chevron" aria-hidden="true">›</span>
                </button>
              ))}

              {(listTab === 'all' || listTab === 'email') && reportItems.emails.map((email) => {
                const tone = riskTone(email.risk_weight)
                return (
                  <button
                    key={email.email_id}
                    type="button"
                    className="adetail-analysis__item adetail-analysis__item--email"
                    onClick={() => setSelectedEmail(email)}
                  >
                    <span className="adetail-analysis__item-icon" aria-hidden="true">✉</span>
                    <span className="adetail-analysis__item-body">
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
                    </span>
                    <span className="adetail-analysis__item-chevron" aria-hidden="true">›</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </aside>

      <section className="adetail-analysis__panel adetail-analysis__right" aria-label="상세 분석">
        <ContentViewer
          selectedSessionId={sessionId}
          tab={contentTab}
          onTab={setContentTab}
          layout="expanded"
        />
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
