import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { fetchFiles, fetchEmails, fetchEntities, fetchSession } from '../api/client'
import { classifyReport } from '../report'
import { categoryLabel } from '../categories'
import { formatSize, formatDate } from '../format'
import { channelLabel } from '../reportLabels'
import { isFilenameCellTarget } from '../filenameCell'
import { FileBodyModal } from './FileBodyModal'
import { EmailBodyModal } from './EmailBodyModal'
import { ExpandableRow } from './ExpandableRow'
import type { FileRecord, EmailRecord, EntityRecord, Session, SuspiciousFile, SuspiciousEmail } from '../types'
import type { TreeSelected } from './TreeViewer'

type Props = {
  selected: TreeSelected
  query: string
  search: string
  onSearch: (v: string) => void
  selectedFileId: string | null
  onSelectFile: (f: FileRecord) => void
  selectedSessionId: string | null
}

type Result =
  | { view: 'files'; rows: FileRecord[] }
  | { view: 'emails'; rows: EmailRecord[] }
  | { view: 'entities'; rows: EntityRecord[] }

type View = Result['view']

const TITLES: Record<View, string> = {
  files: 'RESULT · 파일 목록',
  emails: 'RESULT · 이메일 목록',
  entities: 'RESULT · 엔티티 목록',
}

type FileMode = 'all' | 'suspicious'

// Row for the 전체 파일 list. Detects clipped cells and overlays a ▼ button
// in the rightmost cell (no extra column added).
function FileListRow({
  f,
  selected,
  onSelect,
  onPopup,
}: {
  f: FileRecord
  selected: boolean
  onSelect: (f: FileRecord) => void
  onPopup: (f: FileRecord) => void
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (open) return
    const row = ref.current
    if (!row) return
    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))
    const check = () => {
      let any = false
      for (const td of cells) {
        if (td.scrollWidth > td.clientWidth + 1) {
          any = true
          break
        }
      }
      setOverflow(any)
    }
    check()
    const ro = new ResizeObserver(check)
    cells.forEach((td) => ro.observe(td))
    return () => ro.disconnect()
  }, [open, f.id])

  const cls = `table__row${selected ? ' is-sel' : ''}${open ? ' row-exp--open' : ''}`

  return (
    <tr
      ref={ref}
      className={cls}
      onClick={() => onSelect(f)}
      onDoubleClick={(e) => {
        if (isFilenameCellTarget(e.target)) onPopup(f)
      }}
      aria-selected={selected}
    >
      <td className="table__name" data-cell="filename" title={f.filename}>{f.filename}</td>
      <td><span className="table__cat">{categoryLabel(f.category)}</span></td>
      <td className="table__num">{formatSize(f.file_size)}</td>
      <td className="table__num">{formatDate(f.file_modified_at)}</td>
      <td className={`table__path${overflow || open ? ' cell-toggle-host' : ''}`} title={f.relative_path}>
        {f.relative_path}
        {overflow && (
          <button
            type="button"
            className="cell-toggle-inline"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
            aria-label={open ? '접기' : '펼치기'}
          >
            {open ? '▲' : '▼'}
          </button>
        )}
      </td>
    </tr>
  )
}

export function ResultViewer({
  selected,
  query,
  search,
  onSearch,
  selectedFileId,
  onSelectFile,
  selectedSessionId,
}: Props) {
  const view: View =
    selected.kind === 'emails'
      ? 'emails'
      : selected.kind === 'entities'
        ? 'entities'
        : 'files'

  const [fileMode, setFileMode] = useState<FileMode>('all')

  useEffect(() => {
    if (view !== 'files') setFileMode('all')
  }, [view])

  const queryKey =
    selected.kind === 'category'
      ? ['files', 'category', selected.category, query]
      : selected.kind === 'all'
        ? ['files', 'all', query]
        : selected.kind === 'emails'
          ? ['emails', query]
          : ['entities']

  const { data, isLoading, isError, isFetching } = useQuery<Result>({
    queryKey,
    queryFn: async (): Promise<Result> => {
      if (view === 'emails') return { view, rows: await fetchEmails(query) }
      if (view === 'entities') return { view, rows: await fetchEntities() }
      return {
        view,
        rows: await fetchFiles(
          query,
          selected.kind === 'category' ? selected.category : undefined,
        ),
      }
    },
    placeholderData: keepPreviousData,
  })

  // Suspicious files from the current session report (cached — same queryKey as VerdictViewer)
  const { data: sessionData } = useQuery<Session>({
    queryKey: ['session', selectedSessionId],
    queryFn: () => fetchSession(selectedSessionId as string),
    enabled: view === 'files' && fileMode === 'suspicious' && selectedSessionId != null,
  })

  const rawSuspiciousFiles: SuspiciousFile[] = (() => {
    if (!sessionData) return []
    const classified = classifyReport(sessionData.report_json)
    if (classified.kind !== 'exfiltration') return []
    return classified.report.suspicious_files
  })()

  const rawSuspiciousEmails: SuspiciousEmail[] = (() => {
    if (!sessionData) return []
    const classified = classifyReport(sessionData.report_json)
    if (classified.kind !== 'exfiltration') return []
    return classified.report.suspicious_emails
  })()

  // Client-side filter for suspicious mode — narrows the report lists by
  // any of: filename, matched keywords, path, subject, recipient, sender,
  // suspicion reason. Empty query passes everything through.
  const needle = query.trim().toLowerCase()
  const suspiciousFiles = needle === ''
    ? rawSuspiciousFiles
    : rawSuspiciousFiles.filter((f) =>
        f.filename.toLowerCase().includes(needle) ||
        f.relative_path.toLowerCase().includes(needle) ||
        f.matched_keywords.some((k) => k.toLowerCase().includes(needle)) ||
        f.sensitivity_category.toLowerCase().includes(needle),
      )
  const suspiciousEmails = needle === ''
    ? rawSuspiciousEmails
    : rawSuspiciousEmails.filter((e) =>
        (e.subject ?? '').toLowerCase().includes(needle) ||
        (e.recipient ?? '').toLowerCase().includes(needle) ||
        (e.sender ?? '').toLowerCase().includes(needle) ||
        (e.suspicion_reason ?? '').toLowerCase().includes(needle) ||
        e.channel_type.toLowerCase().includes(needle),
      )

  const tableClass = `table${isFetching ? ' is-fetching' : ''}`
  const isEmpty = !data || data.rows.length === 0

  const [popupFile, setPopupFile] = useState<FileRecord | null>(null)
  const [popupEmail, setPopupEmail] = useState<EmailRecord | null>(null)
  const [popupSuspicious, setPopupSuspicious] = useState<SuspiciousFile | null>(null)
  const [popupSuspiciousEmail, setPopupSuspiciousEmail] = useState<SuspiciousEmail | null>(null)

  const showFileToggle = view === 'files'

  return (
    <div className="zone">
      <div className="zone__head">
        <span className="zone__title">
          {fileMode === 'suspicious' ? 'RESULT · 의심 파일 · 이메일' : TITLES[data?.view ?? view]}
        </span>
        <div className="zone__head-right">
          {showFileToggle && (
            <div className="ltoggle ltoggle--sm" role="group" aria-label="파일 목록 전환">
              <button
                type="button"
                className={`ltoggle__opt${fileMode === 'all' ? ' ltoggle__opt--on' : ''}`}
                aria-pressed={fileMode === 'all'}
                onClick={() => setFileMode('all')}
              >
                전체 파일
              </button>
              <button
                type="button"
                className={`ltoggle__opt${fileMode === 'suspicious' ? ' ltoggle__opt--on' : ''}`}
                aria-pressed={fileMode === 'suspicious'}
                onClick={() => setFileMode('suspicious')}
              >
                의심 파일
              </button>
            </div>
          )}
          <label className="search">
            <span className="search__icon" aria-hidden="true">⌕</span>
            <input
              className="search__input"
              type="search"
              placeholder={
                fileMode === 'suspicious'
                  ? '검색(파일명·키워드·수신자·사유)'
                  : view === 'entities'
                    ? '검색(이메일·파일)'
                    : '검색…'
              }
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              aria-label="검색"
            />
          </label>
        </div>
      </div>
      <div className="zone__body zone__body--table">
        {view === 'files' && fileMode === 'suspicious' ? (
          selectedSessionId == null ? (
            <div className="table__msg">점검 결과를 먼저 선택하세요</div>
          ) : (
            <>
              {/* 의심 파일 */}
              <div className="susp-section__head">
                의심 파일 ({suspiciousFiles.length})
              </div>
              {suspiciousFiles.length === 0 ? (
                <div className="table__msg">의심 파일이 없습니다</div>
              ) : (
                <table className="table table--fixed">
                  <colgroup>
                    <col style={{ width: '17%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '35%' }} />
                    <col style={{ width: '5%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>파일명</th>
                      <th>민감도</th>
                      <th>분류</th>
                      <th>매칭 키워드</th>
                      <th>경로</th>
                      <th aria-label="펼치기" />
                    </tr>
                  </thead>
                  <tbody>
                    {suspiciousFiles.map((f) => (
                      <ExpandableRow
                        key={f.file_id}
                        className="table__row"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setPopupSuspicious(f)}
                      >
                        <td className="table__name">{f.filename}</td>
                        <td className="table__num">
                          <span className="table__sens" style={{
                            color: f.sensitivity_score >= 0.9 ? 'var(--bad)'
                              : f.sensitivity_score >= 0.7 ? 'var(--warn)'
                              : 'var(--ink-dim)',
                          }}>
                            {(f.sensitivity_score * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td><span className="table__cat">{f.sensitivity_category}</span></td>
                        <td className="table__path">{f.matched_keywords.join(', ') || '—'}</td>
                        <td className="table__path">{f.relative_path}</td>
                      </ExpandableRow>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 의심 이메일 */}
              <div className="susp-section__head susp-section__head--gap">
                의심 이메일 ({suspiciousEmails.length})
              </div>
              {suspiciousEmails.length === 0 ? (
                <div className="table__msg">의심 이메일이 없습니다</div>
              ) : (
                <table className="table table--fixed">
                  <colgroup>
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '5%' }} />
                    <col style={{ width: '23%' }} />
                    <col style={{ width: '5%' }} />
                    <col style={{ width: '5%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>채널</th>
                      <th>제목</th>
                      <th>발신자</th>
                      <th>수신자</th>
                      <th>발신시각</th>
                      <th>첨부</th>
                      <th>의심 사유</th>
                      <th>가중치</th>
                      <th aria-label="펼치기" />
                    </tr>
                  </thead>
                  <tbody>
                    {suspiciousEmails.map((e) => (
                      <ExpandableRow
                        key={e.email_id}
                        className="table__row"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setPopupSuspiciousEmail(e)}
                      >
                        <td><span className="table__cat">{channelLabel(e.channel_type)}</span></td>
                        <td className="table__name">{e.subject || '(제목 없음)'}</td>
                        <td className="table__path">{e.sender}</td>
                        <td className="table__path">{e.recipient}</td>
                        <td className="table__num">{formatDate(e.sent_at)}</td>
                        <td>{e.has_attachment ? '있음' : '—'}</td>
                        <td className="table__path">{e.suspicion_reason}</td>
                        <td className="table__num">{e.risk_weight}</td>
                      </ExpandableRow>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )
        ) : isError ? (
          <div className="table__msg">목록 조회 실패 — 백엔드 응답을 확인하세요</div>
        ) : isLoading || !data ? (
          <div className="table__msg">불러오는 중…</div>
        ) : isEmpty ? (
          <div className="table__msg">표시할 항목이 없습니다</div>
        ) : data.view === 'emails' ? (
          <table className={tableClass}>
            <thead>
              <tr>
                <th>제목</th>
                <th>발신자</th>
                <th>발신시각</th>
                <th>미리보기</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((m) => (
                <tr
                  key={m.id}
                  className="table__row"
                  onDoubleClick={() => setPopupEmail(m)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="table__name" title={m.subject ?? ''}>{m.subject ?? '(제목 없음)'}</td>
                  <td className="table__path">{m.sender ?? '—'}</td>
                  <td className="table__num">{formatDate(m.sent_at)}</td>
                  <td title={m.body_preview ?? ''}>{m.body_preview ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : data.view === 'entities' ? (
          <table className={tableClass}>
            <thead>
              <tr>
                <th>유형</th>
                <th>값</th>
                <th>언급횟수</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((e) => (
                <tr key={e.id}>
                  <td><span className="table__cat">{e.entity_type}</span></td>
                  <td className="table__name" title={e.canonical_value}>{e.canonical_value}</td>
                  <td className="table__num">{e.mention_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className={tableClass}>
            <thead>
              <tr>
                <th>파일명</th>
                <th>범주</th>
                <th>크기</th>
                <th>수정일</th>
                <th>경로</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((f) => (
                <FileListRow
                  key={f.id}
                  f={f}
                  selected={selectedFileId === f.id}
                  onSelect={onSelectFile}
                  onPopup={setPopupFile}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {popupFile && (
        <FileBodyModal file={popupFile} onClose={() => setPopupFile(null)} />
      )}
      {popupEmail && (
        <EmailBodyModal email={popupEmail} onClose={() => setPopupEmail(null)} />
      )}
      {popupSuspiciousEmail && (
        <EmailBodyModal
          email={{ id: popupSuspiciousEmail.email_id, subject: popupSuspiciousEmail.subject,
                   sender: popupSuspiciousEmail.sender } as EmailRecord}
          suspicionReason={popupSuspiciousEmail.suspicion_reason}
          onClose={() => setPopupSuspiciousEmail(null)}
        />
      )}
      {popupSuspicious && (
        <FileBodyModal
          file={{ id: popupSuspicious.file_id, filename: popupSuspicious.filename,
                  extension: popupSuspicious.filename.includes('.')
                    ? '.' + popupSuspicious.filename.split('.').pop()
                    : '' } as FileRecord}
          highlightKeywords={popupSuspicious.matched_keywords}
          onClose={() => setPopupSuspicious(null)}
        />
      )}
    </div>
  )
}
