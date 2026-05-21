import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFileContent, fetchFileRawText } from '../api/client'
import { sanitizeHtml } from '../sanitizeHtml'
import { formatSize, formatDate } from '../format'
import type { FileContent, FileRecord } from '../types'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tiff'])
const TEXT_EXTS  = new Set(['.txt', '.csv', '.log'])

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

function ImageViewer({ file }: { file: FileRecord }) {
  return (
    <>
      <MetaBar file={file} />
      <div className="doc doc--img">
        <img src={`/api/files/${file.id}/raw`} alt={file.filename} style={{ maxWidth: '100%' }} />
      </div>
    </>
  )
}

function RawTextViewer({ file }: { file: FileRecord }) {
  const { data, isLoading, isError } = useQuery<string>({
    queryKey: ['file-raw', file.id],
    queryFn: () => fetchFileRawText(file.id),
  })
  if (isError)          return <div className="table__msg">원본 파일 조회 실패</div>
  if (isLoading || !data) return <div className="table__msg">불러오는 중…</div>
  return (
    <>
      <MetaBar file={file} />
      <pre className="doc doc--raw">{data}</pre>
    </>
  )
}

function ChunkViewer({ file }: { file: FileRecord }) {
  const { data, isLoading, isError } = useQuery<FileContent>({
    queryKey: ['file-content', file.id],
    queryFn: () => fetchFileContent(file.id),
  })
  if (isError)           return <div className="table__msg">미리보기 불가 — 내용이 추출되지 않은 파일입니다</div>
  if (isLoading || !data) return <div className="table__msg">본문 불러오는 중…</div>
  return (
    <>
      <MetaBar file={file} />
      <div
        className="doc"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.html) }}
      />
    </>
  )
}

function ModalBody({ file }: { file: FileRecord }) {
  const ext = (file.extension ?? '').toLowerCase()
  if (IMAGE_EXTS.has(ext)) return <ImageViewer file={file} />
  if (TEXT_EXTS.has(ext))  return <RawTextViewer file={file} />
  return <ChunkViewer file={file} />
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
