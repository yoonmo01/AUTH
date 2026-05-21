import { useEffect, useRef, useState, type ReactNode } from 'react'
import { validateInvestigationForm, type FormField } from '../investigationForm'
import type { InvestigationInput } from '../flow'

// ── Folder picker mode ───────────────────────────────────────
// false → demo: a mock dropdown, nothing is staged/uploaded/scanned.
// true  → real system: an actual folder picker (webkitdirectory).
// Flip this one constant to switch — both implementations are kept below.
const USE_REAL_FOLDER_PICKER: boolean = false

// Preset demo folders for the mock picker.
const MOCK_FOLDERS = [
  'C:\\',
  'C:\\Users\\minsoo',
  'C:\\Users\\minsoo\\Documents',
  'C:\\Users\\minsoo\\Desktop',
]

type FolderPickerProps = {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
}

// Demo picker — selects a preset string, no filesystem access.
function MockFolderPicker({ value, onChange, onBlur }: FolderPickerProps) {
  return (
    <select
      className="iform__input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      autoFocus
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

// Real picker — webkitdirectory turns the file input into a folder chooser.
// The browser enumerates the folder; only its root name and file count are
// captured here (no file is read).
function RealFolderPicker({ value, onChange, onBlur }: FolderPickerProps) {
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
    <div className="iform__file">
      <button
        type="button"
        className="iform__file-btn"
        onClick={() => inputRef.current?.click()}
        autoFocus
      >
        폴더 선택
      </button>
      <span className="iform__file-name">
        {value ? `${value} · ${count.toLocaleString()}개 파일` : '선택된 폴더 없음'}
      </span>
      <input
        ref={inputRef}
        className="iform__file-input"
        type="file"
        multiple
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length > 0) {
            // webkitRelativePath = "<folder>/sub/file" — take the root segment.
            const root = files[0].webkitRelativePath.split('/')[0]
            onChange(root || files[0].name)
            setCount(files.length)
          }
          onBlur()
        }}
      />
    </div>
  )
}

type Props = {
  onSubmit: (input: InvestigationInput) => void
  onBack: () => void
}

const EMPTY: InvestigationInput = {
  evidenceRootPath: '',
  name: '',
  position: '',
  hireDate: '',
  resignationDate: '',
  dummy: false,
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

  const validation = validateInvestigationForm(input)
  // 더미 모드는 검증 우회 — 백엔드 호출이 없어서 입력값이 의미 없음
  const ok = input.dummy ? true : validation.ok
  const errors = input.dummy ? {} : validation.errors

  function set(field: FormField, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }))
  }
  function blur(field: FormField) {
    setTouched((prev) => new Set(prev).add(field))
  }
  // An error surfaces once its field is touched or a submit was attempted.
  const show = (field: FormField) => touched.has(field) || submitAttempted

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitAttempted(true)
    if (!ok) return
    onSubmit(input)
  }

  const folderProps: FolderPickerProps = {
    value: input.evidenceRootPath,
    onChange: (v) => set('evidenceRootPath', v),
    onBlur: () => blur('evidenceRootPath'),
  }

  return (
    <div className="iform">
      <form className="iform__panel" onSubmit={handleSubmit} noValidate>
        <div className="iform__panel-corner" aria-hidden="true" />
        <span className="iform__tag">PHASE · 수사 요청</span>
        <h1 className="iform__title">새 수사 입력</h1>

        <Field
          label="분석 대상 폴더"
          error={errors.evidenceRootPath}
          show={show('evidenceRootPath')}
        >
          {USE_REAL_FOLDER_PICKER ? (
            <RealFolderPicker {...folderProps} />
          ) : (
            <MockFolderPicker {...folderProps} />
          )}
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

        <div className="iform__btns">
          <label className="iform__dummy" title="백엔드 에이전트를 호출하지 않고 번들된 더미 세션으로 콘솔 진입">
            <input
              type="checkbox"
              checked={!!input.dummy}
              onChange={(e) => setInput((prev) => ({ ...prev, dummy: e.target.checked }))}
            />
            <span>DUMMY 모드</span>
          </label>
          <button type="button" className="onb__btn" onClick={onBack}>
            뒤로
          </button>
          <button type="submit" className="onb__btn onb__btn--primary" disabled={!ok}>
            {input.dummy ? '더미로 진입' : '분석 시작'}
          </button>
        </div>
      </form>
    </div>
  )
}
