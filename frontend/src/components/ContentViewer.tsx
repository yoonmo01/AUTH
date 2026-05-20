import { NetworkViewer } from './NetworkViewer'
import { TimelineViewer } from './TimelineViewer'
import { VerdictViewer } from './VerdictViewer'
import type { ConsoleLayout } from '../consoleLayout'

// Console tab panel — 판정 / 네트워크 / 타임라인. File body is no longer a
// tab; it opens as a popup from the file list (콘솔 개편 S4).
const TABS = ['판정', '네트워크', '타임라인'] as const

type Props = {
  selectedSessionId: string | null
  tab: number
  onTab: (tab: number) => void
  layout: ConsoleLayout
  onToggleLayout: () => void
}

export function ContentViewer({
  selectedSessionId,
  tab,
  onTab,
  layout,
  onToggleLayout,
}: Props) {
  return (
    <div className="zone">
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
      </div>
      <div className="zone__body zone__body--content">
        {tab === 0 ? (
          <VerdictViewer
            sessionId={selectedSessionId}
            layout={layout}
            onToggleLayout={onToggleLayout}
          />
        ) : tab === 1 ? (
          <NetworkViewer />
        ) : (
          <TimelineViewer />
        )}
      </div>
    </div>
  )
}
