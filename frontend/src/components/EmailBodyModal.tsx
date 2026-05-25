import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchEmail } from '../api/client'
import { formatDate } from '../format'
import type { EmailRecord } from '../types'

type Props = {
  email: EmailRecord   // row from the list (has id, subject, sender, sent_at)
  onClose: () => void
  suspicionReason?: string
}

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="em__meta-row">
      <span className="em__meta-label">{label}</span>
      <span className="em__meta-value">{value}</span>
    </div>
  )
}

export function EmailBodyModal({ email, onClose, suspicionReason }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch full email (body_text, recipients, etc.) — list rows only have preview
  const { data, isLoading, isError } = useQuery<EmailRecord>({
    queryKey: ['email', email.id],
    queryFn: () => fetchEmail(email.id),
  })

  const full = data ?? email

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel modal__panel--wide"
        role="dialog"
        aria-modal="true"
        aria-label={full.subject ?? '이메일'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <span className="modal__title" title={full.subject ?? ''}>
            {full.subject ?? '(제목 없음)'}
          </span>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>

        {suspicionReason && (
          <div className="em__suspicion">
            <span className="em__suspicion__label">의심 사유</span>
            <span className="em__suspicion__text">{suspicionReason}</span>
          </div>
        )}

        <div className="em__meta">
          <MetaRow label="발신" value={full.sender} />
          <MetaRow
            label="수신"
            value={Array.isArray(full.recipients_to) ? full.recipients_to.join(', ') : (full.recipients_to ?? null)}
          />
          <MetaRow
            label="참조"
            value={Array.isArray(full.recipients_cc) ? full.recipients_cc.join(', ') : (full.recipients_cc ?? null)}
          />
          <MetaRow label="시각" value={formatDate(full.sent_at)} />
          {full.has_attachments && (
            <div className="em__meta-row">
              <span className="em__meta-label">첨부</span>
              <span className="em__meta-value em__meta-value--att">있음</span>
            </div>
          )}
        </div>

        <div className="modal__body">
          {isError ? (
            <div className="table__msg">이메일 조회 실패</div>
          ) : isLoading ? (
            <div className="table__msg">불러오는 중…</div>
          ) : (
            <pre className="em__body">
              {(data?.body_text ?? email.body_preview ?? '(본문 없음)').replace(/\n{3,}/g, '\n\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
