import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchInbox, type InboxEntry } from '../api/client'

type Props = {
  adminName: string
  onOpenSession: (sessionId: string) => void
  onLogout: () => void
}

type Filter = 'all' | 'submitted' | 'reviewed'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'submitted', label: '미검토' },
  { key: 'reviewed', label: '검토완료' },
]

const VERDICT_LABELS: Record<string, string> = {
  HIGH: '중점 소명 필요',
  MEDIUM: '주의',
  LOW: '확인 필요',
  CLEAN: '특이사항 없음',
}

const STATUS_LABELS: Record<string, string> = {
  submitted: '미검토',
  reviewed: '검토완료',
}

function verdictLabel(verdict: string | null | undefined): string {
  if (!verdict) return '분석 중'
  return VERDICT_LABELS[verdict] ?? verdict
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function riskValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  return `${Number(value).toLocaleString()}점`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function sortInbox(rows: InboxEntry[]): InboxEntry[] {
  return [...rows].sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
}

export function AdminDashboard({ adminName, onOpenSession, onLogout }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const {
    data: inbox = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin-inbox'],
    queryFn: fetchInbox,
    refetchInterval: 30000,
  })

  const filtered = useMemo(() => {
    const rows = filter === 'all'
      ? inbox
      : inbox.filter((entry) => entry.status === filter)
    return sortInbox(rows)
  }, [filter, inbox])

  const submittedCount = inbox.filter((entry) => entry.status === 'submitted').length
  const reviewedCount = inbox.filter((entry) => entry.status === 'reviewed').length

  return (
    <div className="adash">
      <header className="adash__hdr">
        <div className="adash__brand">HYENA 정기 점검 관리자 콘솔</div>
        <div className="adash__user">관리자: {adminName}</div>
        <button
          className="adash__refresh"
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? '갱신 중' : '새로고침'}
        </button>
        <button className="adash__logout" type="button" onClick={onLogout}>
          로그아웃
        </button>
      </header>

      <main className="adash__body">
        <section className="adash__summary" aria-label="제출 현황">
          <div className="adash__metric">
            <span className="adash__metric-label">전체 제출</span>
            <strong className="adash__metric-value">{inbox.length}</strong>
          </div>
          <div className="adash__metric">
            <span className="adash__metric-label">미검토</span>
            <strong className="adash__metric-value">{submittedCount}</strong>
          </div>
          <div className="adash__metric">
            <span className="adash__metric-label">검토완료</span>
            <strong className="adash__metric-value">{reviewedCount}</strong>
          </div>
        </section>

        <div className="adash__filters" role="tablist" aria-label="상태 필터">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              className={`adash__filter${filter === item.key ? ' adash__filter--active' : ''}`}
              type="button"
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="adash__panel">
          {isLoading ? (
            <p className="adash__state">제출 목록을 불러오는 중...</p>
          ) : error ? (
            <p className="adash__state adash__state--error">
              관리자 목록을 불러오지 못했습니다. 백엔드(:8000) 상태를 확인하세요.
            </p>
          ) : filtered.length === 0 ? (
            <p className="adash__state">표시할 제출 세션이 없습니다.</p>
          ) : (
            <table className="adash__table">
              <thead>
                <tr>
                  <th>직원</th>
                  <th>직급</th>
                  <th>사번</th>
                  <th>분기</th>
                  <th>판정</th>
                  <th>점수</th>
                  <th>제출일시</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.session_id}
                    className="adash__row"
                    tabIndex={0}
                    onClick={() => onOpenSession(entry.session_id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onOpenSession(entry.session_id)
                    }}
                  >
                    <td>
                      <strong className="adash__name">{entry.name}</strong>
                      <span className="adash__dept">{entry.department}</span>
                    </td>
                    <td>{entry.position}</td>
                    <td className="adash__mono">{entry.employee_id}</td>
                    <td className="adash__mono">{entry.quarter || '-'}</td>
                    <td>
                      <span className={`adash__verdict adash__verdict--${entry.verdict || 'pending'}`}>
                        {verdictLabel(entry.verdict)}
                      </span>
                    </td>
                    <td className="adash__mono">{riskValue(entry.risk_score)}</td>
                    <td>{formatDate(entry.submitted_at)}</td>
                    <td>
                      <span className={`adash__status adash__status--${entry.status}`}>
                        {statusLabel(entry.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}
