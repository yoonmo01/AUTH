import { useEffect, useRef, useState } from 'react'
import { PipelineScreen } from './PipelineScreen'
import { AGENT_STAGES } from '../loadingProgress'
import type { InvestigationInput } from '../flow'

type Props = {
  input: InvestigationInput
  onDone: (sessionId: string | null) => void
}

export function LoadingPhase({ input: _input, onDone }: Props) {
  const [animDone, setAnimDone] = useState(false)
  const calledRef = useRef(false)

  useEffect(() => {
    if (animDone && !calledRef.current) {
      calledRef.current = true
      onDone(null)
    }
  }, [animDone, onDone])

  return (
    <PipelineScreen
      key="loading"
      stages={AGENT_STAGES}
      tag="PHASE · 에이전트 분석"
      title="수사 분석 진행 중"
      onDone={() => setAnimDone(true)}
    />
  )
}
