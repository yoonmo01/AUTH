// ============================================================
// Core evidence types (matching PostgreSQL schema)
// ============================================================

export type FileCategory =
  | 'document' | 'image' | 'audio'
  | 'email_store' | 'archive' | 'system_artifact' | 'unknown'

export interface FileRecord {
  id: string
  filename: string
  extension: string
  category: FileCategory
  file_size: number | null
  file_modified_at: string | null
  file_accessed_at: string | null
  file_created_at: string | null
  relative_path: string
  original_path: string
  sha256_hash: string | null
  source_label: string
  is_user_content: boolean
  etl_status: string
}

export interface EmailRecord {
  id: string
  subject: string | null
  sender: string | null
  sent_at: string | null
  body_preview?: string
  body_text?: string
  source_file: string
  recipients_to?: string[]
  recipients_cc?: string[]
  has_attachments?: boolean
}

export interface EntityRecord {
  id: string
  entity_type: string
  canonical_value: string
  mention_count: number
}

// ============================================================
// Graph (Network View)
// ============================================================

export type NodeType =
  | 'user' | 'file' | 'entity' | 'event'
  | 'email' | 'email_identity' | 'external_recipient'

export interface GraphNode {
  node_id: string
  node_type: NodeType
  label: string
  properties: Record<string, unknown>
}

export interface GraphEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  label: string
  confidence: number
  sent_at?: string | null
  event_at?: string | null
}

// ============================================================
// Activity Timeline
// ============================================================

export interface ActivityEvent {
  id: string
  event_type: string
  event_at: string | null
  actor: string | null
  process_name: string | null
  target_path: string | null
  url: string | null
  title: string | null
  confidence: number
  filename?: string | null
  category?: FileCategory | null
}

// ============================================================
// File content with backend highlights
// ============================================================

export interface HighlightSpan {
  start: number
  end: number
  label: string        // 'suspicious' | 'keyword' | 'entity' | 'pii' | ...
  note?: string
}

export interface FileContent {
  file_id: string
  filename: string
  content_kind: string    // 'text' | 'html' | 'image_desc' | 'stt'
  html: string            // backend가 <mark> 태그 삽입한 HTML
  highlights: HighlightSpan[]
  total_chunks: number
}

// ============================================================
// Audit Cases & Findings
// ============================================================

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export interface Finding {
  id: string
  finding_type: string
  severity: Severity
  title: string
  description: string | null
  agent_name: string | null
  confidence: number | null
  created_at: string
  evidence_count: number
}

export interface Case {
  id: string
  title: string
  description: string | null
  charge_type: string | null
  status: string
  created_at: string
  sessions?: Session[]
}

export interface Session {
  id: string
  query_text: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  verdict?: Verdict | null
  risk_score?: number | null
  report_json?: unknown
}

// ============================================================
// Final report — authoritative schema: final_report_schema.md
// ============================================================

export type Verdict = 'HIGH' | 'MEDIUM' | 'LOW' | 'CLEAN'

export type ChannelType = 'protonmail' | 'tmpbox' | 'anonymous_channel'
export type EvidenceNodeType = 'USER' | 'FILE' | 'EMAIL' | 'CHANNEL' | 'LOG'
export type EvidenceRelation =
  | 'USED_CHANNEL' | 'SENT_TO' | 'ATTACHED' | 'ACCESSED' | 'DELETED'
  | 'USED' | 'TRIGGERED'

export interface ReportSubject {
  name: string
  position: string
  hire_date: string
  resignation_date: string
}

// Risk score components. All optional — a report may omit any of them.
export interface RiskBreakdown {
  cross_ref?: number
  deleted_files?: number
  anon_channel?: number
  anomaly?: number
  counter_evidence?: number
}

export interface SuspiciousEmail {
  email_id: string
  channel_type: ChannelType
  sender: string
  recipient: string
  subject: string
  sent_at: string
  has_attachment: boolean
  suspicion_reason: string
  risk_weight: number
}

export interface SuspiciousFile {
  file_id: string
  filename: string
  relative_path: string
  sensitivity_score: number
  sensitivity_category: string
  matched_keywords: string[]
}

export interface DeletedFileEntry {
  original_filename: string
  deleted_at: string
  file_size_bytes: number
  reason: string
}

export interface OutOfHoursActivity {
  event_type: string
  event_at: string
  detail: string
}

export interface BehaviorSummary {
  highlight_dates: string[]
  deleted_files: DeletedFileEntry[]
  out_of_hours_activity: OutOfHoursActivity[]
  notes: string
  // agent report format
  overview?: string
  key_behaviors?: string[]
}

// Report timeline — date-grouped event strings. Distinct from the
// /timeline endpoint's ActivityEvent (see above).
export interface ReportTimelineEntry {
  date: string
  events: string[]
}

export interface EvidenceNode {
  id: string
  type: EvidenceNodeType
  label: string
}

export interface EvidenceEdge {
  source: string
  target: string
  relation: EvidenceRelation
}

export interface ExfiltrationReport {
  report_type: 'EXFILTRATION_SUSPECTED'
  verdict: 'HIGH' | 'MEDIUM' | 'LOW'
  risk_score: number
  risk_breakdown: RiskBreakdown
  subject: ReportSubject
  summary: string
  suspicious_emails: SuspiciousEmail[]
  suspicious_files: SuspiciousFile[]
  behavior_summary: BehaviorSummary
  timeline: ReportTimelineEntry[]
  evidence_network: { nodes: EvidenceNode[]; edges: EvidenceEdge[] }
}

export interface AnalysisSummary {
  emails_analyzed: number
  files_analyzed: number
  anomalies_found: number
  false_positives_removed: number
}

export interface CleanReport {
  report_type: 'CLEAN_CERTIFICATE'
  verdict: 'CLEAN'
  risk_score: number
  risk_breakdown: RiskBreakdown
  subject: ReportSubject
  summary: string
  analysis_summary: AnalysisSummary
  issued_at: string
}

export type ReportJson = ExfiltrationReport | CleanReport

export interface Summary {
  files: number
  emails: number
  documents: number
  activities: number
  entities: number
  chunks: number
  relations: number
  etl_status: { category: string; etl_status: string; cnt: number }[]
}

// ============================================================
// UI selection state
// ============================================================

export type TreeSection =
  | 'summary'
  | 'files'         // all files
  | 'files_by_cat'  // files filtered by category
  | 'emails'
  | 'findings'
  | 'entities'
  | 'network'
  | 'timeline'

export interface TreeSelection {
  section: TreeSection
  category?: FileCategory
  label?: string
}

export type ContentTab = 'file' | 'network' | 'timeline'

export interface SelectedItem {
  type: 'file' | 'email' | 'finding' | 'entity'
  id: string
  label: string
}

export interface AdminNarrative {
  step1: string[]
  step2: string[]
  step3: string[]
  step4: string[]
  step5: string[]
  final: string[]
  review_guide: string
}
