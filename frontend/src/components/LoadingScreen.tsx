// S1 stub — replaced with the real loading screen + progress model in 온보딩 S5 (#17).

type Props = {
  onComplete: (sessionId: string | null) => void
  onFail: (error: string) => void
}

export function LoadingScreen({ onComplete, onFail }: Props) {
  return (
    <div className="onb">
      <div className="onb__card">
        <span className="onb__tag">PHASE · LOADING</span>
        <h1 className="onb__title">로딩 화면</h1>
        <p className="onb__note">
          S5(#17)에서 STEP 1~5 파이프라인 진행 표시로 교체됩니다.
        </p>
        <div className="onb__btns">
          <button
            type="button"
            className="onb__btn"
            onClick={() => onFail('분석 실패 (stub)')}
          >
            분석 실패
          </button>
          <button
            type="button"
            className="onb__btn onb__btn--primary"
            onClick={() => onComplete(null)}
          >
            분석 완료 →
          </button>
        </div>
      </div>
    </div>
  )
}
