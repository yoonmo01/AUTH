import { useRef, useState, useEffect } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { postConsents } from '../api/client'

type Props = {
  sessionId: string
  employeeId: string
  onDone: () => void
  onBack: () => void
}

const CONSENT_ITEMS = [
  {
    consent_type: 'system_use' as const,
    title: '시스템 이용 동의',
    text: '본인은 회사 보안 정책에 따라 정기 점검 시스템을 통해 본인의 업무용 컴퓨터 사용 현황(파일 접근 기록, 이메일 발송 내역 등)이 검토될 수 있음에 동의합니다. 수집된 정보는 내부 보안 감사 목적으로만 사용되며, 관련 법령에 따라 보호됩니다.',
  },
  {
    consent_type: 'messenger_access' as const,
    title: '메신저 및 개인 이메일 접근 동의',
    text: '본인은 업무용 기기에서 사용된 메신저(카카오톡, Slack 등) 및 개인 이메일 계정의 발송·수신 기록이 보안 점검 목적으로 열람될 수 있음에 동의합니다. 본 동의는 업무 관련 내용으로 범위가 제한되며 개인정보 보호법을 준수합니다.',
  },
]

export function ConsentScreen({ sessionId, employeeId, onDone, onBack }: Props) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)
  const [savedSignatures, setSavedSignatures] = useState<string[]>(['', ''])

  const sigRef = useRef<SignatureCanvas>(null)
  const current = CONSENT_ITEMS[step]
  const isLast = step === CONSENT_ITEMS.length - 1

  // 스텝 전환 시 캔버스를 흰 배경으로 채운다
  useEffect(() => {
    sigRef.current?.clear()
  }, [step])

  function handleClear() {
    sigRef.current?.clear()
    setSigned(false)
  }

  function handleNext() {
    if (!signed) return
    const png = sigRef.current!.toDataURL('image/png')
    setSavedSignatures((prev) => {
      const updated = [...prev]
      updated[step] = png
      return updated
    })
    sigRef.current?.clear()
    setSigned(false)
    setStep(1)
  }

  async function handleSubmit() {
    if (!signed) return
    setLoading(true)
    setError(null)
    const png = sigRef.current!.toDataURL('image/png')
    const allSignatures = [...savedSignatures]
    allSignatures[step] = png

    const consents = CONSENT_ITEMS.map((item, i) => ({
      consent_type: item.consent_type,
      agreement_text: item.text,
      signature_png_b64: allSignatures[i],
    }))

    try {
      await postConsents(sessionId, { employee_id: employeeId, consents })
      onDone()
    } catch {
      setError('동의 저장 실패. 다시 시도해주세요.')
      setLoading(false)
    }
  }

  function handlePrev() {
    sigRef.current?.clear()
    setSigned(false)
    setStep(0)
  }

  return (
    <div className="consent">
      <div className="consent__panel">
        <span className="consent__tag">PHASE · 동의 및 전자서명</span>
        <h1 className="consent__title">정기 점검 동의서</h1>
        <p className="consent__step">{step + 1} / {CONSENT_ITEMS.length}</p>

        <h2 className="consent__subtitle">{current.title}</h2>
        <p className="consent__text">{current.text}</p>

        <div className="consent__sig-wrap">
          <SignatureCanvas
            ref={sigRef}
            penColor="#16222b"
            backgroundColor="white"
            canvasProps={{ width: 460, height: 130, className: 'consent__sig-canvas' }}
            onEnd={() => setSigned(true)}
          />
        </div>
        <button type="button" className="consent__sig-clear" onClick={handleClear}>
          지우기
        </button>

        {!signed && (
          <p className="consent__hint">서명란에 서명해주세요</p>
        )}

        {error && <p className="consent__err">{error}</p>}

        <div className="consent__btns">
          {step === 0 ? (
            <button type="button" className="consent__btn consent__btn--ghost" onClick={onBack}>
              뒤로
            </button>
          ) : (
            <button type="button" className="consent__btn consent__btn--ghost" onClick={handlePrev}>
              이전
            </button>
          )}

          {!isLast ? (
            <button
              type="button"
              className="consent__btn consent__btn--primary"
              onClick={handleNext}
              disabled={!signed}
            >
              다음 동의로
            </button>
          ) : (
            <button
              type="button"
              className="consent__btn consent__btn--primary"
              onClick={handleSubmit}
              disabled={!signed || loading}
            >
              {loading ? '제출 중...' : '제출'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
