import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchFileContent,
  fetchFileRawBuffer,
  fetchFileRawText,
  fetchConvertedBuffer,
  fileRawUrl,
} from '../api/client'
import { sanitizeHtml } from '../sanitizeHtml'
import { formatSize, formatDate } from '../format'
import type { FileContent, FileRecord } from '../types'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tiff'])
const TEXT_EXTS  = new Set(['.txt', '.csv', '.log'])
const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.wav', '.ogg'])
const PDF_EXTS   = new Set(['.pdf'])
const XLSX_EXTS  = new Set(['.xlsx', '.xls', '.xlsm'])
const DOCX_EXTS  = new Set(['.docx'])
const DOC_EXTS   = new Set(['.doc'])
const HWP_EXTS   = new Set(['.hwp', '.hwpx'])

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
        <img src={fileRawUrl(file.id)} alt={file.filename} style={{ maxWidth: '100%' }} />
      </div>
    </>
  )
}

function AudioViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  return (
    <>
      <MetaBar file={file} />
      <div className="doc doc--audio">
        <audio controls src={fileRawUrl(file.id)} preload="metadata">
          브라우저가 오디오 재생을 지원하지 않습니다.
        </audio>
        <p className="doc__hint">⬆ 재생 · ⬇ 음성 인식(STT) 결과</p>
      </div>
      <ChunkViewer file={file} keywords={keywords} />
    </>
  )
}

function PdfViewer({ file }: { file: FileRecord }) {
  return (
    <>
      <MetaBar file={file} />
      <div className="doc doc--pdf">
        <iframe
          src={fileRawUrl(file.id)}
          title={file.filename}
          className="doc__pdf-frame"
        />
      </div>
    </>
  )
}

function XlsxViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ read, utils }, buf] = await Promise.all([
          import('xlsx'),
          fetchFileRawBuffer(file.id),
        ])
        if (cancelled) return
        const wb = read(buf, { type: 'array' })
        const parsed = wb.SheetNames.map((name) => ({
          name,
          html: utils.sheet_to_html(wb.Sheets[name], { header: '', footer: '' }),
        }))
        if (!cancelled) setSheets(parsed)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '시트 변환 실패')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file.id])

  if (error) {
    return (
      <>
        <MetaBar file={file} />
        <div className="table__msg">원본 시트 변환 실패 — 추출 텍스트로 대체합니다.</div>
        <ChunkViewer file={file} keywords={keywords} />
      </>
    )
  }
  if (!sheets) return <div className="table__msg">시트 불러오는 중…</div>

  const current = sheets[activeSheet]
  const html = keywords.length
    ? addKeywordHighlights(sanitizeHtml(current.html), keywords)
    : sanitizeHtml(current.html)

  return (
    <>
      <MetaBar file={file} />
      {sheets.length > 1 && (
        <div className="doc__sheet-tabs">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              className={`doc__sheet-tab${i === activeSheet ? ' doc__sheet-tab--active' : ''}`}
              onClick={() => setActiveSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="doc doc--xlsx" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}

function DocxViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [mammoth, buf] = await Promise.all([
          import('mammoth/mammoth.browser'),
          fetchFileRawBuffer(file.id),
        ])
        if (cancelled) return
        const result = await mammoth.convertToHtml({ arrayBuffer: buf })
        if (!cancelled) setHtml(result.value)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'docx 변환 실패')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file.id])

  if (error) {
    return (
      <>
        <MetaBar file={file} />
        <div className="table__msg">원본 문서 변환 실패 — 추출 텍스트로 대체합니다.</div>
        <ChunkViewer file={file} keywords={keywords} />
      </>
    )
  }
  if (html === null) return <div className="table__msg">문서 불러오는 중…</div>

  const safe = keywords.length
    ? addKeywordHighlights(sanitizeHtml(html), keywords)
    : sanitizeHtml(html)

  return (
    <>
      <MetaBar file={file} />
      <div className="doc doc--docx" dangerouslySetInnerHTML={{ __html: safe }} />
    </>
  )
}

function DocConvertedViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ renderAsync }, buf] = await Promise.all([
          import('docx-preview'),
          fetchConvertedBuffer(file.id),
        ])
        if (cancelled || !containerRef.current) return
        await renderAsync(buf, containerRef.current, undefined, {
          className: 'docx-body',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        })
        if (!cancelled) setHtml('ok')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '변환 문서 렌더 실패')
      }
    })()
    return () => { cancelled = true }
  }, [file.id])

  if (error) {
    return (
      <>
        <MetaBar file={file} />
        <div className="table__msg">원본 문서 변환 실패 — 추출 텍스트로 대체합니다.</div>
        <ChunkViewer file={file} keywords={keywords} />
      </>
    )
  }
  return (
    <>
      <MetaBar file={file} />
      {html === null && <div className="table__msg">문서 불러오는 중…</div>}
      <div className="doc doc--docx" ref={containerRef} />
    </>
  )
}

function HwpViewer({ file, keywords }: { file: FileRecord; keywords: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ Viewer }, buf] = await Promise.all([
          import('hwp.js'),
          fetchConvertedBuffer(file.id),
        ])
        if (cancelled || !containerRef.current) return
        new Viewer(containerRef.current, new Uint8Array(buf))
        if (!cancelled) setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'HWP 렌더 실패')
      }
    })()
    return () => { cancelled = true }
  }, [file.id])

  if (error) {
    return (
      <>
        <MetaBar file={file} />
        <div className="table__msg">HWP 미리보기 불가 — 추출 텍스트로 대체합니다.</div>
        <ChunkViewer file={file} keywords={keywords} />
      </>
    )
  }
  return (
    <>
      <MetaBar file={file} />
      {!ready && <div className="table__msg">HWP 불러오는 중…</div>}
      <div className="doc doc--hwp" ref={containerRef} />
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
  if (AUDIO_EXTS.has(ext)) return <AudioViewer file={file} keywords={keywords} />
  if (PDF_EXTS.has(ext))   return <PdfViewer file={file} />
  if (XLSX_EXTS.has(ext))  return <XlsxViewer file={file} keywords={keywords} />
  if (DOCX_EXTS.has(ext))  return <DocxViewer file={file} keywords={keywords} />
  if (DOC_EXTS.has(ext))   return <DocConvertedViewer file={file} keywords={keywords} />
  if (HWP_EXTS.has(ext))   return <HwpViewer file={file} keywords={keywords} />
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
