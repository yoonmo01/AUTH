import { useState, type ReactNode } from 'react'
import { validateInvestigationForm, type FormField } from '../investigationForm'
import { submitInvestigation, type InvestigationRequest } from '../api/client'
import type { InvestigationInput } from '../flow'

type Props = {
  onSubmit: (input: InvestigationInput, sessionId: string) => void
  onBack: () => void
}

const EMPTY: InvestigationInput = {
  evidenceImagePath: '',
  name: '',
  position: '',
  hireDate: '',
  resignationDate: '',
}

function toRequest(input: InvestigationInput): InvestigationRequest {
  return {
    evidence_image_path: input.evidenceImagePath,
    subject: {
      name: input.name,
      position: input.position,
      hire_date: input.hireDate,
      resignation_date: input.resignationDate,
    },
  }
}

function Field({
  label,
  error,
  show,
  children,
}: {
  label: string
  error: string | undefined
  show: boolean
  children: ReactNode
}) {
  return (
    <label className="iform__field">
      <span className="iform__label">{label}</span>
      {children}
      {show && error && <span className="iform__err">{error}</span>}
    </label>
  )
}

export function InvestigationForm({ onSubmit, onBack }: Props) {
  const [input, setInput] = useState<InvestigationInput>(EMPTY)
  const [touched, setTouched] = useState<Set<FormField>>(new Set())
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { ok, errors } = validateInvestigationForm(input)

  function set(field: FormField, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }))
  }
  function blur(field: FormField) {
    setTouched((prev) => new Set(prev).add(field))
  }
  // An error surfaces once its field is touched or a submit was attempted.
  const show = (field: FormField) => touched.has(field) || submitAttempted

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitAttempted(true)
    if (!ok || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { sessionId } = await submitInvestigation(toRequest(input))
      onSubmit(input, sessionId)
      // On success the flow advances to 'loading' and this form unmounts.
    } catch {
      setSubmitError('분석 요청에 실패했습니다 — 다시 시도하세요')
      setSubmitting(false)
    }
  }

  return (
    <div className="iform">
      <form className="iform__panel" onSubmit={handleSubmit} noValidate>
        <div className="iform__panel-corner" aria-hidden="true" />
        <span className="iform__tag">PHASE · 수사 요청</span>
        <h1 className="iform__title">새 수사 입력</h1>

        <Field label="증거 이미지 경로" error={errors.evidenceImagePath} show={show('evidenceImagePath')}>
          <input
            className="iform__input"
            type="text"
            value={input.evidenceImagePath}
            placeholder="C:/cases/hyena.E01"
            onChange={(e) => set('evidenceImagePath', e.target.value)}
            onBlur={() => blur('evidenceImagePath')}
            autoFocus
          />
        </Field>

        <div className="iform__row">
          <Field label="이름" error={errors.name} show={show('name')}>
            <input
              className="iform__input"
              type="text"
              value={input.name}
              onChange={(e) => set('name', e.target.value)}
              onBlur={() => blur('name')}
            />
          </Field>
          <Field label="직급" error={errors.position} show={show('position')}>
            <input
              className="iform__input"
              type="text"
              value={input.position}
              onChange={(e) => set('position', e.target.value)}
              onBlur={() => blur('position')}
            />
          </Field>
        </div>

        <div className="iform__row">
          <Field label="입사일" error={errors.hireDate} show={show('hireDate')}>
            <input
              className="iform__input"
              type="date"
              value={input.hireDate}
              onChange={(e) => set('hireDate', e.target.value)}
              onBlur={() => blur('hireDate')}
            />
          </Field>
          <Field label="퇴사일" error={errors.resignationDate} show={show('resignationDate')}>
            <input
              className="iform__input"
              type="date"
              value={input.resignationDate}
              onChange={(e) => set('resignationDate', e.target.value)}
              onBlur={() => blur('resignationDate')}
            />
          </Field>
        </div>

        {submitError && <div className="iform__submit-err">{submitError}</div>}

        <div className="iform__btns">
          <button type="button" className="onb__btn" onClick={onBack} disabled={submitting}>
            뒤로
          </button>
          <button
            type="submit"
            className="onb__btn onb__btn--primary"
            disabled={!ok || submitting}
          >
            {submitting ? '요청 중…' : '분석 시작'}
          </button>
        </div>
      </form>
    </div>
  )
}
