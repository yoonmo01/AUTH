// Pure builder for export download filenames (verdict report PDF, network
// graph image). The date is passed in rather than read from the clock, so
// this stays side-effect free and unit testable.

export type DownloadKind = 'verdict-report' | 'network-graph'

export interface DownloadFilenameInput {
  kind: DownloadKind
  extension: string
  date: Date
  subjectName?: string
  verdict?: string
}

// Strip path separators, filesystem-reserved characters and control
// characters; collapse whitespace runs to a single underscore. Korean text
// and hyphens are kept.
function sanitizeSegment(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .replace(/\s+/g, '_')
}

function localDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function buildDownloadFilename(input: DownloadFilenameInput): string {
  const { kind, extension, date, subjectName, verdict } = input
  const dateStr = localDate(date)

  const segments =
    kind === 'verdict-report'
      ? ['판정리포트', subjectName, verdict]
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map(sanitizeSegment)
          .filter((s) => s.length > 0)
          .concat(dateStr)
      : ['네트워크그래프', dateStr]

  return `${segments.join('_')}.${extension}`
}
