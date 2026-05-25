export function formatSize(b: number | null): string {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(s: string | null): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 16)
}
