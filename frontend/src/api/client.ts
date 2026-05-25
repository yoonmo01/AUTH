import type {
  Summary, FileRecord, EmailRecord, EntityRecord,
  GraphNode, GraphEdge, ActivityEvent, FileContent,
  Finding, Case, Session, AdminNarrative,
} from '../types'
import { resolveFixture } from '../fixtures'
import { resolveApiBase } from './apiBase'
import dummySession from '../dummy/session.json'

const BASE = resolveApiBase(import.meta.env.DEV)

// 더미 모드용 가짜 session_id. fetchSession이 이 값을 보면 백엔드를 거치지
// 않고 번들된 JSON을 반환한다.
export const DUMMY_SESSION_ID = 'dummy-local'

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

export const fetchFileRawText = (id: string): Promise<string> =>
  fetch(`${BASE}/files/${id}/raw`)
    .then((res) => {
      if (!res.ok) throw new Error(`원본 파일 조회 실패 (${res.status})`)
      return res.text()
    })

export const fetchFileRawBuffer = (id: string): Promise<ArrayBuffer> =>
  fetch(`${BASE}/files/${id}/raw`)
    .then((res) => {
      if (!res.ok) throw new Error(`원본 파일 조회 실패 (${res.status})`)
      return res.arrayBuffer()
    })

export const fileRawUrl = (id: string): string => `${BASE}/files/${id}/raw`

export const fetchConvertedBuffer = (id: string): Promise<ArrayBuffer> =>
  fetch(`${BASE}/files/${id}/converted`)
    .then((res) => {
      if (!res.ok) throw new Error(`변환 파일 조회 실패 (${res.status})`)
      return res.arrayBuffer()
    })

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

export const fetchSession = (id: string): Promise<Session> => {
  if (id === DUMMY_SESSION_ID) {
    return Promise.resolve(dummySession as unknown as Session)
  }
  return get(`/sessions/${id}`)
}

// ── Agent run ────────────────────────────────────────────────
// POST /agent/run returns {session_id} immediately (202) — backend starts agent in background.
// Use EventSource('/api/agent/events/{session_id}') to receive progress + completion events.
export interface AgentRunResult {
  session_id: string
}

export const runAgentAnalysis = (input: {
  name: string
  position: string
  hireDate: string
  resignationDate: string
  sessionId?: string
}): Promise<AgentRunResult> =>
  fetch(`${BASE}/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject_name: input.name,
      subject_position: input.position,
      hire_date: input.hireDate,
      resignation_date: input.resignationDate,
      session_id: input.sessionId,
    }),
  }).then((res) => {
    if (!res.ok) throw new Error(`에이전트 실행 실패 (${res.status})`)
    return res.json() as Promise<AgentRunResult>
  })

// ── 정기 점검 / 사원·관리자 API ─────────────────────────────

export interface LoginResponse {
  role: string
  employee_id?: string
  admin_id?: string
  name: string
  position?: string
  department?: string
}

export const postLogin = (body: {
  role: string
  id: string
  password?: string
}): Promise<LoginResponse> =>
  fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json() as Promise<LoginResponse>
  })

export const postAudit = (body: {
  employee_id: string
  quarter: string
  evidence_root_path?: string
}): Promise<{ session_id: string; status: string }> =>
  fetch(`${BASE}/audits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`audit 생성 실패 (${res.status})`)
    return res.json()
  })

export const postConsents = (
  sessionId: string,
  body: object,
): Promise<{ ok: boolean; count: number }> =>
  fetch(`${BASE}/sessions/${sessionId}/consents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`동의 저장 실패 (${res.status})`)
    return res.json()
  })

export const postExplanation = (
  sessionId: string,
  body: { employee_id: string; text: string },
): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/sessions/${sessionId}/explanations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`소명 제출 실패 (${res.status})`)
    return res.json()
  })

export const skipExplanation = (
  sessionId: string,
  body: { employee_id: string },
): Promise<{ ok: boolean; skipped: boolean }> =>
  fetch(`${BASE}/sessions/${sessionId}/explanations/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) throw new Error(`소명 생략 처리 실패 (${res.status})`)
    return res.json()
  })

export interface InboxEntry {
  session_id: string
  employee_id: string
  name: string
  position: string
  department: string
  quarter: string
  started_at: string
  completed_at: string | null
  verdict: string
  risk_score: string | number | null
  status: string
  submitted_at: string
  reviewed_at: string | null
  explanation_text: string | null
}

export const fetchInbox = (): Promise<InboxEntry[]> =>
  get('/admin/inbox')

export const markReviewed = (sessionId: string): Promise<{ ok: boolean }> =>
  fetch(`${BASE}/admin/inbox/${sessionId}/review`, { method: 'PATCH' }).then((res) => {
    if (!res.ok) throw new Error(`검토 처리 실패 (${res.status})`)
    return res.json()
  })

export const fetchAdminNarrative = (sessionId: string): Promise<AdminNarrative> =>
  fetch(`${BASE}/admin/sessions/${sessionId}/narrative`).then((res) => {
    if (!res.ok) throw new Error(`narrative 조회 실패 (${res.status})`)
    return res.json() as Promise<AdminNarrative>
  })
