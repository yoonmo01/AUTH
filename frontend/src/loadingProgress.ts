// Pure pipeline-progress model for the timed demo screens (ETL + agent).
// The backend exposes no per-stage telemetry, so progress is a time-based
// demo: each stage owns a duration and the displayed status is derived from
// elapsed time. Side-effect free so it can be unit tested in isolation.

export type StepStatus = 'done' | 'active' | 'pending'

export interface ProgressStep {
  id: string
  label: string
  status: StepStatus
}

export interface Stage {
  id: string
  label: string
  durationMs: number
}

export interface PipelineProgress {
  steps: ProgressStep[]
  done: boolean
}

// ETL demo — dummy database build over the disk image.
export const ETL_STAGES: Stage[] = [
  { id: 'scan', label: '디스크 이미지 스캔', durationMs: 1400 },
  { id: 'files', label: '파일 메타데이터 적재', durationMs: 1600 },
  { id: 'emails', label: '이메일 파싱 · 정규화', durationMs: 1600 },
  { id: 'entities', label: '엔티티 추출', durationMs: 1400 },
  { id: 'embed', label: '벡터 임베딩 생성 (Upstage)', durationMs: 1800 },
  { id: 'graph', label: '관계 그래프 적재 (Neo4j)', durationMs: 1400 },
]

// Agent pipeline — fixed STEP order hardcoded in the agent (see CLAUDE.md).
// STEP 2/3/4 run in parallel and are shown as one stage.
export const AGENT_STAGES: Stage[] = [
  { id: 'baseline', label: 'STEP 1 · 기준선 수립', durationMs: 2200 },
  { id: 'parallel', label: 'STEP 2·3·4 · 유출채널 / 민감파일 / 행동패턴 (병렬)', durationMs: 3000 },
  { id: 'cross_ref', label: '교차 대조', durationMs: 1600 },
  { id: 'counter', label: 'STEP 5 · 반증 검증', durationMs: 2200 },
  { id: 'scoring', label: '리스크 스코어링', durationMs: 1400 },
  { id: 'report', label: '최종 수사 보고서 생성', durationMs: 1800 },
]

export function totalDuration(stages: Stage[]): number {
  return stages.reduce((sum, s) => sum + s.durationMs, 0)
}

/**
 * Derive per-stage status from elapsed time. Stages fully behind `elapsedMs`
 * are 'done', the stage straddling it is 'active', later stages 'pending'.
 * `done` is true once elapsed time covers every stage.
 */
export function derivePipeline(stages: Stage[], elapsedMs: number): PipelineProgress {
  let cum = 0
  let anyActive = false
  const steps = stages.map((s) => {
    const start = cum
    const end = cum + s.durationMs
    cum = end
    let status: StepStatus
    if (elapsedMs >= end) {
      status = 'done'
    } else if (elapsedMs >= start) {
      status = 'active'
      anyActive = true
    } else {
      status = 'pending'
    }
    return { id: s.id, label: s.label, status }
  })

  const done = elapsedMs >= cum
  // Guard the empty edge — before the first stage, mark it active.
  if (!done && !anyActive && steps.length > 0) {
    steps[0].status = 'active'
  }
  return { steps, done }
}
