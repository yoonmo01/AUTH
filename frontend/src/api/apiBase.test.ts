import { describe, it, expect } from 'vitest'
import { resolveApiBase } from './apiBase'

describe('resolveApiBase', () => {
  it('dev mode → Vite dev-server proxy path', () => {
    expect(resolveApiBase(true)).toBe('/api')
  })

  it('packaged build → backend absolute URL', () => {
    expect(resolveApiBase(false)).toBe('http://localhost:8000')
  })
})
