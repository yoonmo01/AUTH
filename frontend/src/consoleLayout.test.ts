import { describe, it, expect } from 'vitest'
import { toggleLayout, initialConsoleLayout } from './consoleLayout'

describe('consoleLayout', () => {
  it('starts focused', () => {
    expect(initialConsoleLayout).toBe('focused')
  })

  it('toggles focused → expanded', () => {
    expect(toggleLayout('focused')).toBe('expanded')
  })

  it('toggles expanded → focused', () => {
    expect(toggleLayout('expanded')).toBe('focused')
  })

  it('returns to the original mode after two toggles', () => {
    expect(toggleLayout(toggleLayout('focused'))).toBe('focused')
    expect(toggleLayout(toggleLayout('expanded'))).toBe('expanded')
  })
})
