import type { Verdict } from '../types'

const LABELS: Record<Verdict, string> = {
  HIGH: 'HIGH · 유출 강력 의심',
  MEDIUM: 'MEDIUM · 유출 의심',
  LOW: 'LOW · 경미한 정황',
  CLEAN: 'CLEAN · 정상',
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`vd-badge vd-badge--${verdict}`}>
      {LABELS[verdict] ?? verdict}
    </span>
  )
}
