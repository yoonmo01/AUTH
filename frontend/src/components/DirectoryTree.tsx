import { useMemo, useState } from 'react'
import { buildDirectoryTree, type TreeNode } from '../directoryTree'
import directoryStructure from '../fixtures/directory-structure.json'

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
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

  const isOpen = expanded.has(node.path)
  return (
    <li>
      <button
        type="button"
        className="dt__row dt__row--dir"
        style={pad}
        onClick={() => onToggle(node.path)}
      >
        <span className="dt__caret" aria-hidden="true">
          {node.children.length > 0 ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span
          className={`dt__cov dt__cov--${node.coverage}`}
          title={`조사 범위: ${node.coverage}`}
          aria-hidden="true"
        />
        <span className="dt__name" title={node.name}>{node.name}</span>
      </button>
      {isOpen && node.children.length > 0 && (
        <ul className="dt__children">
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function DirectoryTree() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const root = useMemo(() => buildDirectoryTree(directoryStructure), [])

  return (
    <div className="zone">
      <div className="zone__tab">DIRECTORY · C:</div>
      <div className="zone__body zone__body--tree">
        {root.children.length === 0 ? (
          <div className="tree__msg">표시할 디렉토리 구조가 없습니다</div>
        ) : (
          <ul className="dt">
            {root.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
