import { useQuery } from '@tanstack/react-query'
import { fetchSummary } from '../api/client'
import { categoryLabel } from '../lib/categories'
import type { Summary, FileCategory } from '../types'

export type TreeSelected = FileCategory | 'all'

type Props = {
  selected: TreeSelected
  onSelect: (s: TreeSelected) => void
}

export function TreeViewer({ selected, onSelect }: Props) {
  const { data, isLoading, isError } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: fetchSummary,
  })

  // etl_status rows are per (category, etl_status) — aggregate per category.
  const counts = new Map<string, number>()
  for (const row of data?.etl_status ?? []) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + (row.cnt ?? 0))
  }
  const categories = [...counts.entries()]
  const total = categories.reduce((n, [, c]) => n + c, 0)

  return (
    <div className="zone">
      <div className="zone__tab">TREE · 데이터 소스</div>
      <div className="zone__body zone__body--tree">
        {isError && <div className="tree__msg">요약 조회 실패</div>}
        {isLoading && <div className="tree__msg">불러오는 중…</div>}
        {!isLoading && !isError && (
          <ul className="tree" role="tree">
            <li>
              <button
                type="button"
                className={`tree__node tree__node--root${selected === 'all' ? ' is-on' : ''}`}
                onClick={() => onSelect('all')}
                role="treeitem"
                aria-selected={selected === 'all'}
              >
                <span className="tree__mark" aria-hidden="true">▣</span>
                <span className="tree__label">전체 파일</span>
                <span className="tree__count">{total.toLocaleString()}</span>
              </button>
              <ul className="tree__children">
                {categories.map(([cat, cnt]) => {
                  const on = selected === cat
                  return (
                    <li key={cat}>
                      <button
                        type="button"
                        className={`tree__node${on ? ' is-on' : ''}`}
                        onClick={() => onSelect(cat as FileCategory)}
                        role="treeitem"
                        aria-selected={on}
                      >
                        <span className="tree__mark" aria-hidden="true">▸</span>
                        <span className="tree__label">{categoryLabel(cat)}</span>
                        <span className="tree__count">{cnt.toLocaleString()}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
