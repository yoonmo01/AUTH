import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { fetchFiles } from '../api/client'
import { categoryLabel } from '../lib/categories'
import type { FileRecord } from '../types'
import type { TreeSelected } from './TreeViewer'

type Props = {
  category: TreeSelected
  query: string          // debounced search term
  search: string         // raw input value (controlled)
  onSearch: (v: string) => void
}

function formatSize(b: number | null): string {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 16)
}

export function ResultViewer({ category, query, search, onSearch }: Props) {
  const cat = category === 'all' ? undefined : category

  const { data, isLoading, isError, isFetching } = useQuery<FileRecord[]>({
    queryKey: ['files', category, query],
    queryFn: () => fetchFiles(query, cat),
    placeholderData: keepPreviousData,
  })

  const rows = data ?? []

  return (
    <div className="zone">
      <div className="zone__head">
        <span className="zone__title">RESULT · 파일 목록</span>
        <label className="search">
          <span className="search__icon" aria-hidden="true">⌕</span>
          <input
            className="search__input"
            type="search"
            placeholder="파일명 검색…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="파일 검색"
          />
        </label>
      </div>
      <div className="zone__body zone__body--table">
        {isError ? (
          <div className="table__msg">파일 목록 조회 실패 — 백엔드 응답을 확인하세요</div>
        ) : isLoading ? (
          <div className="table__msg">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="table__msg">표시할 파일이 없습니다</div>
        ) : (
          <table className={`table${isFetching ? ' is-fetching' : ''}`}>
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
              {rows.map((f) => (
                <tr key={f.id}>
                  <td className="table__name" title={f.filename}>{f.filename}</td>
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
    </div>
  )
}
