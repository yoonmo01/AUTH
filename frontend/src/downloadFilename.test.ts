import { describe, it, expect } from 'vitest'
import { buildDownloadFilename } from './downloadFilename'

// 2026-05-21 in local time.
const DATE = new Date(2026, 4, 21)

describe('buildDownloadFilename', () => {
  it('verdict-report — subject, verdict, date', () => {
    expect(
      buildDownloadFilename({
        kind: 'verdict-report',
        extension: 'pdf',
        date: DATE,
        subjectName: '김민수',
        verdict: 'HIGH',
      }),
    ).toBe('판정리포트_김민수_HIGH_2026-05-21.pdf')
  })

  it('network-graph — fixed label and date', () => {
    expect(
      buildDownloadFilename({ kind: 'network-graph', extension: 'png', date: DATE }),
    ).toBe('네트워크그래프_2026-05-21.png')
  })

  it('omits the subject segment when the subject name is missing', () => {
    expect(
      buildDownloadFilename({
        kind: 'verdict-report',
        extension: 'pdf',
        date: DATE,
        verdict: 'HIGH',
      }),
    ).toBe('판정리포트_HIGH_2026-05-21.pdf')
  })

  it('strips path separators and reserved characters from the subject', () => {
    expect(
      buildDownloadFilename({
        kind: 'verdict-report',
        extension: 'pdf',
        date: DATE,
        subjectName: 'a/b\\c:d*?e',
      }),
    ).toBe('판정리포트_abcde_2026-05-21.pdf')
  })

  it('collapses whitespace in the subject to underscores', () => {
    expect(
      buildDownloadFilename({
        kind: 'verdict-report',
        extension: 'pdf',
        date: DATE,
        subjectName: '홍 길동',
      }),
    ).toBe('판정리포트_홍_길동_2026-05-21.pdf')
  })
})
