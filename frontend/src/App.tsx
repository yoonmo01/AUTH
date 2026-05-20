import { useReducer } from 'react'
import { flowReducer, initialFlowState } from './flow'
import { ETL_STAGES, AGENT_STAGES } from './loadingProgress'
import { LandingScreen } from './components/LandingScreen'
import { InvestigationForm } from './components/InvestigationForm'
import { PipelineScreen } from './components/PipelineScreen'
import { Console } from './components/Console'

// App shell — gates the investigation console behind the onboarding flow.
// The flow state machine (./flow) drives which screen renders.
function App() {
  const [flow, dispatch] = useReducer(flowReducer, initialFlowState)

  switch (flow.phase) {
    case 'landing':
      return <LandingScreen onStart={() => dispatch({ type: 'START' })} />

    case 'form':
      return (
        <InvestigationForm
          onSubmit={(input, sessionId) => dispatch({ type: 'SUBMIT', input, sessionId })}
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
        <PipelineScreen
          key="loading"
          stages={AGENT_STAGES}
          tag="PHASE · 에이전트 분석"
          title="수사 분석 진행 중"
          onDone={() => dispatch({ type: 'ANALYSIS_COMPLETE', sessionId: flow.sessionId })}
        />
      )

    case 'console':
      return <Console initialSessionId={flow.sessionId} />
  }
}

export default App
