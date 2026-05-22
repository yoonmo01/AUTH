export type FlowPhase =
  | 'landing'
  | 'employee-form'
  | 'consent'
  | 'etl'
  | 'loading'
  | 'employee-report'
  | 'submitted'
  | 'admin-dashboard'
  | 'admin-detail'
  | 'console'

export interface EmployeeProfile {
  employee_id: string
  name: string
  position: string
  department: string
}

export interface AdminProfile {
  admin_id: string
  name: string
}

export interface EmployeeInput {
  evidenceRootPath: string
  employee_id: string
  quarter: string
}

// Legacy onboarding form type retained for old validators/tests that are no
// longer mounted by App.tsx. The employee flow now uses EmployeeInput.
export interface InvestigationInput {
  evidenceRootPath: string
  name: string
  position: string
  hireDate: string
  resignationDate: string
  dummy?: boolean
}

export interface FlowState {
  phase: FlowPhase
  sessionId: string | null
  error: string | null
  input: EmployeeInput | null
  role: 'employee' | 'admin' | null
  employeeProfile: EmployeeProfile | null
  adminProfile: AdminProfile | null
}

export type FlowEvent =
  | { type: 'LOGIN_EMPLOYEE'; profile: EmployeeProfile }
  | { type: 'LOGIN_ADMIN'; profile: AdminProfile }
  | { type: 'SUBMIT'; input: EmployeeInput; sessionId: string }
  | { type: 'CONSENT_DONE' }
  | { type: 'ETL_DONE' }
  | { type: 'ANALYSIS_COMPLETE'; sessionId: string | null }
  | { type: 'ANALYSIS_FAILED'; error: string }
  | { type: 'EXPLANATION_SUBMITTED' }
  | { type: 'OPEN_SESSION'; sessionId: string }
  | { type: 'BACK_TO_DASHBOARD' }
  | { type: 'BACK' }
  | { type: 'RESET' }

export const initialFlowState: FlowState = {
  phase: 'landing',
  sessionId: null,
  error: null,
  input: null,
  role: null,
  employeeProfile: null,
  adminProfile: null,
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'LOGIN_EMPLOYEE':
      if (state.phase !== 'landing') return state
      return { ...state, phase: 'employee-form', role: 'employee', employeeProfile: event.profile }

    case 'LOGIN_ADMIN':
      if (state.phase !== 'landing') return state
      return { ...state, phase: 'admin-dashboard', role: 'admin', adminProfile: event.profile }

    case 'SUBMIT':
      if (state.phase !== 'employee-form') return state
      return { ...state, phase: 'consent', sessionId: event.sessionId, input: event.input }

    case 'CONSENT_DONE':
      return state.phase === 'consent' ? { ...state, phase: 'etl' } : state

    case 'ETL_DONE':
      return state.phase === 'etl' ? { ...state, phase: 'loading' } : state

    case 'ANALYSIS_COMPLETE':
      return state.phase === 'loading'
        ? { ...state, phase: 'employee-report', sessionId: event.sessionId, error: null }
        : state

    case 'ANALYSIS_FAILED':
      return state.phase === 'loading'
        ? { ...state, phase: 'employee-form', error: event.error }
        : state

    case 'EXPLANATION_SUBMITTED':
      return state.phase === 'employee-report' ? { ...state, phase: 'submitted' } : state

    case 'OPEN_SESSION':
      return state.phase === 'admin-dashboard'
        ? { ...state, phase: 'admin-detail', sessionId: event.sessionId }
        : state

    case 'BACK_TO_DASHBOARD':
      return state.phase === 'admin-detail'
        ? { ...state, phase: 'admin-dashboard', sessionId: null }
        : state

    case 'BACK':
      if (state.phase === 'employee-form') return { ...state, phase: 'landing' }
      if (state.phase === 'consent') return { ...state, phase: 'employee-form' }
      return state

    case 'RESET':
      return initialFlowState

    default:
      return state
  }
}
