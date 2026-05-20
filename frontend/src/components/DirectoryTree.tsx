import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFiles } from '../api/client'
import { buildDirectoryTree, type TreeNode } from '../directoryTree'
import type { FileRecord } from '../types'

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeNode
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
}) {
  const pad = { paddingLeft: `${12 + depth * 14}px` }

  if (node.kind === 'file') {
    return (
      <li>
        <div className="dt__row" style={pad}>
          <span className="dt__caret" aria-hidden="true" />
          <span
            className={`dt__cov dt__cov--${node.investigated ? 'full' : 'none'}`}
            title={node.investigated ? '조사됨' : '미조사'}
            aria-hidden="true"
          />
          <span className="dt__name" title={node.name}>{node.name}</span>
        </div>
      </li>
    )
  }

  const isCollapsed = collapsed.has(node.path)
  return (
    <li>
      <button
        type="button"
        className="dt__row dt__row--dir"
        style={pad}
        onClick={() => onToggle(node.path)}
      >
        <span className="dt__caret" aria-hidden="true">
          {node.children.length > 0 ? (isCollapsed ? '▸' : '▾') : ''}
        </span>
        <span
          className={`dt__cov dt__cov--${node.coverage}`}
          title={`조사 범위: ${node.coverage}`}
          aria-hidden="true"
        />
        <span className="dt__name" title={node.name}>{node.name}</span>
      </button>
      {!isCollapsed && node.children.length > 0 && (
        <ul className="dt__children">
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function DirectoryTree() {
  const { data, isLoading, isError } = useQuery<FileRecord[]>({
    queryKey: ['files', 'directory-tree'],
    queryFn: () => fetchFiles('', undefined, 1000),
  })

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const root = useMemo(() => buildDirectoryTree(data ?? []), [data])

  return (
    <div className="zone">
      <div className="zone__tab">DIRECTORY · C:</div>
      <div className="zone__body zone__body--tree">
        {isError ? (
          <div className="tree__msg">디렉토리 조회 실패 — 백엔드 응답을 확인하세요</div>
        ) : isLoading ? (
          <div className="tree__msg">불러오는 중…</div>
        ) : root.children.length === 0 ? (
          <div className="tree__msg">표시할 파일이 없습니다</div>
        ) : (
          <ul className="dt">
            {root.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={0}
                collapsed={collapsed}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
