import { useQuery } from '@tanstack/react-query'
import { fetchSession } from '../api/client'
import { classifyReport } from '../report'
import type { Session, ReportTimelineEntry } from '../types'

function TimelineEntryRow({ entry }: { entry: ReportTimelineEntry }) {
  return (
    <li className="tl__item">
      <div className="tl__rail">
        <span className="tl__dot" style={{ background: '#1559ee' }} />
      </div>
      <div className="tl__card">
        <div className="tl__head">
          <span className="tl__time">{entry.date}</span>
        </div>
        <ul className="tl__events">
          {entry.events.map((ev, i) => (
            <li key={i} className="tl__event">{ev}</li>
          ))}
        </ul>
      </div>
    </li>
  )
}

export function TimelineViewer({ sessionId }: { sessionId: string | null }) {
  const { data, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId as string),
    enabled: sessionId != null,
  })

  if (sessionId == null) {
    return (
      <div className="ph">
        <span className="ph__mark" aria-hidden="true">◇</span>
        <span className="ph__txt">세션을 선택하면 타임라인이 표시됩니다</span>
      </div>
    )
  }
  if (isError) return <div className="table__msg">세션 조회 실패 — 백엔드 응답을 확인하세요</div>
  if (isLoading || !data) return <div className="table__msg">타임라인 불러오는 중…</div>

  const classified = classifyReport(data.report_json)
  if (classified.kind !== 'exfiltration') {
    return <div className="table__msg">타임라인 데이터가 없습니다</div>
  }

  const timeline = classified.report.timeline
  if (timeline.length === 0) {
    return <div className="table__msg">표시할 타임라인 항목이 없습니다</div>
  }

  return (
    <ul className="tl">
      {timeline.map((entry) => (
        <TimelineEntryRow key={entry.date} entry={entry} />
      ))}
    </ul>
  )
}
