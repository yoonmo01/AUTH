// Onboarding flow state machine (pure reducer).
// Gates the investigation console behind: landing → form → loading → console.
// Side-effect free so it can be unit tested in isolation.

export type FlowPhase = 'landing' | 'form' | 'etl' | 'loading' | 'console'

export interface InvestigationInput {
  evidenceRootPath: string
  name: string
  position: string
  hireDate: string
  resignationDate: string
  // true → 백엔드 에이전트를 호출하지 않고 번들된 더미 세션 JSON을 사용.
  // 개발 중 매번 그래프 분석을 돌리지 않고 콘솔 UI를 점검할 때 사용.
  dummy?: boolean
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
  | { type: 'ETL_DONE' }
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
      if (state.phase !== 'form') return state
      // 더미 모드: ETL/로딩 단계 전부 스킵하고 콘솔 직진
      if (event.input.dummy) {
        return {
          ...state,
          phase: 'console',
          input: event.input,
          sessionId: 'dummy-local',
          error: null,
        }
      }
      return { ...state, phase: 'etl', input: event.input, sessionId: null, error: null }

    case 'ETL_DONE':
      return state.phase === 'etl' ? { ...state, phase: 'loading' } : state

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
