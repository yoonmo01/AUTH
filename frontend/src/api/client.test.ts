import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSummary, fetchSessions, submitInvestigation, pollSession } from './client'

const REQUEST = {
  evidence_root_path: 'HYENA_C드라이브',
  subject: {
    name: '김민수',
    position: '구매팀 대리',
    hire_date: '2021-03-02',
    resignation_date: '2026-05-09',
  },
}

function mockFetch(impl: () => Promise<unknown> | never) {
  vi.stubGlobal('fetch', vi.fn(impl as () => Promise<Response>))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api client fixture fallback', () => {
  it('passes live data through on 200 (no fixture, no warn)', async () => {
    const live = {
      files: 7, emails: 7, documents: 7, activities: 7,
      entities: 7, chunks: 7, relations: 7, etl_status: [],
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => live,
    }))

    const out = await fetchSummary()

    expect(out).toEqual(live)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to the fixture on 404 with exactly one console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    }))

    const out = await fetchSummary()

    expect(typeof out.files).toBe('number')
    expect(out.files).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('falls back to the fixture on network failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:8000')
    })

    const out = await fetchSessions()

    expect(Array.isArray(out)).toBe(true)
    expect(out.length).toBeGreaterThan(0)
  })

  it('falls back on 5xx (Vite proxy surfaces a downed backend as 500)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    }))

    const out = await fetchSummary()

    expect(typeof out.files).toBe('number')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('throws on 4xx client errors instead of masking with a fixture', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({}),
    }))

    await expect(fetchSummary()).rejects.toThrow(/400/)
  })
})

describe('submitInvestigation', () => {
  it('passes live data through on a 201 (no fixture, no warn)', async () => {
    const live = { sessionId: 's-live-1', status: 'running' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({ ok: true, status: 201, json: async () => live }))

    const out = await submitInvestigation(REQUEST)

    expect(out).toEqual(live)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to the fixture on 404 with exactly one console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    }))

    const out = await submitInvestigation(REQUEST)

    expect(typeof out.sessionId).toBe('string')
    expect(out.status).toBe('running')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('falls back to the fixture on network failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:8000')
    })

    const out = await submitInvestigation(REQUEST)

    expect(typeof out.sessionId).toBe('string')
  })

  it('falls back on 5xx (downed backend surfaced as 500)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    }))

    const out = await submitInvestigation(REQUEST)

    expect(typeof out.sessionId).toBe('string')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('pollSession', () => {
  it('falls back to the session fixture when the backend is down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:8000')
    })

    const out = await pollSession('s-9001')

    expect(out.id).toBeDefined()
    expect(out.status).toBeDefined()
  })
})
