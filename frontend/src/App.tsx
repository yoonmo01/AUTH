import { useReducer } from 'react'
import { flowReducer, initialFlowState } from './flow'
import { LandingScreen } from './components/LandingScreen'
import { InvestigationForm } from './components/InvestigationForm'
import { LoadingScreen } from './components/LoadingScreen'
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

    case 'loading':
      return (
        <LoadingScreen
          onComplete={(sessionId) => dispatch({ type: 'ANALYSIS_COMPLETE', sessionId })}
          onFail={(error) => dispatch({ type: 'ANALYSIS_FAILED', error })}
        />
      )

    case 'console':
      return <Console initialSessionId={flow.sessionId} />
  }
}

export default App
