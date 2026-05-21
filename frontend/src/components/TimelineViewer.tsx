import { useQuery } from '@tanstack/react-query'
import { fetchSession } from '../api/client'
import { classifyReport } from '../report'
import type { Session, ReportTimelineEntry } from '../types'

// Keywords flagged as suspicious in report timeline event text. Matched
// case-insensitively against each event string; presence triggers row
// highlighting and inline mark wrapping.
const SUSPICION_KEYWORDS = [
  'ProtonMail', '익명', '익명 채널', 'tmpbox', '임시 메일', '임시메일',
  '삭제', '은폐',
  '외부 전송', '외부 첨부', '외부 발송', '외부로 발신',
  '비인가', '무단', '의심', '이례적', '이상',
  '유출', '탈취', '반출',
  'USB', '저장장치',
  '근무 시간 외', '업무 외', '심야', '주말',
  '개인 Gmail', '개인 이메일', '개인 계정',
] as const

function suspicionLevel(events: string[]): 'high' | 'medium' | 'low' | 'none' {
  let hits = 0
  for (const ev of events) {
    for (const kw of SUSPICION_KEYWORDS) {
      if (ev.toLowerCase().includes(kw.toLowerCase())) {
        hits += 1
        break
      }
    }
  }
  if (hits >= 3) return 'high'
  if (hits >= 2) return 'medium'
  if (hits >= 1) return 'low'
  return 'none'
}

// Wraps occurrences of suspicion keywords in <mark> tags. Escapes regex
// metacharacters and walks longest-first to avoid nesting.
function highlightKeywords(text: string) {
  const sorted = [...SUSPICION_KEYWORDS].sort((a, b) => b.length - a.length)
  const escaped = sorted.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts: { t: string; hi: boolean }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), hi: false })
    parts.push({ t: m[0], hi: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ t: text.slice(last), hi: false })
  return parts
}

function TimelineEntryRow({ entry }: { entry: ReportTimelineEntry }) {
  const level = suspicionLevel(entry.events)
  return (
    <li className={`tl__item tl__item--${level}`}>
      <div className="tl__rail">
        <span className="tl__dot" />
      </div>
      <div className="tl__card">
        <div className="tl__head">
          <span className="tl__time">{entry.date}</span>
          {level !== 'none' && (
            <span className={`tl__sev tl__sev--${level}`}>
              {level === 'high' ? '의심 행위 다수' : level === 'medium' ? '의심 행위' : '주의'}
            </span>
          )}
        </div>
        <ul className="tl__events">
          {entry.events.map((ev, i) => {
            const parts = highlightKeywords(ev)
            const flagged = parts.some((p) => p.hi)
            return (
              <li key={i} className={`tl__event${flagged ? ' tl__event--flagged' : ''}`}>
                {parts.map((p, j) =>
                  p.hi ? <mark key={j} className="tl__kw">{p.t}</mark> : p.t,
                )}
              </li>
            )
          })}
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
