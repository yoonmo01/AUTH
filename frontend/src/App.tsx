import { useReducer } from 'react'
import { flowReducer, initialFlowState } from './flow'
import { ETL_STAGES } from './loadingProgress'
import { LoginScreen } from './components/LoginScreen'
import { EmployeeForm } from './components/EmployeeForm'
import { ConsentScreen } from './components/ConsentScreen'
import { LoadingPhase } from './components/LoadingPhase'
import { EmployeeReport } from './components/EmployeeReport'
import { PipelineScreen } from './components/PipelineScreen'
import { Console } from './components/Console'
import { AdminDashboard } from './components/AdminDashboard'
import { AdminSessionDetail } from './components/AdminSessionDetail'

function App() {
  const params = new URLSearchParams(window.location.search)
  const devSession = params.get('session')
  if (devSession) {
    return <Console initialSessionId={devSession} />
  }

  const [flow, dispatch] = useReducer(flowReducer, initialFlowState)

  switch (flow.phase) {
    case 'landing':
      return (
        <LoginScreen
          onLoginEmployee={(profile) => dispatch({ type: 'LOGIN_EMPLOYEE', profile })}
          onLoginAdmin={(profile) => dispatch({ type: 'LOGIN_ADMIN', profile })}
        />
      )

    case 'employee-form':
      return (
        <EmployeeForm
          profile={flow.employeeProfile!}
          onSubmit={(input, sessionId) => dispatch({ type: 'SUBMIT', input, sessionId })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      )

    case 'consent':
      return (
        <ConsentScreen
          sessionId={flow.sessionId!}
          employeeId={flow.employeeProfile!.employee_id}
          onDone={() => dispatch({ type: 'CONSENT_DONE' })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      )

    case 'etl':
      return (
        <PipelineScreen
          key="etl"
          stages={ETL_STAGES}
          tag="PHASE · DB 구축 (ETL)"
          title="데이터베이스 구축 중"
          onDone={() => dispatch({ type: 'ETL_DONE' })}
        />
      )

    case 'loading':
      return (
        <LoadingPhase
          sessionId={flow.sessionId!}
          name={flow.employeeProfile!.name}
          position={flow.employeeProfile!.position}
          onDone={(sid) => dispatch({ type: 'ANALYSIS_COMPLETE', sessionId: sid })}
        />
      )

    case 'employee-report':
      return (
        <EmployeeReport
          sessionId={flow.sessionId!}
          employeeId={flow.employeeProfile!.employee_id}
          employeeName={flow.employeeProfile!.name}
          quarter={flow.input!.quarter}
          onSubmitted={() => dispatch({ type: 'EXPLANATION_SUBMITTED' })}
        />
      )

    case 'submitted':
      return (
        <div className="subdone">
          <div className="subdone__panel">
            <h2 className="subdone__title">제출 완료</h2>
            <p className="subdone__text">소명이 관리자에게 전달되었습니다.</p>
            <button className="subdone__btn" onClick={() => dispatch({ type: 'RESET' })}>
              처음으로
            </button>
          </div>
        </div>
      )

    case 'admin-dashboard':
      return (
        <AdminDashboard
          adminName={flow.adminProfile?.name ?? '관리자'}
          onOpenSession={(sessionId) => dispatch({ type: 'OPEN_SESSION', sessionId })}
          onLogout={() => dispatch({ type: 'RESET' })}
        />
      )

    case 'admin-detail':
      return (
        <AdminSessionDetail
          sessionId={flow.sessionId!}
          onBack={() => dispatch({ type: 'BACK_TO_DASHBOARD' })}
        />
      )

    case 'console':
      return <Console initialSessionId={flow.sessionId} />
  }
}

export default App
