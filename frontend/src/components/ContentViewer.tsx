import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NetworkViewer, type GraphExportRef } from './NetworkViewer'
import { TimelineViewer } from './TimelineViewer'
import { VerdictViewer, printVerdictReport } from './VerdictViewer'
import { fetchSession } from '../api/client'
import { classifyReport } from '../report'
import type { Session } from '../types'
import type { ConsoleLayout } from '../consoleLayout'

// Console tab panel — 판정 / 네트워크 / 타임라인. File body is no longer a
// tab; it opens as a popup from the file list (콘솔 개편 S4).
const TABS = ['판정', '네트워크', '타임라인'] as const

type Props = {
  selectedSessionId: string | null
  tab: number
  onTab: (tab: number) => void
  layout: ConsoleLayout
}

export function ContentViewer({ selectedSessionId, tab, onTab, layout }: Props) {
  // Same query key as VerdictViewer — react-query dedupes, so reading the
  // session here only feeds the tab-bar PDF action, no extra request.
  const { data } = useQuery<Session>({
    queryKey: ['session', selectedSessionId],
    queryFn: () => fetchSession(selectedSessionId as string),
    enabled: selectedSessionId != null,
  })

  // NetworkInner publishes its PNG export fn here while the 네트워크 탭 is open.
  const graphExportRef: GraphExportRef = useRef<(() => void) | null>(null)

  // The PDF action targets the verdict report; expose subject/verdict only
  // when the loaded session actually carries a printable report.
  const classified = data ? classifyReport(data.report_json) : null
  const verdictTarget =
    classified?.kind === 'exfiltration'
      ? { subjectName: classified.report.subject.name, verdict: classified.report.verdict }
      : classified?.kind === 'clean'
        ? { subjectName: classified.report.subject.name, verdict: 'CLEAN' }
        : null

  return (
    <div className={`zone zone--verdict-${layout}`}>
      <div className="zone__tabs">
        {TABS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`t${i === tab ? ' t--on' : ''}`}
            onClick={() => onTab(i)}
          >
            {label}
          </button>
        ))}
        {/* Tab-bar actions, right-aligned: PDF 다운로드 then 그래프 다운로드.
            그래프 버튼은 네트워크 탭에서만 — 그래프가 마운트돼 있을 때만 동작. */}
        <div className="zone__tab-actions">
          {verdictTarget && (
            <button
              type="button"
              className="zone__action"
              onClick={() =>
                printVerdictReport(verdictTarget.subjectName, verdictTarget.verdict)
              }
            >
              PDF 다운로드
            </button>
          )}
          {tab === 1 && (
            <button
              type="button"
              className="zone__action"
              onClick={() => graphExportRef.current?.()}
            >
              그래프 다운로드
            </button>
          )}
        </div>
      </div>
      <div className="zone__body zone__body--content">
        {tab === 0 ? (
          <VerdictViewer sessionId={selectedSessionId} layout={layout} />
        ) : tab === 1 ? (
          <NetworkViewer
            layout={layout}
            sessionId={selectedSessionId}
            exportRef={graphExportRef}
          />
        ) : (
          <TimelineViewer sessionId={selectedSessionId} />
        )}
      </div>
    </div>
  )
}
