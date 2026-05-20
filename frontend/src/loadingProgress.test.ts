import { describe, it, expect } from 'vitest'
import {
  derivePipeline,
  totalDuration,
  ETL_STAGES,
  AGENT_STAGES,
} from './loadingProgress'

describe('derivePipeline', () => {
  it('at elapsed 0 the first stage is active and the rest pending', () => {
    const { steps, done } = derivePipeline(AGENT_STAGES, 0)
    expect(done).toBe(false)
    expect(steps[0].status).toBe('active')
    expect(steps.slice(1).every((s) => s.status === 'pending')).toBe(true)
  })

  it('marks elapsed stages done and the straddling stage active', () => {
    // First AGENT stage is 2200ms — elapsed 2500ms → stage 0 done, stage 1 active.
    const { steps } = derivePipeline(AGENT_STAGES, 2500)
    expect(steps[0].status).toBe('done')
    expect(steps[1].status).toBe('active')
    expect(steps[2].status).toBe('pending')
  })

  it('reports done with every stage done once elapsed covers the whole pipeline', () => {
    const { steps, done } = derivePipeline(AGENT_STAGES, totalDuration(AGENT_STAGES))
    expect(done).toBe(true)
    expect(steps.every((s) => s.status === 'done')).toBe(true)
  })

  it('is not done one millisecond before the pipeline ends', () => {
    const { done } = derivePipeline(AGENT_STAGES, totalDuration(AGENT_STAGES) - 1)
    expect(done).toBe(false)
  })

  it('works the same way for the ETL stage set', () => {
    const start = derivePipeline(ETL_STAGES, 0)
    expect(start.steps[0].status).toBe('active')
    expect(start.done).toBe(false)
    const end = derivePipeline(ETL_STAGES, totalDuration(ETL_STAGES))
    expect(end.done).toBe(true)
  })
})

describe('totalDuration', () => {
  it('sums every stage duration', () => {
    expect(totalDuration(AGENT_STAGES)).toBe(
      AGENT_STAGES.reduce((n, s) => n + s.durationMs, 0),
    )
    expect(totalDuration([])).toBe(0)
  })
})
