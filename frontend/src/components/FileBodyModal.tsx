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
  highlightKeywords?: string[]
}

// Walk sanitized HTML DOM and wrap keyword occurrences in <mark data-label="suspicious">.
function addKeywordHighlights(html: string, keywords: string[]): string {
  const kws = keywords.filter(Boolean)
  if (!kws.length) return html
  const pattern = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`(${pattern})`, 'gi')

  const doc = new DOMParser().parseFromString(html, 'text/html')

  function walk(node: Node) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? ''
      if (!re.test(text)) return
      re.lastIndex = 0
      const frag = doc.createDocumentFragment()
      let last = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)))
        const mark = doc.createElement('mark')
        mark.setAttribute('data-label', 'suspicious')
        mark.textContent = m[0]
        frag.appendChild(mark)
        last = m.index + m[0].length
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)))
      node.parentNode?.replaceChild(frag, node)
      return
    }
    if (node.nodeType === 1 && (node as Element).tagName?.toLowerCase() === 'mark') return
    // iterate over a snapshot — childNodes is live
    Array.from(node.childNodes).forEach(walk)
  }

  walk(doc.body)
  return doc.body.innerHTML
}

// Split plain text into segments and render <mark> around keyword matches.
function HighlightedPre({ text, keywords }: { text: string; keywords: string[] }) {
  const kws = keywords.filter(Boolean)
  if (!kws.length) return <pre className="doc doc--raw">{text}</pre>
  const pattern = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`(${pattern})`, 'gi')
  const parts: { t: string; hi: boolean }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), hi: false })
    parts.push({ t: m[0], hi: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ t: text.slice(last), hi: false })
  return (
    <pre className="doc doc--raw">
      {parts.map((p, i) =>
        p.hi ? <mark key={i} data-label="suspicious">{p.t}</mark> : p.t,
      )}
    </pre>
  )
}

function KeywordBadges({ keywords }: { keywords: string[] }) {
  if (!keywords.length) return null
  return (
    <div className="kw-badges">
      <span className="kw-badges__label">매칭 키워드</span>
      {keywords.map((k) => (
        <span key={k} className="kw-badges__tag">{k}</span>
      ))}
    </div>
  )
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

function RawTextViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const { data, isLoading, isError } = useQuery<string>({
    queryKey: ['file-raw', file.id],
    queryFn: () => fetchFileRawText(file.id),
  })
  if (isError)           return <div className="table__msg">원본 파일 조회 실패</div>
  if (isLoading || !data) return <div className="table__msg">불러오는 중…</div>
  return (
    <>
      <MetaBar file={file} />
      <HighlightedPre text={data} keywords={keywords} />
    </>
  )
}

function ChunkViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const { data, isLoading, isError } = useQuery<FileContent>({
    queryKey: ['file-content', file.id],
    queryFn: () => fetchFileContent(file.id),
  })
  if (isError)           return <div className="table__msg">미리보기 불가 — 내용이 추출되지 않은 파일입니다</div>
  if (isLoading || !data) return <div className="table__msg">본문 불러오는 중…</div>
  const html = keywords.length
    ? addKeywordHighlights(sanitizeHtml(data.html), keywords)
    : sanitizeHtml(data.html)
  return (
    <>
      <MetaBar file={file} />
      <div className="doc" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}

function ModalBody({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const ext = (file.extension ?? '').toLowerCase()
  if (IMAGE_EXTS.has(ext)) return <ImageViewer file={file} />
  if (TEXT_EXTS.has(ext))  return <RawTextViewer file={file} keywords={keywords} />
  return <ChunkViewer file={file} keywords={keywords} />
}

export function FileBodyModal({ file, onClose, highlightKeywords = [] }: Props) {
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
        {highlightKeywords.length > 0 && (
          <KeywordBadges keywords={highlightKeywords} />
        )}
        <div className="modal__body">
          <ModalBody file={file} keywords={highlightKeywords} />
        </div>
      </div>
    </div>
  )
}
