// S1 stub — replaced with the real input form + validator in 온보딩 S3 (#15).

import type { InvestigationInput } from '../flow'

type Props = {
  onSubmit: (input: InvestigationInput) => void
  onBack: () => void
}

// Placeholder payload — the real form collects these fields in S3.
const STUB_INPUT: InvestigationInput = {
  evidenceImagePath: 'C:/cases/hyena.E01',
  name: '김민수',
  position: '구매팀 대리',
  hireDate: '2021-03-02',
  resignationDate: '2026-05-09',
}

export function InvestigationForm({ onSubmit, onBack }: Props) {
  return (
    <div className="onb">
      <div className="onb__card">
        <span className="onb__tag">PHASE · FORM</span>
        <h1 className="onb__title">입력 화면</h1>
        <p className="onb__note">
          S3(#15)에서 실제 입력 폼 + 검증기로 교체됩니다.
        </p>
        <div className="onb__btns">
          <button type="button" className="onb__btn" onClick={onBack}>
            뒤로
          </button>
          <button
            type="button"
            className="onb__btn onb__btn--primary"
            onClick={() => onSubmit(STUB_INPUT)}
          >
            분석 시작
          </button>
        </div>
      </div>
    </div>
  )
}
