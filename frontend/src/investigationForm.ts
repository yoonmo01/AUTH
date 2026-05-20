// Pure validator for the investigation input form (온보딩 S3).
// Side-effect free so it can be unit tested in isolation.

import type { InvestigationInput } from './flow'

export type FormField = keyof InvestigationInput
export type FormErrors = Partial<Record<FormField, string>>

export interface ValidationResult {
  ok: boolean
  errors: FormErrors
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// True only for a real calendar date in strict YYYY-MM-DD form.
// Rejects rollover values like 2026-02-30.
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d
}

/**
 * Validate the investigation request form. Returns field-level Korean
 * error messages; `ok` is true only when every field passes.
 */
export function validateInvestigationForm(input: InvestigationInput): ValidationResult {
  const errors: FormErrors = {}

  if (!input.evidenceImagePath.trim()) {
    errors.evidenceImagePath = '증거 이미지 경로를 입력하세요'
  }
  if (!input.name.trim()) {
    errors.name = '이름을 입력하세요'
  }
  if (!input.position.trim()) {
    errors.position = '직급을 입력하세요'
  }

  const hireOk = isValidDate(input.hireDate)
  const resignOk = isValidDate(input.resignationDate)

  if (!input.hireDate.trim()) {
    errors.hireDate = '입사일을 입력하세요'
  } else if (!hireOk) {
    errors.hireDate = '입사일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다'
  }

  if (!input.resignationDate.trim()) {
    errors.resignationDate = '퇴사일을 입력하세요'
  } else if (!resignOk) {
    errors.resignationDate = '퇴사일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다'
  }

  // ISO YYYY-MM-DD strings compare correctly with a lexical compare.
  if (hireOk && resignOk && input.resignationDate <= input.hireDate) {
    errors.resignationDate = '퇴사일은 입사일보다 이후여야 합니다'
  }

  return { ok: Object.keys(errors).length === 0, errors }
}
