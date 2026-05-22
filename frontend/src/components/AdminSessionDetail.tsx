import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchInbox, markReviewed } from '../api/client'
import { EmployeeReport } from './EmployeeReport'
import { Console } from './Console'

type Props = {
  sessionId: string
  onBack: () => void
}

type Tab = 'report' | 'console'

function formatReviewedAt(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function AdminSessionDetail({ sessionId, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('report')
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    data: inbox = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin-inbox'],
    queryFn: fetchInbox,
  })

  const entry = useMemo(
    () => inbox.find((item) => item.session_id === sessionId) ?? null,
    [inbox, sessionId],
  )

  async function handleReview() {
    setReviewing(true)
    setError(null)
    try {
      await markReviewed(sessionId)
      await refetch()
    } catch {
      setError('검토 완료 처리에 실패했습니다.')
    } finally {
      setReviewing(false)
    }
  }

  const reviewed = entry?.status === 'reviewed'

  return (
    <div className="adetail">
      <header className="adetail__hdr">
        <button className="adetail__back" type="button" onClick={onBack}>
          목록으로
        </button>
        <div className="adetail__title">
          {entry ? `${entry.name} ${entry.position}` : '세션 상세'}
          <span className="adetail__sid">{sessionId}</span>
        </div>
        <nav className="adetail__tabs" aria-label="관리자 상세 탭">
          <button
            className={`adetail__tab${tab === 'report' ? ' adetail__tab--active' : ''}`}
            type="button"
            onClick={() => setTab('report')}
          >
            직원 리포트
          </button>
          <button
            className={`adetail__tab${tab === 'console' ? ' adetail__tab--active' : ''}`}
            type="button"
            onClick={() => setTab('console')}
          >
            상세 분석
          </button>
        </nav>
      </header>

      <main className={`adetail__body adetail__body--${tab}`}>
        {isLoading ? (
          <p className="adetail__state">세션 정보를 불러오는 중...</p>
        ) : !entry ? (
          <p className="adetail__state adetail__state--error">
            관리자 제출 목록에서 해당 세션을 찾지 못했습니다.
          </p>
        ) : tab === 'report' ? (
          <div className="adetail__report">
            <EmployeeReport
              sessionId={sessionId}
              employeeId={entry.employee_id}
              employeeName={entry.name}
              quarter={entry.quarter}
              readOnly
              explanationText={entry.explanation_text ?? ''}
              onSubmitted={() => undefined}
            />
          </div>
        ) : (
          <div className="adetail__console">
            <Console initialSessionId={sessionId} />
          </div>
        )}
      </main>

      {tab === 'report' && entry && (
        <footer className="adetail__review">
          {reviewed ? (
            <span className="adetail__reviewed">
              검토완료 {formatReviewedAt(entry.reviewed_at)}
            </span>
          ) : (
            <button
              className="adetail__review-btn"
              type="button"
              onClick={handleReview}
              disabled={reviewing}
            >
              {reviewing ? '처리 중...' : '검토 완료'}
            </button>
          )}
          {error && <span className="adetail__err">{error}</span>}
        </footer>
      )}
    </div>
  )
}
