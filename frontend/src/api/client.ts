import type {
  Summary, FileRecord, EmailRecord, EntityRecord,
  GraphNode, GraphEdge, ActivityEvent, FileContent,
  Finding, Case, Session,
} from '../types'
import { resolveFixture } from '../fixtures'

const BASE = '/api'

function orFixture<T>(path: string, reason: string): T {
  const fx = resolveFixture(path)
  if (fx === undefined) {
    throw new Error(`${reason}: ${path} (no fixture available)`)
  }
  console.warn(`[api] ${path}: 백엔드 미응답(${reason}) → 픽스처 폴백`)
  return fx as T
}

async function get<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`)
  } catch {
    // connection refused / network down → backend not running yet
    return orFixture<T>(path, 'network error')
  }
  if (res.ok) return (await res.json()) as T
  // 404 = endpoint not implemented yet.
  // 5xx = backend down — the Vite dev proxy surfaces an unreachable
  // target (:8000 not running) as a 500, so treat all 5xx as "no backend".
  if (res.status === 404 || res.status >= 500) {
    return orFixture<T>(path, `HTTP ${res.status}`)
  }
  // 4xx (bad request / auth) = a real client-side bug → surface it.
  throw new Error(`${res.status} ${res.statusText}: ${path}`)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return orFixture<T>(path, 'network error')
  }
  if (res.ok) return (await res.json()) as T
  if (res.status === 404 || res.status >= 500) {
    return orFixture<T>(path, `HTTP ${res.status}`)
  }
  throw new Error(`${res.status} ${res.statusText}: ${path}`)
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

// ── Sessions ─────────────────────────────────────────────────
export const fetchSessions = (): Promise<Session[]> =>
  get('/sessions')

export const fetchSession = (id: string): Promise<Session> =>
  get(`/sessions/${id}`)

// ── Investigation trigger ────────────────────────────────────
// Backend dependency: the trigger endpoint does not exist yet — the call
// falls back to a fixture (running session) until the backend ships it.
export interface InvestigationRequest {
  evidence_root_path: string
  subject: {
    name: string
    position: string
    hire_date: string
    resignation_date: string
  }
}

export interface SubmitResult {
  sessionId: string
  status: string
}

export const submitInvestigation = (req: InvestigationRequest): Promise<SubmitResult> =>
  post('/investigations', req)

export const pollSession = (id: string): Promise<Session> =>
  get(`/sessions/${id}`)
