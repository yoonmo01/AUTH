import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSummary, fetchSessions } from '../api/client'
import { selectLatestCompletedSession } from '../report'
import { toggleLayout, initialConsoleLayout, type ConsoleLayout } from '../consoleLayout'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { TreeViewer, type TreeSelected } from './TreeViewer'
import { ResultViewer } from './ResultViewer'
import { ContentViewer } from './ContentViewer'
import { DirectoryTree } from './DirectoryTree'
import { LayoutToggle } from './LayoutToggle'
import type { Summary, FileRecord, Session } from '../types'

const nf = new Intl.NumberFormat('en-US')

type ReadoutProps = {
  label: string
  value: number | undefined
  loading: boolean
  accent?: boolean
}

function Readout({ label, value, loading, accent }: ReadoutProps) {
  return (
    <div className={accent ? 'readout readout--accent' : 'readout'}>
      <span className="readout__label">{label}</span>
      <span className="readout__value" aria-busy={loading}>
        {loading ? (
          <span className="readout__skel" aria-hidden="true" />
        ) : value === undefined ? (
          '———'
        ) : (
          nf.format(value)
        )}
      </span>
      <span className="readout__ticks" aria-hidden="true" />
    </div>
  )
}

type Props = {
  // Session handed off by the onboarding flow when an analysis completes.
  // When null, the latest completed session is auto-selected instead.
  initialSessionId?: string | null
}

// Investigation console. Two layouts (./consoleLayout): 'focused' opens just
// the verdict tab panel; 'expanded' is the 4-zone workspace reached via the
// "모두 보기" button in the verdict panel.
export function Console({ initialSessionId }: Props) {
  const { data, isLoading, isError } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: fetchSummary,
  })

  const [layout, setLayout] = useState<ConsoleLayout>(initialConsoleLayout)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    initialSessionId ?? null,
  )
  const [contentTab, setContentTab] = useState(0)
  const [sessionAutoPicked, setSessionAutoPicked] = useState(initialSessionId != null)

  // Expanded-workspace state — tree navigation, file search, file selection.
  const [selected, setSelected] = useState<TreeSelected>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null)

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  })
  useEffect(() => {
    if (sessionAutoPicked || !sessions) return
    const latest = selectLatestCompletedSession(sessions)
    if (latest) setSelectedSessionId(latest.id)
    setSessionAutoPicked(true)
  }, [sessions, sessionAutoPicked])

  function handleSelectSession(id: string) {
    setSelectedSessionId(id)
    setContentTab(0)
  }

  const status = isError ? 'bad' : isLoading ? 'warn' : 'ok'
  const statusText = isError
    ? 'DB · OFFLINE'
    : isLoading
      ? 'DB · QUERYING'
      : 'DB · CONNECTED'
  const footMsg = isError
    ? 'API /summary 응답 없음 — 백엔드(:8000) 기동 여부를 확인하세요'
    : isLoading
      ? '증거 메타데이터 조회 중…'
      : '준비됨'

  const tabPanel = (
    <ContentViewer
      selectedSessionId={selectedSessionId}
      tab={contentTab}
      onTab={setContentTab}
    />
  )

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr__beam" aria-hidden="true" />
        <div className="hdr__scan" aria-hidden="true" />

        <div className="hdr__id">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              ◆
            </span>
            <span className="brand__name">HYENA</span>
            <span className="brand__sub">EXFILTRATION&nbsp;FORENSICS</span>
          </div>
          <div className={`conn conn--${status}`} role="status">
            <span className="conn__dot" aria-hidden="true" />
            <span className="conn__txt">{statusText}</span>
          </div>
        </div>

        <div className="hdr__readouts">
          <LayoutToggle
            layout={layout}
            onToggle={() => setLayout(toggleLayout(layout))}
          />
          <span className="hdr__div" aria-hidden="true" />
          <Readout label="FILES" value={data?.files} loading={isLoading} accent />
          <Readout label="EMAILS" value={data?.emails} loading={isLoading} accent />
          <Readout
            label="ACTIVITIES"
            value={data?.activities}
            loading={isLoading}
            accent
          />
          <span className="hdr__div" aria-hidden="true" />
          <Readout label="DOCS" value={data?.documents} loading={isLoading} />
          <Readout label="ENTITIES" value={data?.entities} loading={isLoading} />
        </div>
      </header>

      {layout === 'focused' ? (
        <main className="focusview">{tabPanel}</main>
      ) : (
        <main className="workspace">
          <div className="workspace__left">
            <TreeViewer selected={selected} onSelect={setSelected} />
            <DirectoryTree />
          </div>
          <ResultViewer
            selected={selected}
            query={debouncedSearch}
            search={search}
            onSearch={setSearch}
            selectedFileId={selectedFile?.id ?? null}
            onSelectFile={setSelectedFile}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
          />
          {tabPanel}
        </main>
      )}

      <footer className="statusbar">
        <span className="statusbar__tag">HYENA INVESTIGATION CONSOLE</span>
        <span className="statusbar__msg">{footMsg}</span>
        <span className="statusbar__ver">v0.1 · SLICE&nbsp;9</span>
      </footer>
    </div>
  )
}
