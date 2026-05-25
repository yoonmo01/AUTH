import { useState, type FormEvent, useRef, useEffect } from 'react'
import { postAudit } from '../api/client'
import type { EmployeeProfile, EmployeeInput } from '../flow'

const USE_REAL_FOLDER_PICKER: boolean = false

const MOCK_FOLDERS = [
  'C:\\',
  'C:\\Users\\kang_sumin',
  'C:\\Users\\kang_sumin\\Documents',
  'C:\\Users\\kang_sumin\\Desktop',
]

type FolderPickerProps = {
  value: string
  onChange: (value: string) => void
}

function MockFolderPicker({ value, onChange }: FolderPickerProps) {
  return (
    <select
      className="eform__select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">폴더를 선택하세요</option>
      {MOCK_FOLDERS.map((folder) => (
        <option key={folder} value={folder}>
          {folder}
        </option>
      ))}
    </select>
  )
}

function RealFolderPicker({ value, onChange }: FolderPickerProps) {
  const [count, setCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [])

  return (
    <div className="eform__file">
      <button type="button" className="eform__file-btn" onClick={() => inputRef.current?.click()}>
        폴더 선택
      </button>
      <span className="eform__file-name">
        {value ? `${value} · ${count.toLocaleString()}개 파일` : '선택된 폴더 없음'}
      </span>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length > 0) {
            const root = files[0].webkitRelativePath.split('/')[0]
            onChange(root || files[0].name)
            setCount(files.length)
          }
        }}
      />
    </div>
  )
}

type Props = {
  profile: EmployeeProfile
  onSubmit: (input: EmployeeInput, sessionId: string) => void
  onBack: () => void
}

const YEARS = ['2024', '2025', '2026']
const QUARTERS = [
  { value: '1', label: '1분기 (1월~3월)' },
  { value: '2', label: '2분기 (4월~6월)' },
  { value: '3', label: '3분기 (7월~9월)' },
  { value: '4', label: '4분기 (10월~12월)' },
]

export function EmployeeForm({ profile, onSubmit, onBack }: Props) {
  const [evidenceRootPath, setEvidenceRootPath] = useState('')
  const [year, setYear] = useState('2026')
  const [quarter, setQuarter] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const canSubmit = !!evidenceRootPath && !!year && !!quarter

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitAttempted(true)
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const quarterStr = `${year}-Q${quarter}`
      const { session_id } = await postAudit({
        employee_id: profile.employee_id,
        quarter: quarterStr,
      })
      onSubmit({ evidenceRootPath, employee_id: profile.employee_id, quarter: quarterStr }, session_id)
    } catch {
      setError('분석 세션 생성 실패. 서버 연결을 확인하세요.')
      setLoading(false)
    }
  }

  return (
    <div className="eform">
      <form className="eform__panel" onSubmit={handleSubmit} noValidate>
        <span className="eform__tag">PHASE · 정기 점검</span>
        <h1 className="eform__title">점검 정보 입력</h1>

        <div className="eform__row">
          <div className="eform__field">
            <span className="eform__label">이름</span>
            <input className="eform__input" type="text" value={profile.name} disabled />
          </div>
          <div className="eform__field">
            <span className="eform__label">직급</span>
            <input className="eform__input" type="text" value={profile.position} disabled />
          </div>
        </div>

        <div className="eform__field">
          <span className="eform__label">분석 대상 폴더</span>
          {USE_REAL_FOLDER_PICKER ? (
            <RealFolderPicker value={evidenceRootPath} onChange={setEvidenceRootPath} />
          ) : (
            <MockFolderPicker value={evidenceRootPath} onChange={setEvidenceRootPath} />
          )}
          {submitAttempted && !evidenceRootPath && (
            <span className="eform__err">폴더를 선택하세요.</span>
          )}
        </div>

        <div className="eform__row">
          <div className="eform__field">
            <span className="eform__label">점검 년도</span>
            <select className="eform__select" value={year} onChange={(e) => setYear(e.target.value)}>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
          <div className="eform__field">
            <span className="eform__label">점검 분기</span>
            <select className="eform__select" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              {QUARTERS.map((q) => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="eform__err">{error}</p>}

        <div className="eform__btns">
          <button type="button" className="eform__btn eform__btn--ghost" onClick={onBack}>
            뒤로
          </button>
          <button
            type="submit"
            className="eform__btn eform__btn--primary"
            disabled={loading}
          >
            {loading ? '생성 중...' : '분석 시작'}
          </button>
        </div>
      </form>
    </div>
  )
}
