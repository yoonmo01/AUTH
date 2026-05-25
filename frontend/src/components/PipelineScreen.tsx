import { useEffect, useRef, useState } from 'react'
import { derivePipeline, totalDuration, type Stage, type StepStatus } from '../loadingProgress'

const TICK_MS = 150

type Props = {
  stages: Stage[]
  tag: string
  title: string
  onDone: () => void
}

const MARK: Record<StepStatus, string> = {
  done: '✔',
  active: '▸',
  pending: '·',
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * Timed pipeline progress screen — drives a stage list purely from elapsed
 * time (no backend telemetry). Used for both the ETL demo and the agent
 * pipeline. Calls onDone once when the timed sequence completes.
 */
export function PipelineScreen({ stages, tag, title, onDone }: Props) {
  const startRef = useRef(Date.now())
  const firedRef = useRef(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setElapsedMs(Date.now() - startRef.current), TICK_MS)
    return () => clearInterval(t)
  }, [])

  const { steps, done } = derivePipeline(stages, elapsedMs)

  useEffect(() => {
    if (done && !firedRef.current) {
      firedRef.current = true
      onDone()
    }
  }, [done, onDone])

  const total = totalDuration(stages)
  const pct = Math.min(100, Math.round((elapsedMs / total) * 100))

  return (
    <div className="load">
      <div className="load__beam" aria-hidden="true" />
      <div className="load__panel">
        <div className="load__panel-corner" aria-hidden="true" />
        <div className="load__head">
          <span className="load__tag">{tag}</span>
          <span className="load__clock">{formatElapsed(elapsedMs)}</span>
        </div>
        <h1 className="load__title">{title}</h1>

        <ol className="load__steps">
          {steps.map((step) => (
            <li key={step.id} className={`load__step load__step--${step.status}`}>
              <span className="load__mark" aria-hidden="true">
                {MARK[step.status]}
              </span>
              <span className="load__step-label">{step.label}</span>
            </li>
          ))}
        </ol>

        <div className="load__bar" aria-hidden="true">
          <div className="load__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
