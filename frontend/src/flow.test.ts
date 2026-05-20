import { describe, it, expect } from 'vitest'
import { flowReducer, initialFlowState, type FlowState, type InvestigationInput } from './flow'

const INPUT: InvestigationInput = {
  evidenceImagePath: 'C:/cases/hyena.E01',
  name: '김민수',
  position: '구매팀 대리',
  hireDate: '2021-03-02',
  resignationDate: '2026-05-09',
}

describe('flowReducer', () => {
  it('starts at the landing phase', () => {
    expect(initialFlowState.phase).toBe('landing')
  })

  it('landing + START → form', () => {
    const next = flowReducer(initialFlowState, { type: 'START' })
    expect(next.phase).toBe('form')
  })

  it('form + SUBMIT → loading and carries the input', () => {
    const form: FlowState = { ...initialFlowState, phase: 'form' }
    const next = flowReducer(form, { type: 'SUBMIT', input: INPUT })
    expect(next.phase).toBe('loading')
    expect(next.input).toEqual(INPUT)
    expect(next.error).toBeNull()
  })

  it('loading + ANALYSIS_COMPLETE → console and carries the session id', () => {
    const loading: FlowState = { ...initialFlowState, phase: 'loading' }
    const next = flowReducer(loading, { type: 'ANALYSIS_COMPLETE', sessionId: 's-1' })
    expect(next.phase).toBe('console')
    expect(next.sessionId).toBe('s-1')
  })

  it('loading + ANALYSIS_FAILED → form and preserves the error', () => {
    const loading: FlowState = { ...initialFlowState, phase: 'loading' }
    const next = flowReducer(loading, { type: 'ANALYSIS_FAILED', error: '분석 실패' })
    expect(next.phase).toBe('form')
    expect(next.error).toBe('분석 실패')
  })

  it('form + BACK → landing', () => {
    const form: FlowState = { ...initialFlowState, phase: 'form' }
    expect(flowReducer(form, { type: 'BACK' }).phase).toBe('landing')
  })

  it('RESET returns to the initial state from any phase', () => {
    const console: FlowState = { phase: 'console', sessionId: 's-9', error: null, input: INPUT }
    expect(flowReducer(console, { type: 'RESET' })).toEqual(initialFlowState)
  })

  it('is a no-op for undefined (phase, event) pairs', () => {
    const landing = initialFlowState
    // START only applies at landing — applying SUBMIT here changes nothing.
    expect(flowReducer(landing, { type: 'SUBMIT', input: INPUT })).toBe(landing)
    // ANALYSIS_COMPLETE only applies at loading.
    const form: FlowState = { ...initialFlowState, phase: 'form' }
    expect(flowReducer(form, { type: 'ANALYSIS_COMPLETE', sessionId: 's-1' })).toBe(form)
    // BACK only applies at form.
    const loading: FlowState = { ...initialFlowState, phase: 'loading' }
    expect(flowReducer(loading, { type: 'BACK' })).toBe(loading)
  })

  it('walks the full happy path landing → form → loading → console', () => {
    let s = initialFlowState
    s = flowReducer(s, { type: 'START' })
    s = flowReducer(s, { type: 'SUBMIT', input: INPUT })
    s = flowReducer(s, { type: 'ANALYSIS_COMPLETE', sessionId: 's-42' })
    expect(s.phase).toBe('console')
    expect(s.sessionId).toBe('s-42')
    expect(s.input).toEqual(INPUT)
  })
})
