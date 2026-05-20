// S1 stub — replaced with the real landing screen in 온보딩 S2 (#14).

type Props = {
  onStart: () => void
}

export function LandingScreen({ onStart }: Props) {
  return (
    <div className="onb">
      <div className="onb__card">
        <span className="onb__tag">PHASE · LANDING</span>
        <h1 className="onb__title">시작화면</h1>
        <p className="onb__note">S2(#14)에서 실제 시작화면으로 교체됩니다.</p>
        <div className="onb__btns">
          <button type="button" className="onb__btn onb__btn--primary" onClick={onStart}>
            새 수사 시작
          </button>
        </div>
      </div>
    </div>
  )
}
