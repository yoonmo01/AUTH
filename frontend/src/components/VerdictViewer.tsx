import { useQuery } from '@tanstack/react-query'
import { fetchSession, fetchAdminNarrative } from '../api/client'
import { classifyReport } from '../report'
import { channelLabel, sensitivityCategoryPlain } from '../reportLabels'
import { formatDate } from '../format'
import { buildDownloadFilename } from '../downloadFilename'
import { VerdictBadge } from './VerdictBadge'
import type { ConsoleLayout } from '../consoleLayout'
import type {
  Session,
  ExfiltrationReport,
  CleanReport,
  ReportSubject,
  RiskBreakdown,
  SuspiciousEmail,
  SuspiciousFile,
  BehaviorSummary,
  AdminNarrative,
} from '../types'

export function printVerdictReport(subjectName: string, verdict: string) {
  const filename = buildDownloadFilename({
    kind: 'verdict-report',
    extension: 'pdf',
    date: new Date(),
    subjectName,
    verdict,
  })
  const original = document.title
  document.title = filename.replace(/\.pdf$/, '')
  const restore = () => {
    document.title = original
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}

// ── helpers ─────────────────────────────────────────────────────────────────

function calcMonths(start: string, end: string): number {
  const a = new Date(start)
  const b = new Date(end)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
}

function channelCounts(emails: SuspiciousEmail[]): string {
  const map = new Map<string, number>()
  for (const e of emails) map.set(e.channel_type, (map.get(e.channel_type) ?? 0) + 1)
  return [...map.entries()].map(([ch, n]) => `${channelLabel(ch)} ${n}건`).join(', ')
}

function catCounts(files: SuspiciousFile[]): [string, number][] {
  const map = new Map<string, number>()
  for (const f of files) {
    const cat = f.sensitivity_category || '기타'
    map.set(cat, (map.get(cat) ?? 0) + 1)
  }
  return [...map.entries()]
}

const BREAKDOWN_LABEL: Record<string, string> = {
  cross_ref: '교차 대조',
  deleted_files: '파일 삭제',
  anon_channel: '익명 채널',
  anomaly: '행동 이상',
  counter_evidence: '반증',
}

function breakdownSentence(bd: RiskBreakdown): string {
  const parts = (Object.entries(bd) as [string, number | undefined][])
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([k, v]) => {
      const label = BREAKDOWN_LABEL[k] ?? k
      return (v as number) >= 0 ? `${label} +${v}` : `${label} ${v}`
    })
  return parts.join(', ')
}

// ── NarrativeBullets ─────────────────────────────────────────────────────────

function NarrativeBullets({ items }: { items: string[] }) {
  return (
    <ul className="vd__bullets">
      {items.map((item, i) => (
        <li key={i} className="vd__bullet">{item}</li>
      ))}
    </ul>
  )
}

// ── StepSection ──────────────────────────────────────────────────────────────

function StepSection({
  num,
  title,
  children,
  final = false,
}: {
  num: number
  title: string
  children: React.ReactNode
  final?: boolean
}) {
  return (
    <section className={`vd__step${final ? ' vd__step--final' : ''}`}>
      <div className="vd__step-head">
        {num > 0 && <span className="vd__step-num">STEP {num}</span>}
        <h3 className="vd__step-title">{title}</h3>
      </div>
      <div className="vd__step-body">{children}</div>
    </section>
  )
}

// ── SubjectLine ──────────────────────────────────────────────────────────────

function SubjectLine({ subject }: { subject: ReportSubject }) {
  return (
    <div className="vd__subject">
      <b>{subject.name}</b>
      <span>{subject.position}</span>
      <span>
        재직 {subject.hire_date || '—'} ~ {subject.resignation_date || '—'}
      </span>
    </div>
  )
}

// ── Step content builders ────────────────────────────────────────────────────

function Step1({ subject }: { subject: ReportSubject }) {
  const months = calcMonths(subject.hire_date, subject.resignation_date)
  return (
    <>
      <p>
        {subject.name}은(는) {subject.position}으로 {subject.hire_date}부터{' '}
        {subject.resignation_date}까지 {months > 0 ? `${months}개월간 ` : ''}재직했습니다.
      </p>
      <p>분석은 퇴사 전 최근 90일 활동을 기준으로 기준선 행동 패턴을 수립했습니다.</p>
    </>
  )
}

function Step2({ emails }: { emails: SuspiciousEmail[] }) {
  if (emails.length === 0) {
    return <p>분석 기간 내 외부 발신 의심 이메일이 탐지되지 않았습니다.</p>
  }
  const counts = channelCounts(emails)
  const attachCount = emails.filter((e) => e.has_attachment).length
  const topRecipients = [...new Set(emails.map((e) => e.recipient))].slice(0, 3)
  return (
    <>
      <p>
        외부 채널로 발신된 의심 이메일 {emails.length}건이 탐지되었습니다.
        {counts && ` (${counts})`}
      </p>
      {attachCount > 0 && (
        <p>이 중 첨부 파일이 포함된 이메일은 {attachCount}건입니다.</p>
      )}
      {topRecipients.length > 0 && (
        <p>주요 수신자: {topRecipients.join(', ')}</p>
      )}
    </>
  )
}

function Step3({ files }: { files: SuspiciousFile[] }) {
  if (files.length === 0) {
    return <p>의심 민감 파일이 식별되지 않았습니다.</p>
  }
  const cats = catCounts(files)
  const allKw = [...new Set(files.flatMap((f) => f.matched_keywords))].slice(0, 5)
  return (
    <>
      <p>민감도 분류 대상 파일 {files.length}건이 식별되었습니다.</p>
      {cats.length > 0 && (
        <p>
          {cats.map(([cat, n]) => `${sensitivityCategoryPlain(cat)} ${n}건`).join(', ')}
          {cats.length > 0 ? ' 등이 포함됩니다.' : ''}
        </p>
      )}
      {allKw.length > 0 && <p>주요 탐지 키워드: {allKw.join(', ')}</p>}
    </>
  )
}

function Step4({ behavior }: { behavior: BehaviorSummary }) {
  const { overview, key_behaviors, deleted_files, out_of_hours_activity, notes } = behavior
  if (overview || (key_behaviors && key_behaviors.length > 0)) {
    return (
      <>
        {overview && <p>{overview}</p>}
        {key_behaviors?.map((b, i) => (
          <p key={i} className="vd__step-bullet">· {b}</p>
        ))}
      </>
    )
  }
  const delCount = deleted_files?.length ?? 0
  const oohCount = out_of_hours_activity?.length ?? 0
  if (delCount === 0 && oohCount === 0 && !notes) {
    return <p>특이한 행동 이상 패턴이 발견되지 않았습니다.</p>
  }
  return (
    <>
      {delCount > 0 && <p>퇴사 직전 삭제된 파일 {delCount}건이 탐지되었습니다.</p>}
      {oohCount > 0 && <p>업무 외 시간 이상 활동 {oohCount}건이 탐지되었습니다.</p>}
      {notes && <p>{notes}</p>}
    </>
  )
}

function Step5({ breakdown }: { breakdown: RiskBreakdown }) {
  const ce = breakdown.counter_evidence ?? 0
  if (ce < 0) {
    const falseCount = Math.round(Math.abs(ce) / 20)
    return (
      <p>
        반증 {falseCount}건이 확인되어 {Math.abs(ce)}점이 감점되었습니다.
        일부 항목은 정상 업무 행위로 판단되어 위험 점수에서 제외되었습니다.
      </p>
    )
  }
  return (
    <p>유의미한 반증 근거가 발견되지 않았습니다. 탐지된 의심 항목 전체가 유출 행위로 판단됩니다.</p>
  )
}

function FinalSection({
  verdict,
  risk_score,
  risk_breakdown,
}: {
  verdict: string
  risk_score: number
  risk_breakdown: RiskBreakdown
}) {
  const bdText = breakdownSentence(risk_breakdown)
  return (
    <>
      <p>
        위 분석을 종합한 리스크 스코어는 <strong>{risk_score}점</strong>으로,{' '}
        <strong>{verdict}</strong> 판정을 내렸습니다.
      </p>
      {bdText && <p className="vd__step-muted">점수 구성: {bdText}</p>}
    </>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

function verdictColor(verdict: string): string {
  if (verdict === 'HIGH')   return 'var(--sev-high)'
  if (verdict === 'MEDIUM') return 'var(--sev-med)'
  if (verdict === 'LOW')    return 'var(--sev-low)'
  return 'var(--sev-clean)'
}

function verdictHeroClass(verdict: string): string {
  if (verdict === 'HIGH')   return 'vd__hero--high'
  if (verdict === 'MEDIUM') return 'vd__hero--med'
  if (verdict === 'LOW')    return 'vd__hero--low'
  return 'vd__hero--alert'
}

// ── ExfiltrationReportView ───────────────────────────────────────────────────

function ExfiltrationReportView({
  report,
  narrative,
}: {
  report: ExfiltrationReport
  narrative?: AdminNarrative
}) {
  const color = verdictColor(report.verdict)
  return (
    <div className="vd">
      <header className={`vd__hero ${verdictHeroClass(report.verdict)}`}>
        <div className="vd__verdict">
          <VerdictBadge verdict={report.verdict} />
          <SubjectLine subject={report.subject} />
        </div>
        <div className="vd__score">
          <span className="vd__score-grade" style={{ color }}>{report.verdict}</span>
          <span className="vd__score-label">위험 등급</span>
        </div>
      </header>

      {narrative?.review_guide && (
        <section className="vd__review-guide">
          <h3 className="vd__review-guide-title">검토 가이드</h3>
          <p>{narrative.review_guide}</p>
        </section>
      )}

      <p className="vd__summary">{report.summary}</p>

      <StepSection num={1} title="기준선 수립">
        {narrative?.step1?.length
          ? <NarrativeBullets items={narrative.step1} />
          : <Step1 subject={report.subject} />}
      </StepSection>

      <StepSection num={2} title="유출 채널 탐지">
        {narrative?.step2?.length
          ? <NarrativeBullets items={narrative.step2} />
          : <Step2 emails={report.suspicious_emails} />}
      </StepSection>

      <StepSection num={3} title="민감 파일 분류">
        {narrative?.step3?.length
          ? <NarrativeBullets items={narrative.step3} />
          : <Step3 files={report.suspicious_files} />}
      </StepSection>

      <StepSection num={4} title="행동 패턴 분석">
        {narrative?.step4?.length
          ? <NarrativeBullets items={narrative.step4} />
          : <Step4 behavior={report.behavior_summary} />}
      </StepSection>

      <StepSection num={5} title="반증 검증">
        {narrative?.step5?.length
          ? <NarrativeBullets items={narrative.step5} />
          : <Step5 breakdown={report.risk_breakdown} />}
      </StepSection>

      <StepSection num={0} title="최종 판정" final>
        {narrative?.final?.length
          ? <NarrativeBullets items={narrative.final} />
          : <FinalSection
              verdict={report.verdict}
              risk_score={report.risk_score}
              risk_breakdown={report.risk_breakdown}
            />}
      </StepSection>
    </div>
  )
}

// ── CleanReportView ──────────────────────────────────────────────────────────

function CleanReportView({ report }: { report: CleanReport }) {
  const a = report.analysis_summary
  const metrics: { label: string; value: number }[] = [
    { label: '분석 이메일', value: a.emails_analyzed },
    { label: '분석 파일', value: a.files_analyzed },
    { label: '발견 이상징후', value: a.anomalies_found },
    { label: '제거된 오탐', value: a.false_positives_removed },
  ]
  return (
    <div className="vd">
      <header className="vd__hero vd__hero--clean">
        <div className="vd__verdict">
          <VerdictBadge verdict="CLEAN" />
          <SubjectLine subject={report.subject} />
        </div>
        <span className="vd__cert">✔ 클린 인증서</span>
      </header>

      <p className="vd__summary">{report.summary}</p>

      <section className="vd__section">
        <h3 className="vd__h">분석 요약</h3>
        <div className="vd__metrics">
          {metrics.map((m) => (
            <div key={m.label} className="vd__metric">
              <span className="vd__metric-num">{m.value}</span>
              <span className="vd__metric-label">{m.label}</span>
            </div>
          ))}
        </div>
        {report.issued_at && (
          <div className="vd__issued">발급 시각 · {formatDate(report.issued_at)}</div>
        )}
      </section>
    </div>
  )
}

// ── VerdictViewer (exported) ─────────────────────────────────────────────────

export function VerdictViewer({ sessionId }: { sessionId: string | null; layout: ConsoleLayout }) {
  const { data, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId as string),
    enabled: sessionId != null,
  })

  const classified = data ? classifyReport(data.report_json) : null

  const { data: narrative } = useQuery<AdminNarrative>({
    queryKey: ['admin-narrative', sessionId],
    queryFn: () => fetchAdminNarrative(sessionId!),
    enabled: !!sessionId && classified?.kind === 'exfiltration',
    retry: false,
  })

  if (sessionId == null) {
    return (
      <div className="ph">
        <span className="ph__mark" aria-hidden="true">◇</span>
        <span className="ph__txt">점검 결과 목록에서 세션을 선택하세요</span>
      </div>
    )
  }
  if (isError) {
    return <div className="table__msg">세션 조회 실패 — 백엔드 응답을 확인하세요</div>
  }
  if (isLoading || !data) {
    return <div className="table__msg">점검 보고서 불러오는 중…</div>
  }

  if (!classified || classified.kind === 'invalid') {
    return (
      <div className="table__msg">
        리포트를 표시할 수 없습니다{classified?.kind === 'invalid' ? ` — ${classified.reason}` : ''}
      </div>
    )
  }
  if (classified.kind === 'clean') {
    return <CleanReportView report={classified.report} />
  }
  return <ExfiltrationReportView report={classified.report} narrative={narrative} />
}
