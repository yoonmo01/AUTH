import { useQuery } from '@tanstack/react-query'
import { fetchSession } from '../api/client'
import { classifyReport } from '../report'
import { channelLabel, nodeTypeLabel, relationLabel } from '../reportLabels'
import { formatDate, formatSize } from '../format'
import { buildDownloadFilename } from '../downloadFilename'
import { VerdictBadge } from './VerdictBadge'
import { ExpandableRow } from './ExpandableRow'
import type { ConsoleLayout } from '../consoleLayout'
import type {
  Session,
  ExfiltrationReport,
  CleanReport,
  ReportSubject,
  RiskBreakdown,
  BehaviorSummary,
  ReportTimelineEntry,
} from '../types'

const RISK_LABELS: { key: keyof RiskBreakdown; label: string }[] = [
  { key: 'cross_ref', label: '교차 매칭' },
  { key: 'deleted_files', label: '파일 삭제' },
  { key: 'anon_channel', label: '익명 채널' },
  { key: 'anomaly', label: '행동 이상' },
  { key: 'counter_evidence', label: '반증 감점' },
]

// Print the verdict report to PDF. The print-only stylesheet (App.css)
// hides the console chrome; document.title is swapped so the print dialog's
// default "save as PDF" filename matches the report.
// Exported so the action button can live in ContentViewer's tab bar.
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

function RiskBreakdownSection({ breakdown }: { breakdown: RiskBreakdown }) {
  const rows = RISK_LABELS.filter((r) => typeof breakdown[r.key] === 'number')
  return (
    <section className="vd__section">
      <h3 className="vd__h">점수 구성</h3>
      {rows.length === 0 ? (
        <div className="table__msg">점수 구성 내역 없음</div>
      ) : (
        <ul className="vd__risk">
          {rows.map((r) => {
            const value = breakdown[r.key] as number
            const penalty = value < 0
            return (
              <li key={r.key} className="vd__risk-row">
                <span className="vd__risk-label">{r.label}</span>
                <span
                  className={`vd__risk-val vd__risk-val--${penalty ? 'penalty' : 'gain'}`}
                >
                  {penalty ? value : `+${value}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function BehaviorSection({ behavior, layout }: { behavior: BehaviorSummary; layout: ConsoleLayout }) {
  const { highlight_dates, deleted_files, out_of_hours_activity, notes, overview, key_behaviors } = behavior
  const tableMode = layout === 'focused' ? 'table--wrap' : 'table--fixed'
  const useRow = layout === 'expanded'

  // Agent report format: overview + key_behaviors
  if (overview || (key_behaviors && key_behaviors.length > 0)) {
    return (
      <section className="vd__section">
        <h3 className="vd__h">행동 이상</h3>
        {overview && <p className="vd__notes">{overview}</p>}
        {key_behaviors && key_behaviors.length > 0 && (
          <ul className="vd__behaviors">
            {key_behaviors.map((b, i) => (
              <li key={i} className="vd__behavior">{b}</li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  // Legacy format
  const empty =
    highlight_dates.length === 0 &&
    deleted_files.length === 0 &&
    out_of_hours_activity.length === 0 &&
    !notes
  return (
    <section className="vd__section">
      <h3 className="vd__h">행동 이상</h3>
      {empty ? (
        <div className="table__msg">행동 이상 내역 없음</div>
      ) : (
        <>
          {highlight_dates.length > 0 && (
            <div className="vd__dates">
              {highlight_dates.map((d) => (
                <span key={d} className="vd__date">{d}</span>
              ))}
            </div>
          )}
          {deleted_files.length > 0 && (
            <table className={`table ${tableMode}`}>
              <colgroup>
                <col style={{ width: useRow ? '26%' : '28%' }} />
                <col style={{ width: useRow ? '18%' : '20%' }} />
                <col style={{ width: useRow ? '11%' : '12%' }} />
                <col style={{ width: useRow ? '40%' : '40%' }} />
                {useRow && <col style={{ width: '5%' }} />}
              </colgroup>
              <thead>
                <tr>
                  <th>삭제 파일</th>
                  <th>삭제 시각</th>
                  <th>크기</th>
                  <th>사유</th>
                  {useRow && <th aria-label="펼치기" />}
                </tr>
              </thead>
              <tbody>
                {deleted_files.map((f, i) =>
                  useRow ? (
                    <ExpandableRow key={i}>
                      <td className="table__name">{f.original_filename}</td>
                      <td className="table__num">{formatDate(f.deleted_at)}</td>
                      <td className="table__num">{formatSize(f.file_size_bytes)}</td>
                      <td>{f.reason}</td>
                    </ExpandableRow>
                  ) : (
                    <tr key={i}>
                      <td className="table__name">{f.original_filename}</td>
                      <td className="table__num">{formatDate(f.deleted_at)}</td>
                      <td className="table__num">{formatSize(f.file_size_bytes)}</td>
                      <td>{f.reason}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          {out_of_hours_activity.length > 0 && (
            <table className={`table ${tableMode}`}>
              <colgroup>
                <col style={{ width: useRow ? '16%' : '18%' }} />
                <col style={{ width: useRow ? '20%' : '22%' }} />
                <col style={{ width: useRow ? '59%' : '60%' }} />
                {useRow && <col style={{ width: '5%' }} />}
              </colgroup>
              <thead>
                <tr>
                  <th>업무 외 활동</th>
                  <th>시각</th>
                  <th>상세</th>
                  {useRow && <th aria-label="펼치기" />}
                </tr>
              </thead>
              <tbody>
                {out_of_hours_activity.map((a, i) =>
                  useRow ? (
                    <ExpandableRow key={i}>
                      <td>{a.event_type}</td>
                      <td className="table__num">{formatDate(a.event_at)}</td>
                      <td>{a.detail}</td>
                    </ExpandableRow>
                  ) : (
                    <tr key={i}>
                      <td>{a.event_type}</td>
                      <td className="table__num">{formatDate(a.event_at)}</td>
                      <td>{a.detail}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          {notes && <p className="vd__notes">{notes}</p>}
        </>
      )}
    </section>
  )
}

function TimelineSection({ timeline }: { timeline: ReportTimelineEntry[] }) {
  return (
    <section className="vd__section">
      <h3 className="vd__h">타임라인</h3>
      {timeline.length === 0 ? (
        <div className="table__msg">타임라인 내역 없음</div>
      ) : (
        <ul className="vd__tl">
          {timeline.map((entry) => (
            <li key={entry.date} className="vd__tl-entry">
              <span className="vd__tl-date">{entry.date}</span>
              <ul className="vd__tl-events">
                {entry.events.map((ev, i) => (
                  <li key={i}>{ev}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

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

function ExfiltrationReportView({ report, layout }: { report: ExfiltrationReport; layout: ConsoleLayout }) {
  const { evidence_network: net } = report
  const isFocused = layout === 'focused'
  return (
    <div className="vd">
      <header className="vd__hero vd__hero--alert">
        <div className="vd__verdict">
          <VerdictBadge verdict={report.verdict} />
          <SubjectLine subject={report.subject} />
        </div>
        <div className="vd__score">
          <span className="vd__score-num">{report.risk_score}</span>
          <span className="vd__score-label">RISK SCORE</span>
        </div>
      </header>

      <p className="vd__summary">{report.summary}</p>

      <RiskBreakdownSection breakdown={report.risk_breakdown} />

      <section className="vd__section">
        <h3 className="vd__h">민감 파일 ({report.suspicious_files.length})</h3>
        {report.suspicious_files.length === 0 ? (
          <div className="table__msg">민감 파일 없음</div>
        ) : isFocused ? (
          <table className="table table--wrap">
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>파일명</th>
                <th>민감도</th>
                <th>분류</th>
                <th>매칭 키워드</th>
                <th>경로</th>
              </tr>
            </thead>
            <tbody>
              {report.suspicious_files.map((f) => (
                <tr key={f.file_id}>
                  <td className="table__name">{f.filename}</td>
                  <td className="table__num">{(f.sensitivity_score * 100).toFixed(0)}%</td>
                  <td><span className="table__cat">{f.sensitivity_category}</span></td>
                  <td className="table__path">{f.matched_keywords.join(', ') || '—'}</td>
                  <td className="table__path">{f.relative_path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table table--fixed">
            <colgroup>
              <col style={{ width: '40%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '35%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>파일명</th>
                <th>분류</th>
                <th>매칭 키워드</th>
                <th aria-label="펼치기" />
              </tr>
            </thead>
            <tbody>
              {report.suspicious_files.map((f) => (
                <ExpandableRow key={f.file_id}>
                  <td className="table__name">{f.filename}</td>
                  <td><span className="table__cat">{f.sensitivity_category}</span></td>
                  <td className="table__path">{f.matched_keywords.join(', ') || '—'}</td>
                </ExpandableRow>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="vd__section">
        <h3 className="vd__h">의심 이메일 ({report.suspicious_emails.length})</h3>
        {report.suspicious_emails.length === 0 ? (
          <div className="table__msg">의심 이메일 없음</div>
        ) : isFocused ? (
          <table className="table table--wrap">
            <colgroup>
              <col style={{ width: '10%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>채널</th>
                <th>제목</th>
                <th>발신자</th>
                <th>수신자</th>
                <th>발신시각</th>
                <th>첨부</th>
                <th>의심 사유</th>
                <th>가중치</th>
              </tr>
            </thead>
            <tbody>
              {report.suspicious_emails.map((e) => (
                <tr key={e.email_id}>
                  <td><span className="table__cat">{channelLabel(e.channel_type)}</span></td>
                  <td className="table__name">{e.subject}</td>
                  <td className="table__path">{e.sender}</td>
                  <td className="table__path">{e.recipient}</td>
                  <td className="table__num">{formatDate(e.sent_at)}</td>
                  <td>{e.has_attachment ? '있음' : '—'}</td>
                  <td className="table__path">{e.suspicion_reason}</td>
                  <td className="table__num">{e.risk_weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table table--fixed">
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '42%' }} />
              <col style={{ width: '35%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>채널</th>
                <th>제목</th>
                <th>수신자</th>
                <th aria-label="펼치기" />
              </tr>
            </thead>
            <tbody>
              {report.suspicious_emails.map((e) => (
                <ExpandableRow key={e.email_id}>
                  <td><span className="table__cat">{channelLabel(e.channel_type)}</span></td>
                  <td className="table__name">{e.subject}</td>
                  <td className="table__path">{e.recipient}</td>
                </ExpandableRow>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <BehaviorSection behavior={report.behavior_summary} layout={layout} />

      <TimelineSection timeline={report.timeline} />

      <section className="vd__section">
        <h3 className="vd__h">
          증거 네트워크 (노드 {net.nodes.length} · 엣지 {net.edges.length})
        </h3>
        <ul className="vd__net">
          {net.nodes.map((n) => (
            <li key={n.id} className="vd__net-node">
              <span className="table__cat">{nodeTypeLabel(n.type)}</span>
              <span>{n.label}</span>
            </li>
          ))}
        </ul>
        <ul className="vd__net">
          {net.edges.map((e, i) => {
            const src = net.nodes.find((n) => n.id === e.source)
            const tgt = net.nodes.find((n) => n.id === e.target)
            return (
              <li key={i} className="vd__net-edge">
                <span>{src?.label ?? e.source}</span>
                <span className="vd__rel">─ {relationLabel(e.relation)} →</span>
                <span>{tgt?.label ?? e.target}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

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

export function VerdictViewer({ sessionId, layout }: { sessionId: string | null; layout: ConsoleLayout }) {
  const { data, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId as string),
    enabled: sessionId != null,
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

  const classified = classifyReport(data.report_json)
  if (classified.kind === 'invalid') {
    return (
      <div className="table__msg">
        리포트를 표시할 수 없습니다 — {classified.reason}
      </div>
    )
  }
  if (classified.kind === 'clean') {
    return <CleanReportView report={classified.report} />
  }
  return <ExfiltrationReportView report={classified.report} layout={layout} />
}
