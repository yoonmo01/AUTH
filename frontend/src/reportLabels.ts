// Korean label lookup for the final report's fixed enum codes.
// Unknown codes fall back to the raw value so the UI never breaks.

import type {
  ChannelType,
  EmailRecord,
  EvidenceNodeType,
  EvidenceRelation,
  FileRecord,
  SuspiciousEmail,
  SuspiciousFile,
} from './types'

const CHANNEL_LABELS: Record<ChannelType, string> = {
  protonmail: 'ProtonMail',
  tmpbox: '임시 메일(tmpbox)',
  anonymous_channel: '익명 채널',
}

const CHANNEL_PLAIN_LABELS: Record<ChannelType, string> = {
  protonmail: '외부 메일(추적이 어려운 서비스)',
  tmpbox: '일회용 임시 메일',
  anonymous_channel: '익명 전송 경로',
}

// sensitivity_category 코드는 백엔드에서 자유 텍스트로 들어옴. 대표 케이스를
// 사람이 읽기 쉬운 표현으로 매핑하고, 매칭이 없으면 원문을 그대로 보여준다.
const SENSITIVITY_PLAIN_LABELS: Record<string, string> = {
  '단가/계약': '가격·계약 관련 회사 자료',
  '고객·거래처 정보': '고객·거래처 연락처',
  '인사/내부': '회사 내부·인사 자료',
  '영업/전략': '영업·전략 관련 자료',
  '기술/설계': '기술·설계 자료',
  '재무': '재무 관련 자료',
  '일반 업무': '일반 업무 자료',
}

const NODE_TYPE_LABELS: Record<EvidenceNodeType, string> = {
  USER: '사용자',
  FILE: '파일',
  EMAIL: '이메일',
  CHANNEL: '채널',
  LOG: '로그',
}

const RELATION_LABELS: Record<EvidenceRelation, string> = {
  USED_CHANNEL: '채널 사용',
  SENT_TO: '발송',
  ATTACHED: '첨부',
  ACCESSED: '접근',
  DELETED: '삭제',
  USED: '사용',
  TRIGGERED: '유발',
}

export function channelLabel(code: string): string {
  return CHANNEL_LABELS[code as ChannelType] ?? code
}

export function nodeTypeLabel(code: string): string {
  return NODE_TYPE_LABELS[code as EvidenceNodeType] ?? code
}

export function relationLabel(code: string): string {
  return RELATION_LABELS[code as EvidenceRelation] ?? code
}

export function channelPlain(code: string): string {
  return CHANNEL_PLAIN_LABELS[code as ChannelType] ?? code
}

export function sensitivityCategoryPlain(category: string): string {
  if (!category) return '분류되지 않은 자료'
  return SENSITIVITY_PLAIN_LABELS[category] ?? category
}

export function whyCheckForFile(file: SuspiciousFile): string {
  const cat = file.sensitivity_category
  if (cat === '단가/계약') return '거래 단가·계약 정보가 들어있어 외부 유출 시 큰 피해가 발생할 수 있어요'
  if (cat === '고객·거래처 정보') return '고객·거래처 연락처가 들어있어 외부로 나가면 안 되는 자료예요'
  if (cat === '인사/내부') return '회사 내부 자료라 외부 공유 시 문제가 될 수 있어요'
  if (cat === '영업/전략') return '영업·전략 정보라 경쟁사로 흘러가면 회사에 손해가 될 수 있어요'
  if (cat === '기술/설계') return '기술·설계 자료라 외부 유출이 엄격히 금지된 정보예요'
  if (cat === '재무') return '재무 관련 자료라 사내 한정으로 다뤄야 하는 정보예요'
  return '사내에서만 다뤄야 하는 자료로 분류돼 확인이 필요해요'
}

export function fileRecordFromSuspicious(file: SuspiciousFile): FileRecord {
  const dot = file.filename.lastIndexOf('.')
  return {
    id: file.file_id,
    filename: file.filename,
    extension: dot >= 0 ? file.filename.slice(dot) : '',
    category: 'document',
    file_size: null,
    file_modified_at: null,
    file_accessed_at: null,
    file_created_at: null,
    relative_path: file.relative_path,
    original_path: file.relative_path,
    sha256_hash: null,
    source_label: '',
    is_user_content: true,
    etl_status: '',
  }
}

export function emailRecordFromSuspicious(email: SuspiciousEmail): EmailRecord {
  return {
    id: email.email_id,
    subject: email.subject,
    sender: email.sender,
    sent_at: email.sent_at,
    body_preview: email.suspicion_reason,
    source_file: '',
    recipients_to: [email.recipient],
    has_attachments: email.has_attachment,
  }
}

export function whyCheckForEmail(email: SuspiciousEmail): string {
  const ch = email.channel_type
  if (ch === 'protonmail') return '회사 메일이 아닌 외부 서비스라 회사가 내용을 확인하기 어려운 경로예요'
  if (ch === 'tmpbox') return '일회용 임시 메일로 보낸 기록이라 추적이 어려운 경로예요'
  if (ch === 'anonymous_channel') return '익명 전송 경로라 회사가 정상적으로 확인하기 어려운 방식이에요'
  if (email.has_attachment) return '회사 자료가 첨부된 채로 외부로 발송된 기록이에요'
  return '평소 업무에서 사용하지 않는 경로로 메일이 발송됐어요'
}
