import { useQuery } from '@tanstack/react-query'
import { fetchSummary } from '../api/client'
import { categoryLabel } from '../categories'
import type { Summary, FileCategory } from '../types'

export type TreeSelected =
  | { kind: 'all' }
  | { kind: 'category'; category: FileCategory }
  | { kind: 'emails' }
  | { kind: 'entities' }

export function sameSelection(a: TreeSelected, b: TreeSelected): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'category' && b.kind === 'category') return a.category === b.category
  return true
}

type Props = {
  selected: TreeSelected
  onSelect: (s: TreeSelected) => void
}

type NodeProps = {
  on: boolean
  mark: string
  label: string
  count?: number
  root?: boolean
  onClick: () => void
}

function TreeNode({ on, mark, label, count, root, onClick }: NodeProps) {
  return (
    <button
      type="button"
      className={`tree__node${root ? ' tree__node--root' : ''}${on ? ' is-on' : ''}`}
      onClick={onClick}
      role="treeitem"
      aria-selected={on}
    >
      <span className="tree__mark" aria-hidden="true">{mark}</span>
      <span className="tree__label">{label}</span>
      {count !== undefined && (
        <span className="tree__count">{count.toLocaleString()}</span>
      )}
    </button>
  )
}

export function TreeViewer({ selected, onSelect }: Props) {
  const { data, isLoading, isError } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: fetchSummary,
  })

  // etl_status rows are per (category, etl_status) — aggregate per category.
  const counts = new Map<string, number>()
  for (const row of data?.etl_status ?? []) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + Number(row.cnt ?? 0))
  }
  const categories = [...counts.entries()]
  const fileTotal = categories.reduce((n, [, c]) => n + c, 0)

  return (
    <div className="zone">
      <div className="zone__tab">TREE · 데이터 소스</div>
      <div className="zone__body zone__body--tree">
        {isError && <div className="tree__msg">요약 조회 실패</div>}
        {isLoading && <div className="tree__msg">불러오는 중…</div>}
        {!isLoading && !isError && (
          <ul className="tree" role="tree">
            <li>
              <TreeNode
                root
                mark="▣"
                label="전체 파일"
                count={fileTotal}
                on={selected.kind === 'all'}
                onClick={() => onSelect({ kind: 'all' })}
              />
              <ul className="tree__children">
                {categories.map(([cat, cnt]) => {
                  const on =
                    selected.kind === 'category' && selected.category === cat
                  return (
                    <li key={cat}>
                      <TreeNode
                        mark="▸"
                        label={categoryLabel(cat)}
                        count={cnt}
                        on={on}
                        onClick={() =>
                          onSelect({ kind: 'category', category: cat as FileCategory })
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </li>
            <li>
              <TreeNode
                root
                mark="✉"
                label="Email Messages"
                count={data?.emails}
                on={selected.kind === 'emails'}
                onClick={() => onSelect({ kind: 'emails' })}
              />
            </li>
            <li>
              <TreeNode
                root
                mark="◈"
                label="Entities"
                count={data?.entities}
                on={selected.kind === 'entities'}
                onClick={() => onSelect({ kind: 'entities' })}
              />
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
