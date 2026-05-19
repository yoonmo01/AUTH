import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSummary } from './api/client'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { TreeViewer, type TreeSelected } from './components/TreeViewer'
import { ResultViewer } from './components/ResultViewer'
import type { Summary } from './types'

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

type PanelProps = {
  tab: string
  hint: string
  tabs?: string[]
}

function Panel({ tab, hint, tabs }: PanelProps) {
  return (
    <div className="zone">
      {tabs ? (
        <div className="zone__tabs">
          {tabs.map((t, i) => (
            <span key={t} className={i === 0 ? 't t--on' : 't'}>
              {t}
            </span>
          ))}
        </div>
      ) : (
        <div className="zone__tab">{tab}</div>
      )}
      <div className="zone__body">
        <div className="ph">
          <span className="ph__mark" aria-hidden="true">
            ◇
          </span>
          <span className="ph__txt">{hint}</span>
        </div>
      </div>
    </div>
  )
}

function App() {
  const { data, isLoading, isError } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: fetchSummary,
  })

  const [selected, setSelected] = useState<TreeSelected>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)

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

      <main className="grid">
        <aside className="col col--tree">
          <TreeViewer selected={selected} onSelect={setSelected} />
        </aside>
        <section className="col col--work">
          <ResultViewer
            category={selected}
            query={debouncedSearch}
            search={search}
            onSearch={setSearch}
          />
          <Panel
            tab=""
            tabs={['파일 본문', '네트워크', '타임라인', '판정']}
            hint="콘텐츠 뷰어 — S5 · S6 · S7 · S9"
          />
        </section>
      </main>

      <footer className="statusbar">
        <span className="statusbar__tag">HYENA INVESTIGATION CONSOLE</span>
        <span className="statusbar__msg">{footMsg}</span>
        <span className="statusbar__ver">v0.1 · SLICE&nbsp;2</span>
      </footer>
    </div>
  )
}

export default App
