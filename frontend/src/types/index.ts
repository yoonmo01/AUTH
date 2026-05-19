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
// Investigation Cases & Findings
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
}

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
