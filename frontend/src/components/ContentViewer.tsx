import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFileContent } from '../api/client'
import { NetworkViewer } from './NetworkViewer'
import { TimelineViewer } from './TimelineViewer'
import { sanitizeHtml } from '../sanitizeHtml'
import { formatSize, formatDate } from '../format'
import type { FileContent, FileRecord } from '../types'

const TABS = ['파일 본문', '네트워크', '타임라인', '판정'] as const

type Props = {
  selectedFile: FileRecord | null
}

function MetaBar({ file }: { file: FileRecord }) {
  const sha = file.sha256_hash ? `${file.sha256_hash.slice(0, 16)}…` : '—'
  return (
    <div className="meta">
      <span className="meta__cell"><b>SHA256</b> {sha}</span>
      <span className="meta__cell"><b>크기</b> {formatSize(file.file_size)}</span>
      <span className="meta__cell"><b>생성</b> {formatDate(file.file_created_at)}</span>
      <span className="meta__cell"><b>수정</b> {formatDate(file.file_modified_at)}</span>
      <span className="meta__cell"><b>접근</b> {formatDate(file.file_accessed_at)}</span>
    </div>
  )
}

function FileBody({ file }: { file: FileRecord }) {
  const { data, isLoading, isError } = useQuery<FileContent>({
    queryKey: ['file-content', file.id],
    queryFn: () => fetchFileContent(file.id),
  })

  if (isError) {
    return <div className="table__msg">본문 조회 실패 — 백엔드 응답을 확인하세요</div>
  }
  if (isLoading || !data) {
    return <div className="table__msg">본문 불러오는 중…</div>
  }

  return (
    <div className="content">
      <MetaBar file={file} />
      <div
        className="doc"
        // sanitizeHtml is a strict whitelist (no script/href/style/handlers).
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.html) }}
      />
    </div>
  )
}

export function ContentViewer({ selectedFile }: Props) {
  const [tab, setTab] = useState(0)

  return (
    <div className="zone">
      <div className="zone__tabs">
        {TABS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`t${i === tab ? ' t--on' : ''}`}
            onClick={() => setTab(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="zone__body zone__body--content">
        {tab === 0 ? (
          selectedFile ? (
            <FileBody file={selectedFile} />
          ) : (
            <div className="ph">
              <span className="ph__mark" aria-hidden="true">◇</span>
              <span className="ph__txt">파일 행을 선택하면 본문이 표시됩니다</span>
            </div>
          )
        ) : tab === 1 ? (
          <NetworkViewer />
        ) : tab === 2 ? (
          <TimelineViewer />
        ) : (
          <div className="ph">
            <span className="ph__mark" aria-hidden="true">◇</span>
            <span className="ph__txt">{TABS[tab]} — S9에서 구현</span>
          </div>
        )}
      </div>
    </div>
  )
}
