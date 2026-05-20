import { describe, it, expect } from 'vitest'
import { validateInvestigationForm } from './investigationForm'
import type { InvestigationInput } from './flow'

const VALID: InvestigationInput = {
  evidenceImagePath: 'C:/cases/hyena.E01',
  name: '김민수',
  position: '구매팀 대리',
  hireDate: '2021-03-02',
  resignationDate: '2026-05-09',
}

describe('validateInvestigationForm', () => {
  it('accepts a fully valid form', () => {
    const { ok, errors } = validateInvestigationForm(VALID)
    expect(ok).toBe(true)
    expect(errors).toEqual({})
  })

  it('flags a missing evidence image path', () => {
    const { ok, errors } = validateInvestigationForm({ ...VALID, evidenceImagePath: '   ' })
    expect(ok).toBe(false)
    expect(errors.evidenceImagePath).toBeDefined()
  })

  it('flags a missing name', () => {
    const { errors } = validateInvestigationForm({ ...VALID, name: '' })
    expect(errors.name).toBeDefined()
  })

  it('flags a missing position', () => {
    const { errors } = validateInvestigationForm({ ...VALID, position: '' })
    expect(errors.position).toBeDefined()
  })

  it('rejects a malformed date', () => {
    const { errors } = validateInvestigationForm({ ...VALID, hireDate: '2021/03/02' })
    expect(errors.hireDate).toBeDefined()
  })

  it('rejects a rollover date that is not a real calendar day', () => {
    const { errors } = validateInvestigationForm({ ...VALID, hireDate: '2021-02-30' })
    expect(errors.hireDate).toBeDefined()
  })

  it('rejects a resignation date earlier than the hire date', () => {
    const { ok, errors } = validateInvestigationForm({
      ...VALID,
      hireDate: '2026-05-09',
      resignationDate: '2021-03-02',
    })
    expect(ok).toBe(false)
    expect(errors.resignationDate).toBe('퇴사일은 입사일보다 이후여야 합니다')
  })

  it('rejects equal hire and resignation dates', () => {
    const { errors } = validateInvestigationForm({
      ...VALID,
      hireDate: '2026-05-09',
      resignationDate: '2026-05-09',
    })
    expect(errors.resignationDate).toBe('퇴사일은 입사일보다 이후여야 합니다')
  })

  it('reports every empty field at once', () => {
    const { ok, errors } = validateInvestigationForm({
      evidenceImagePath: '',
      name: '',
      position: '',
      hireDate: '',
      resignationDate: '',
    })
    expect(ok).toBe(false)
    expect(Object.keys(errors).sort()).toEqual(
      ['evidenceImagePath', 'hireDate', 'name', 'position', 'resignationDate'].sort(),
    )
  })
})
