import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSession, type InboxEntry } from '../api/client'
import { classifyReport } from '../report'
import { channelLabel } from '../reportLabels'
import { formatDate } from '../format'
import { EmployeeReport } from './EmployeeReport'
import { ContentViewer } from './ContentViewer'
import { FileBodyModal } from './FileBodyModal'
import { EmailBodyModal } from './EmailBodyModal'
import type { EmailRecord, FileRecord, Session, SuspiciousEmail, SuspiciousFile } from '../types'

type Props = {
  sessionId: string
  entry: InboxEntry
}

function fileRecordFromSuspicious(file: SuspiciousFile): FileRecord {
  const dot = file.filename.lastIndexOf('.')
  return {
    id: file.file_id,
    filename: file.filename,
    extension: dot >= 0 ? file.filename.slice(dot) : '',
    category: 'document',
    file_size: null,
    file_modified_at: null,
    file_accessed_at: null,
    file_created_at: null,
    relative_path: file.relative_path,
    original_path: file.relative_path,
    sha256_hash: null,
    source_label: '',
    is_user_content: true,
    etl_status: '',
  }
}

function emailRecordFromSuspicious(email: SuspiciousEmail): EmailRecord {
  return {
    id: email.email_id,
    subject: email.subject,
    sender: email.sender,
    sent_at: email.sent_at,
    body_preview: email.suspicion_reason,
    source_file: '',
    recipients_to: [email.recipient],
    has_attachments: email.has_attachment,
  }
}

function sensitivityLabel(score: number): string {
  if (!Number.isFinite(score)) return '-'
  return `${Math.round(score * 100)}%`
}

export function AdminAnalysisWorkspace({ sessionId, entry }: Props) {
  const [contentTab, setContentTab] = useState(0)
  const [selectedFile, setSelectedFile] = useState<SuspiciousFile | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<SuspiciousEmail | null>(null)

  const { data: session, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  const reportItems = useMemo(() => {
    if (!session) return { files: [] as SuspiciousFile[], emails: [] as SuspiciousEmail[] }
    const classified = classifyReport(session.report_json)
    if (classified.kind !== 'exfiltration') {
      return { files: [] as SuspiciousFile[], emails: [] as SuspiciousEmail[] }
    }
    return {
      files: classified.report.suspicious_files,
      emails: classified.report.suspicious_emails,
    }
  }, [session])

  return (
    <div className="adetail-analysis">
      <section className="adetail-analysis__panel adetail-analysis__left" aria-label="직원 리포트">
        <EmployeeReport
          sessionId={sessionId}
          employeeId={entry.employee_id}
          employeeName={entry.name}
          quarter={entry.quarter}
          readOnly
          onSubmitted={() => undefined}
        />
      </section>

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
                  <span className="adetail-analysis__pill">
                    {sensitivityLabel(file.sensitivity_score)}
                  </span>
                </span>
                <span className="adetail-analysis__item-meta">
                  {file.sensitivity_category || '분류 없음'}
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
            {reportItems.emails.map((email) => (
              <button
                key={email.email_id}
                type="button"
                className="adetail-analysis__item"
                onClick={() => setSelectedEmail(email)}
              >
                <span className="adetail-analysis__item-top">
                  <strong>{email.subject || '(제목 없음)'}</strong>
                  <span className="adetail-analysis__pill">
                    {email.risk_weight}
                  </span>
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
            ))}
          </div>
        )}
      </section>

      <section className="adetail-analysis__panel adetail-analysis__right" aria-label="상세 판정">
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
