// Console layout mode (콘솔 개편 S2).
//   focused  — verdict-centric entry: 판정/네트워크/타임라인 탭 패널만
//   expanded — 4-zone workspace: 분류 트리 · 디렉토리 트리 · 파일 목록 · 탭 패널
// Pure so the toggle can be unit tested in isolation.

export type ConsoleLayout = 'focused' | 'expanded'

export const initialConsoleLayout: ConsoleLayout = 'focused'

export function toggleLayout(layout: ConsoleLayout): ConsoleLayout {
  return layout === 'focused' ? 'expanded' : 'focused'
}
