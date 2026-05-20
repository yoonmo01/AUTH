// Onboarding flow state machine (pure reducer).
// Gates the investigation console behind: landing → form → loading → console.
// Side-effect free so it can be unit tested in isolation.

export type FlowPhase = 'landing' | 'form' | 'loading' | 'console'

export interface InvestigationInput {
  evidenceImagePath: string
  name: string
  position: string
  hireDate: string
  resignationDate: string
}

export interface FlowState {
  phase: FlowPhase
  sessionId: string | null
  error: string | null
  input: InvestigationInput | null
}

export type FlowEvent =
  | { type: 'START' }
  | { type: 'SUBMIT'; input: InvestigationInput }
  | { type: 'ANALYSIS_COMPLETE'; sessionId: string | null }
  | { type: 'ANALYSIS_FAILED'; error: string }
  | { type: 'BACK' }
  | { type: 'RESET' }

export const initialFlowState: FlowState = {
  phase: 'landing',
  sessionId: null,
  error: null,
  input: null,
}

/**
 * Advance the onboarding flow. Any (phase, event) pair that is not an
 * explicit transition below is a no-op — the state is returned unchanged.
 */
export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'START':
      return state.phase === 'landing' ? { ...state, phase: 'form' } : state

    case 'SUBMIT':
      return state.phase === 'form'
        ? { ...state, phase: 'loading', input: event.input, error: null }
        : state

    case 'ANALYSIS_COMPLETE':
      return state.phase === 'loading'
        ? { ...state, phase: 'console', sessionId: event.sessionId, error: null }
        : state

    case 'ANALYSIS_FAILED':
      return state.phase === 'loading'
        ? { ...state, phase: 'form', error: event.error }
        : state

    case 'BACK':
      return state.phase === 'form' ? { ...state, phase: 'landing' } : state

    case 'RESET':
      return initialFlowState

    default:
      return state
  }
}
