// Korean label lookup for the final report's fixed enum codes.
// Unknown codes fall back to the raw value so the UI never breaks.

import type { ChannelType, EvidenceNodeType, EvidenceRelation } from './types'

const CHANNEL_LABELS: Record<ChannelType, string> = {
  protonmail: 'ProtonMail',
  tmpbox: '임시 메일(tmpbox)',
  anonymous_channel: '익명 채널',
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
