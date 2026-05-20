type Props = {
  onStart: () => void
}

const VERDICTS = [
  { key: 'high', label: 'HIGH' },
  { key: 'med', label: 'MEDIUM' },
  { key: 'low', label: 'LOW' },
  { key: 'clean', label: 'CLEAN' },
] as const

export function LandingScreen({ onStart }: Props) {
  return (
    <div className="land">
      <div className="land__beam" aria-hidden="true" />
      <div className="land__scan" aria-hidden="true" />

      <main className="land__panel">
        <div className="land__brand">
          <span className="land__mark" aria-hidden="true">◆</span>
          <span className="land__name">HYENA</span>
        </div>
        <span className="land__sub">EXFILTRATION&nbsp;FORENSICS</span>

        <div className="land__rule" aria-hidden="true" />

        <h1 className="land__title">퇴사자 데이터 유출 탐지 시스템</h1>
        <p className="land__desc">
          퇴사자의 디스크 이미지를 분석해 데이터 유출 여부를 자동 판정하고
          수사 보고서를 생성합니다. 기준선 수립부터 반증 검증까지 STEP 1~5
          파이프라인이 증거를 교차 대조합니다.
        </p>

        <ul className="land__verdicts" aria-label="판정 등급">
          {VERDICTS.map((v) => (
            <li key={v.key} className={`land__v land__v--${v.key}`}>
              {v.label}
            </li>
          ))}
        </ul>

        <button type="button" className="land__cta" onClick={onStart}>
          새 수사 시작 <span aria-hidden="true">→</span>
        </button>
      </main>

      <div className="land__foot">HYENA INVESTIGATION CONSOLE · v0.1</div>
    </div>
  )
}
