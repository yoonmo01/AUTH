import type { ConsoleLayout } from '../consoleLayout'

// Header switch — flips the console between the verdict-focused layout and
// the full file workspace.
const OPTIONS: { value: ConsoleLayout; label: string }[] = [
  { value: 'focused', label: '판정 크게 보기' },
  { value: 'expanded', label: '파일 모두 보기' },
]

type Props = {
  layout: ConsoleLayout
  onToggle: () => void
}

export function LayoutToggle({ layout, onToggle }: Props) {
  return (
    <div className="ltoggle" role="group" aria-label="콘솔 레이아웃 전환">
      {OPTIONS.map((opt) => {
        const on = layout === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            className={`ltoggle__opt${on ? ' ltoggle__opt--on' : ''}`}
            aria-pressed={on}
            onClick={() => {
              if (!on) onToggle()
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
