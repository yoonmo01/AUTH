import { describe, it, expect } from 'vitest'
import { classifyReport, selectLatestCompletedSession } from './report'
import type { Session } from './types'

describe('classifyReport', () => {
  it('classifies an EXFILTRATION_SUSPECTED report', () => {
    const raw = {
      report_type: 'EXFILTRATION_SUSPECTED',
      verdict: 'HIGH',
      risk_score: 82,
      subject: { name: '김민수', position: '구매팀', hire_date: '2021', resignation_date: '2026' },
      summary: '의심 정황 다수',
      suspicious_emails: [{ email_id: 'e1', risk_weight: 30 }],
      suspicious_files: [{ file_id: 'f1', matched_keywords: ['단가표'] }],
      evidence_network: { nodes: [{ id: 'n1', type: 'USER', label: 'u' }], edges: [] },
    }
    const out = classifyReport(raw)
    expect(out.kind).toBe('exfiltration')
    if (out.kind !== 'exfiltration') throw new Error('unreachable')
    expect(out.report.verdict).toBe('HIGH')
    expect(out.report.risk_score).toBe(82)
    expect(out.report.suspicious_emails).toHaveLength(1)
    expect(out.report.suspicious_files[0].matched_keywords).toEqual(['단가표'])
    expect(out.report.evidence_network.nodes).toHaveLength(1)
  })

  it('coerces a missing suspicious_emails array to empty', () => {
    const out = classifyReport({ report_type: 'EXFILTRATION_SUSPECTED', verdict: 'LOW' })
    expect(out.kind).toBe('exfiltration')
    if (out.kind !== 'exfiltration') throw new Error('unreachable')
    expect(out.report.suspicious_emails).toEqual([])
    expect(out.report.suspicious_files).toEqual([])
  })

  it('falls back to LOW for an unrecognised exfiltration verdict', () => {
    const out = classifyReport({ report_type: 'EXFILTRATION_SUSPECTED', verdict: 'CATASTROPHIC' })
    if (out.kind !== 'exfiltration') throw new Error('unreachable')
    expect(out.report.verdict).toBe('LOW')
  })

  it('classifies a CLEAN_CERTIFICATE report', () => {
    const raw = {
      report_type: 'CLEAN_CERTIFICATE',
      verdict: 'CLEAN',
      risk_score: 0,
      subject: { name: '이영희', position: '영업팀', hire_date: '2020', resignation_date: '2026' },
      summary: '분석 기간 내 데이터 유출 의심 행위가 발견되지 않음',
      analysis_summary: {
        emails_analyzed: 0, files_analyzed: 0,
        anomalies_found: 0, false_positives_removed: 0,
      },
      issued_at: '2026-05-19T10:00:00',
    }
    const out = classifyReport(raw)
    expect(out.kind).toBe('clean')
    if (out.kind !== 'clean') throw new Error('unreachable')
    expect(out.report.verdict).toBe('CLEAN')
    expect(out.report.analysis_summary.emails_analyzed).toBe(0)
  })

  it('treats null / non-object input as invalid', () => {
    expect(classifyReport(null).kind).toBe('invalid')
    expect(classifyReport(undefined).kind).toBe('invalid')
    expect(classifyReport('a string').kind).toBe('invalid')
    expect(classifyReport([]).kind).toBe('invalid')
  })

  it('treats an unknown report_type as invalid', () => {
    expect(classifyReport({ report_type: 'SOMETHING_ELSE' }).kind).toBe('invalid')
    expect(classifyReport({ foo: 'bar' }).kind).toBe('invalid')
  })

  it('unwraps a final_report wrapper for an EXFILTRATION report', () => {
    const out = classifyReport({
      final_report: { report_type: 'EXFILTRATION_SUSPECTED', verdict: 'MEDIUM' },
    })
    expect(out.kind).toBe('exfiltration')
    if (out.kind !== 'exfiltration') throw new Error('unreachable')
    expect(out.report.verdict).toBe('MEDIUM')
  })

  it('unwraps a final_report wrapper for a CLEAN report', () => {
    const out = classifyReport({
      final_report: { report_type: 'CLEAN_CERTIFICATE', verdict: 'CLEAN' },
    })
    expect(out.kind).toBe('clean')
  })

  it('treats a final_report wrapper with a null body as invalid', () => {
    expect(classifyReport({ final_report: null }).kind).toBe('invalid')
  })

  it('parses risk_breakdown, behavior_summary and timeline from a wrapped report', () => {
    const out = classifyReport({
      final_report: {
        report_type: 'EXFILTRATION_SUSPECTED',
        verdict: 'HIGH',
        risk_breakdown: { cross_ref: 40, counter_evidence: -20, bogus: 'x' },
        behavior_summary: {
          highlight_dates: ['2026-05-01'],
          deleted_files: [
            { original_filename: 'a.xlsx', deleted_at: '2026-05-06', file_size_bytes: 100, reason: '은폐' },
          ],
          out_of_hours_activity: [{ event_type: 'USB 연결', event_at: '2026-05-01T22:00', detail: 'd' }],
          notes: '메모',
        },
        timeline: [{ date: '2026-05-01', events: ['ev1', 'ev2'] }],
      },
    })
    if (out.kind !== 'exfiltration') throw new Error('unreachable')
    expect(out.report.risk_breakdown).toEqual({ cross_ref: 40, counter_evidence: -20 })
    expect(out.report.behavior_summary.deleted_files).toHaveLength(1)
    expect(out.report.behavior_summary.notes).toBe('메모')
    expect(out.report.timeline[0].events).toEqual(['ev1', 'ev2'])
  })

  it('defaults missing behavior_summary and timeline to empty structures', () => {
    const out = classifyReport({ report_type: 'EXFILTRATION_SUSPECTED', verdict: 'LOW' })
    if (out.kind !== 'exfiltration') throw new Error('unreachable')
    expect(out.report.behavior_summary.deleted_files).toEqual([])
    expect(out.report.behavior_summary.out_of_hours_activity).toEqual([])
    expect(out.report.behavior_summary.highlight_dates).toEqual([])
    expect(out.report.timeline).toEqual([])
    expect(out.report.risk_breakdown).toEqual({})
  })
})

describe('selectLatestCompletedSession', () => {
  const mk = (over: Partial<Session>): Session => ({
    id: 'x', query_text: null, status: 'completed',
    started_at: null, completed_at: null, ...over,
  })

  it('returns null for an empty list', () => {
    expect(selectLatestCompletedSession([])).toBeNull()
  })

  it('picks the most recently completed session', () => {
    const sessions = [
      mk({ id: 'a', status: 'completed', completed_at: '2026-05-18T14:00:00' }),
      mk({ id: 'b', status: 'completed', completed_at: '2026-05-19T09:00:00' }),
      mk({ id: 'c', status: 'completed', completed_at: '2026-05-17T11:00:00' }),
    ]
    expect(selectLatestCompletedSession(sessions)?.id).toBe('b')
  })

  it('ignores running sessions when a completed one exists', () => {
    const sessions = [
      mk({ id: 'r', status: 'running', completed_at: null, started_at: '2026-05-20T08:00:00' }),
      mk({ id: 'done', status: 'completed', completed_at: '2026-05-18T14:00:00' }),
    ]
    expect(selectLatestCompletedSession(sessions)?.id).toBe('done')
  })

  it('falls back to the newest started session when none are completed', () => {
    const sessions = [
      mk({ id: 'old', status: 'running', completed_at: null, started_at: '2026-05-18T08:00:00' }),
      mk({ id: 'new', status: 'running', completed_at: null, started_at: '2026-05-20T08:00:00' }),
    ]
    expect(selectLatestCompletedSession(sessions)?.id).toBe('new')
  })
})
