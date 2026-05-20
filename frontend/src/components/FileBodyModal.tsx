import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFileContent } from '../api/client'
import { sanitizeHtml } from '../sanitizeHtml'
import { formatSize, formatDate } from '../format'
import type { FileContent, FileRecord } from '../types'

type Props = {
  file: FileRecord
  onClose: () => void
}

function MetaBar({ file }: { file: FileRecord }) {
  const sha = file.sha256_hash ? `${file.sha256_hash.slice(0, 16)}…` : '—'
  return (
    <div className="meta">
      <span className="meta__cell"><b>SHA256</b> {sha}</span>
      <span className="meta__cell"><b>크기</b> {formatSize(file.file_size)}</span>
      <span className="meta__cell"><b>수정</b> {formatDate(file.file_modified_at)}</span>
      <span className="meta__cell"><b>접근</b> {formatDate(file.file_accessed_at)}</span>
    </div>
  )
}

function ModalBody({ file }: { file: FileRecord }) {
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
    <>
      <MetaBar file={file} />
      <div
        className="doc"
        // sanitizeHtml is a strict whitelist (no script/href/style/handlers).
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.html) }}
      />
    </>
  )
}

export function FileBodyModal({ file, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={file.filename}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <span className="modal__title" title={file.filename}>{file.filename}</span>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>
        <div className="modal__body">
          <ModalBody file={file} />
        </div>
      </div>
    </div>
  )
}
