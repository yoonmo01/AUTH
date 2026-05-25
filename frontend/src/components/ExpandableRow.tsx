import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react'

type Props = {
  // Cell elements (one per data column). The trailing toggle column is
  // appended automatically.
  children: ReactNode
  className?: string
  style?: CSSProperties
  onClick?: MouseEventHandler<HTMLTableRowElement>
}

// Table row that watches its own cells for horizontal clipping and exposes a
// single ▼ button in a trailing column. Clicking the button toggles wrap mode
// for every cell in the row at once (see `.row-exp--open` in App.css).
export function ExpandableRow({ children, className, style, onClick }: Props) {
  const ref = useRef<HTMLTableRowElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (open) return
    const row = ref.current
    if (!row) return
    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))
      .filter((c) => !c.classList.contains('cell-toggle'))
    const check = () => {
      let any = false
      for (const td of cells) {
        if (td.scrollWidth > td.clientWidth + 1) {
          any = true
          break
        }
      }
      setOverflow(any)
    }
    check()
    const ro = new ResizeObserver(check)
    cells.forEach((td) => ro.observe(td))
    return () => ro.disconnect()
  }, [open, children])

  const cls = [open ? 'row-exp--open' : '', className].filter(Boolean).join(' ')

  return (
    <tr ref={ref} className={cls || undefined} style={style} onClick={onClick}>
      {children}
      <td className="cell-toggle">
        {overflow && (
          <button
            type="button"
            className="cell-toggle__btn"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
            aria-label={open ? '접기' : '펼치기'}
          >
            {open ? '▲' : '▼'}
          </button>
        )}
      </td>
    </tr>
  )
}
