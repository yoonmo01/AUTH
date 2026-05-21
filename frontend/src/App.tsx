import { useReducer } from 'react'
import { flowReducer, initialFlowState } from './flow'
import { ETL_STAGES } from './loadingProgress'
import { LandingScreen } from './components/LandingScreen'
import { InvestigationForm } from './components/InvestigationForm'
import { PipelineScreen } from './components/PipelineScreen'
import { LoadingPhase } from './components/LoadingPhase'
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
          onSubmit={(input) => dispatch({ type: 'SUBMIT', input })}
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
          input={flow.input!}
          onDone={(sessionId) => dispatch({ type: 'ANALYSIS_COMPLETE', sessionId })}
        />
      )

    case 'console':
      return <Console initialSessionId={flow.sessionId} />
  }
}

export default App
