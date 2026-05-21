import { useEffect, useRef, useState } from 'react'
import { runAgentAnalysis } from '../api/client'
import type { InvestigationInput } from '../flow'

type Props = {
  input: InvestigationInput
  onDone: (sessionId: string | null) => void
}

const LIVE_STEPS = [
  { id: 'step1',     label: 'STEP 1 · 기준선 수립' },
  { id: 'parallel',  label: 'STEP 2·3·4 · 유출채널 / 민감파일 / 행동패턴 (병렬)' },
  { id: 'cross_ref', label: '교차 대조' },
  { id: 'step5',     label: 'STEP 5 · 반증 검증' },
  { id: 'scoring',   label: '리스크 스코어링' },
  { id: 'report',    label: '최종 수사 보고서 생성' },
]

const MARK: Record<string, string> = {
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

export function LoadingPhase({ input, onDone }: Props) {
  // startedRef prevents React StrictMode double-invocation from calling the agent twice.
  const startedRef = useRef(false)
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set())
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const startAt = Date.now()
    const timer = setInterval(() => setElapsedMs(Date.now() - startAt), 150)

    runAgentAnalysis({
      name: input.name,
      position: input.position,
      hireDate: input.hireDate,
      resignationDate: input.resignationDate,
    })
      .then(({ session_id }) => {
        const es = new EventSource(`/api/agent/events/${session_id}`)

        es.onmessage = (e) => {
          let ev: Record<string, string>
          try {
            ev = JSON.parse(e.data)
          } catch {
            return
          }

          if (ev.event === 'step_start') {
            setActiveStep(ev.step)
          } else if (ev.event === 'step_done') {
            setDoneSteps((prev) => new Set([...prev, ev.step]))
            setActiveStep(null)
          } else if (ev.event === 'completed') {
            clearInterval(timer)
            es.close()
            onDone(ev.session_id ?? session_id)
          } else if (ev.event === 'error') {
            clearInterval(timer)
            es.close()
            setError(ev.message ?? '에이전트 실행 오류')
          }
        }

        es.onerror = () => {
          es.close()
          setError('서버 연결 오류 — 백엔드(:8000) 기동 여부를 확인하세요')
        }
      })
      .catch((err: unknown) => {
        clearInterval(timer)
        setError(String(err))
      })

    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = LIVE_STEPS.map((s) => ({
    ...s,
    status: doneSteps.has(s.id) ? 'done'
          : activeStep === s.id  ? 'active'
          : 'pending',
  }))

  const doneCount = doneSteps.size
  const total = LIVE_STEPS.length
  const pct = Math.round((doneCount / total) * 100)

  return (
    <div className="load">
      <div className="load__beam" aria-hidden="true" />
      <div className="load__panel">
        <div className="load__panel-corner" aria-hidden="true" />
        <div className="load__head">
          <span className="load__tag">PHASE · 에이전트 분석</span>
          <span className="load__clock">{formatElapsed(elapsedMs)}</span>
        </div>
        <h1 className="load__title">수사 분석 진행 중</h1>

        <ol className="load__steps">
          {steps.map((s) => (
            <li key={s.id} className={`load__step load__step--${s.status}`}>
              <span className="load__mark" aria-hidden="true">{MARK[s.status]}</span>
              <span className="load__step-label">{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="load__bar" aria-hidden="true">
          <div className="load__bar-fill" style={{ width: `${pct}%` }} />
        </div>

        {error && (
          <div className="load__error" role="alert">{error}</div>
        )}
      </div>
    </div>
  )
}
