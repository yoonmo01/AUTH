import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTimeline } from '../api/client'
import { formatDate } from '../format'
import type { ActivityEvent } from '../types'

// Event-type → color/label. Unknown types fall back to gray.
const EVENT_META: Record<string, { label: string; color: string }> = {
  file_copy: { label: '파일 복사', color: '#e0274a' },
  file_move: { label: '파일 이동', color: '#e0274a' },
  file_delete: { label: '파일 삭제', color: '#9c1029' },
  email_send: { label: '이메일 발송', color: '#c2790b' },
  usb_connect: { label: 'USB 연결', color: '#d6a400' },
  web_access: { label: '웹 접근', color: '#1559ee' },
}

function metaFor(eventType: string): { label: string; color: string } {
  return EVENT_META[eventType] ?? { label: eventType, color: '#93a1ad' }
}

function targetOf(ev: ActivityEvent): string {
  return ev.target_path ?? ev.url ?? ev.filename ?? '—'
}

function TimelineRow({ ev }: { ev: ActivityEvent }) {
  const { label, color } = metaFor(ev.event_type)
  return (
    <li className="tl__item">
      <div className="tl__rail">
        <span className="tl__dot" style={{ background: color }} />
      </div>
      <div className="tl__card">
        <div className="tl__head">
          <span className="tl__time">{formatDate(ev.event_at)}</span>
          <span className="tl__type" style={{ color, borderColor: color }}>
            {label}
          </span>
        </div>
        <div className="tl__target" title={targetOf(ev)}>
          {targetOf(ev)}
        </div>
        <div className="tl__meta">
          <span className="tl__cell">
            <b>프로세스</b> {ev.process_name ?? '—'}
          </span>
          <span className="tl__cell">
            <b>actor</b> {ev.actor ?? '—'}
          </span>
        </div>
      </div>
    </li>
  )
}

export function TimelineViewer() {
  const { data, isLoading, isError } = useQuery<ActivityEvent[]>({
    queryKey: ['timeline'],
    queryFn: () => fetchTimeline(),
  })

  // Chronological order; events without a timestamp sink to the bottom.
  const events = useMemo(() => {
    return [...(data ?? [])].sort((a, b) => {
      if (!a.event_at) return 1
      if (!b.event_at) return -1
      return a.event_at.localeCompare(b.event_at)
    })
  }, [data])

  if (isError) {
    return <div className="table__msg">타임라인 조회 실패 — 백엔드 응답을 확인하세요</div>
  }
  if (isLoading || !data) {
    return <div className="table__msg">타임라인 불러오는 중…</div>
  }
  if (events.length === 0) {
    return <div className="table__msg">표시할 활동 이벤트가 없습니다</div>
  }

  return (
    <ul className="tl">
      {events.map((ev) => (
        <TimelineRow key={ev.id} ev={ev} />
      ))}
    </ul>
  )
}
