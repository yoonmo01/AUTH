import type {
  Summary, FileRecord, EmailRecord, EntityRecord,
  GraphNode, GraphEdge, ActivityEvent, FileContent,
  Finding, Case,
} from '../types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`)
  return res.json() as Promise<T>
}

// ── Summary ──────────────────────────────────────────────────
export const fetchSummary = (): Promise<Summary> =>
  get('/summary')

// ── Files ────────────────────────────────────────────────────
export const fetchFiles = (q: string, category?: string, limit = 50): Promise<FileRecord[]> => {
  const params = new URLSearchParams({ q, limit: String(limit) })
  if (category) params.set('category', category)
  return get(`/search/files?${params}`)
}

export const fetchFile = (id: string): Promise<FileRecord> =>
  get(`/files/${id}`)

export const fetchFileContent = (id: string): Promise<FileContent> =>
  get(`/files/${id}/content`)

// ── Emails ───────────────────────────────────────────────────
export const fetchEmails = (q: string, limit = 50): Promise<EmailRecord[]> => {
  const params = new URLSearchParams({ q, limit: String(limit) })
  return get(`/search/emails?${params}`)
}

export const fetchEmail = (id: string): Promise<EmailRecord> =>
  get(`/emails/${id}`)

// ── Entities ─────────────────────────────────────────────────
export const fetchEntities = (entityType?: string, limit = 100): Promise<EntityRecord[]> => {
  const params = new URLSearchParams({ limit: String(limit) })
  if (entityType) params.set('entity_type', entityType)
  return get(`/entities?${params}`)
}

// ── Graph (Network) ──────────────────────────────────────────
export const fetchGraphNodes = (limit = 500): Promise<GraphNode[]> =>
  get(`/graph/nodes?limit=${limit}`)

export const fetchEmailEdges = (limit = 500): Promise<GraphEdge[]> =>
  get(`/graph/edges/email?limit=${limit}`)

export const fetchActivityEdges = (limit = 500): Promise<GraphEdge[]> =>
  get(`/graph/edges/activity?limit=${limit}`)

// ── Timeline ─────────────────────────────────────────────────
export const fetchTimeline = (limit = 200): Promise<ActivityEvent[]> =>
  get(`/timeline?limit=${limit}`)

// ── Cases & Findings ─────────────────────────────────────────
export const fetchCases = (): Promise<Case[]> =>
  get('/cases')

export const fetchCase = (id: string): Promise<Case> =>
  get(`/cases/${id}`)

export const fetchFindings = (sessionId: string): Promise<Finding[]> =>
  get(`/sessions/${sessionId}/findings`)
