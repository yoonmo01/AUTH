import type { FileCategory } from './types'

export const CATEGORY_LABELS: Record<string, string> = {
  document: '문서',
  image: '이미지',
  audio: '오디오',
  email_store: '이메일 저장소',
  archive: '아카이브',
  system_artifact: '시스템 아티팩트',
  unknown: '미분류',
}

export function categoryLabel(c: FileCategory | string): string {
  return CATEGORY_LABELS[c] ?? c
}
