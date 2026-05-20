import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { fetchFiles, fetchEmails, fetchEntities, fetchSessions } from '../api/client'
import { categoryLabel } from '../categories'
import { formatSize, formatDate } from '../format'
import { isFilenameCellTarget } from '../filenameCell'
import { VerdictBadge } from './VerdictBadge'
import { FileBodyModal } from './FileBodyModal'
import type { FileRecord, EmailRecord, EntityRecord, Session } from '../types'
import type { TreeSelected } from './TreeViewer'

type Props = {
  selected: TreeSelected
  query: string          // debounced search term
  search: string         // raw input value (controlled)
  onSearch: (v: string) => void
  selectedFileId: string | null
  onSelectFile: (f: FileRecord) => void
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}

// The query result is tagged with its view so keepPreviousData can never
// render one shape's data with another shape's columns (a stale FileRecord[]
// rendered as entities would crash on e.mention_count.toLocaleString()).
type Result =
  | { view: 'files'; rows: FileRecord[] }
  | { view: 'emails'; rows: EmailRecord[] }
  | { view: 'entities'; rows: EntityRecord[] }
  | { view: 'sessions'; rows: Session[] }

type View = Result['view']

const TITLES: Record<View, string> = {
  files: 'RESULT · 파일 목록',
  emails: 'RESULT · 이메일 목록',
  entities: 'RESULT · 엔티티 목록',
  sessions: 'RESULT · 수사 결과',
}

export function ResultViewer({
  selected,
  query,
  search,
  onSearch,
  selectedFileId,
  onSelectFile,
  selectedSessionId,
  onSelectSession,
}: Props) {
  const view: View =
    selected.kind === 'emails'
      ? 'emails'
      : selected.kind === 'entities'
        ? 'entities'
        : selected.kind === 'sessions'
          ? 'sessions'
          : 'files'

  const queryKey =
    selected.kind === 'category'
      ? ['files', 'category', selected.category, query]
      : selected.kind === 'all'
        ? ['files', 'all', query]
        : selected.kind === 'emails'
          ? ['emails', query]
          : selected.kind === 'sessions'
            ? ['sessions']
            : ['entities']

  const { data, isLoading, isError, isFetching } = useQuery<Result>({
    queryKey,
    queryFn: async (): Promise<Result> => {
      if (view === 'emails') return { view, rows: await fetchEmails(query) }
      if (view === 'entities') return { view, rows: await fetchEntities() }
      if (view === 'sessions') return { view, rows: await fetchSessions() }
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

  const tableClass = `table${isFetching ? ' is-fetching' : ''}`
  const isEmpty = !data || data.rows.length === 0

  // File body popup — opened by double-clicking a filename cell.
  const [popupFile, setPopupFile] = useState<FileRecord | null>(null)

  return (
    <div className="zone">
      <div className="zone__head">
        <span className="zone__title">{TITLES[data?.view ?? view]}</span>
        <label className="search">
          <span className="search__icon" aria-hidden="true">⌕</span>
          <input
            className="search__input"
            type="search"
            placeholder={view === 'entities' ? '검색(이메일·파일)' : '검색…'}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="검색"
          />
        </label>
      </div>
      <div className="zone__body zone__body--table">
        {isError ? (
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
                <tr key={m.id}>
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
        ) : data.view === 'sessions' ? (
          <table className={tableClass}>
            <thead>
              <tr>
                <th>질의</th>
                <th>판정</th>
                <th>리스크</th>
                <th>완료시각</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr
                  key={s.id}
                  className={`table__row${selectedSessionId === s.id ? ' is-sel' : ''}`}
                  onClick={() => onSelectSession(s.id)}
                  aria-selected={selectedSessionId === s.id}
                >
                  <td className="table__name" title={s.query_text ?? ''}>
                    {s.query_text ?? '(질의 없음)'}
                  </td>
                  <td>
                    {s.status === 'completed' && s.verdict ? (
                      <VerdictBadge verdict={s.verdict} />
                    ) : (
                      <span className="table__path">{s.status}</span>
                    )}
                  </td>
                  <td className="table__num">{s.risk_score ?? '—'}</td>
                  <td className="table__num">{formatDate(s.completed_at)}</td>
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
                <tr
                  key={f.id}
                  className={`table__row${selectedFileId === f.id ? ' is-sel' : ''}`}
                  onClick={() => onSelectFile(f)}
                  onDoubleClick={(e) => {
                    if (isFilenameCellTarget(e.target)) setPopupFile(f)
                  }}
                  aria-selected={selectedFileId === f.id}
                >
                  <td className="table__name" data-cell="filename" title={f.filename}>
                    {f.filename}
                  </td>
                  <td><span className="table__cat">{categoryLabel(f.category)}</span></td>
                  <td className="table__num">{formatSize(f.file_size)}</td>
                  <td className="table__num">{formatDate(f.file_modified_at)}</td>
                  <td className="table__path" title={f.relative_path}>{f.relative_path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {popupFile && (
        <FileBodyModal file={popupFile} onClose={() => setPopupFile(null)} />
      )}
    </div>
  )
}
