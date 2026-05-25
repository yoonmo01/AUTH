import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFiles } from '../api/client'
import { FileBodyModal } from './FileBodyModal'
import type { FileRecord } from '../types'

const EXT_PRESETS = [
  { ext: 'doc' }, { ext: 'hwp' }, { ext: 'docx' },
  { ext: 'xlsx' }, { ext: 'xls' }, { ext: 'pdf' },
  { ext: 'txt' }, { ext: 'png' }, { ext: 'm4a' },
]

const inputStyle: React.CSSProperties = {
  padding: '7px 12px', background: '#1a1f2e', border: '1px solid #2d3748',
  color: '#e2e8f0', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box',
}

export function TestViewer() {
  const [ext, setExt] = useState('doc')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<FileRecord | null>(null)
  const [directId, setDirectId] = useState('')
  const [directError, setDirectError] = useState('')

  async function loadById() {
    const id = directId.trim()
    if (!id) return
    setDirectError('')
    try {
      const res = await fetch(`/api/files/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const f = await res.json() as FileRecord
      setSelected(f)
    } catch (e) {
      setDirectError(String(e))
    }
  }

  const searchQ = query.trim() || '.'
  const { data: files, isLoading, isError } = useQuery<FileRecord[]>({
    queryKey: ['test-files', ext, searchQ],
    queryFn: () => fetchFiles(searchQ, undefined, 80),
    select: (rows) => rows.filter((f) => (f.extension ?? '').toLowerCase() === `.${ext}`),
  })

  return (
    <div style={{ padding: '24px', fontFamily: 'monospace', background: '#0f1117', minHeight: '100vh', color: '#e2e8f0' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '16px', color: '#7eb8f7' }}>File Viewer Test</h2>

      {/* ID 직접 입력 */}
      <div style={{ marginBottom: '24px', padding: '12px 16px', background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '6px' }}>
        <div style={{ fontSize: '11px', color: '#718096', marginBottom: '8px' }}>FILE ID 직접 열기</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="file UUID 붙여넣기"
            value={directId}
            onChange={(e) => setDirectId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadById()}
          />
          <button
            onClick={loadById}
            style={{ ...inputStyle, cursor: 'pointer', color: '#7eb8f7', borderColor: '#7eb8f7' }}
          >
            열기
          </button>
        </div>
        {directError && <div style={{ color: '#fc8181', fontSize: '12px', marginTop: '6px' }}>{directError}</div>}
      </div>

      {/* 확장자 필터 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {EXT_PRESETS.map((p) => (
          <button
            key={p.ext}
            onClick={() => setExt(p.ext)}
            style={{
              padding: '4px 12px', border: '1px solid',
              borderColor: ext === p.ext ? '#7eb8f7' : '#2d3748',
              background: ext === p.ext ? '#1a3050' : '#1a1f2e',
              color: ext === p.ext ? '#7eb8f7' : '#a0aec0',
              borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            .{p.ext}
          </button>
        ))}
      </div>

      {/* 검색 */}
      <input
        type="search"
        placeholder="파일명 검색 (빈칸이면 전체 80개)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, width: '100%', maxWidth: '400px', marginBottom: '12px' }}
      />

      {/* 파일 목록 */}
      {isLoading && <div style={{ color: '#718096' }}>불러오는 중…</div>}
      {isError  && <div style={{ color: '#fc8181' }}>파일 조회 실패</div>}
      {files?.length === 0 && <div style={{ color: '#718096' }}>.{ext} 파일 없음</div>}
      {files && files.length > 0 && (
        <div style={{ fontSize: '11px', color: '#4a5568', marginBottom: '8px' }}>{files.length}개</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {files?.map((f) => (
          <button
            key={f.id}
            onClick={() => setSelected(f)}
            style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center', gap: '12px',
              padding: '7px 12px', background: '#1a1f2e',
              border: '1px solid #2d3748', borderRadius: '4px',
              color: '#e2e8f0', cursor: 'pointer', textAlign: 'left', fontSize: '13px',
            }}
          >
            <span style={{ color: '#7eb8f7' }}>{f.filename}</span>
            <span style={{ color: '#4a5568', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.relative_path}
            </span>
            <span style={{ color: '#2d3748', fontSize: '10px', flexShrink: 0 }}>{f.id.slice(0, 8)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <FileBodyModal file={selected} onClose={() => setSelected(null)} highlightKeywords={[]} />
      )}
    </div>
  )
}
