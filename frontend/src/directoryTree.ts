// Pure builder: nested directory structure → C: directory tree.
// Input is the raw nested form (stru.json shape): each node has a name, a
// type, and directories carry children. Folders aggregate an audit
// coverage from their descendant files. Side-effect free for unit testing.

export type Coverage = 'full' | 'partial' | 'none'

export interface DirNode {
  kind: 'dir'
  name: string
  path: string
  children: TreeNode[]
  coverage: Coverage
}

export interface FileNode {
  kind: 'file'
  name: string
  path: string
  investigated: boolean
}

export type TreeNode = DirNode | FileNode

// Raw nested input — the stru.json node shape.
export interface RawNode {
  name: string
  type: 'directory' | 'file'
  children?: RawNode[]
}

// Deterministic pseudo-random hash — same path always yields the same value
// so the builder stays pure and testable.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

// Demo coverage: ~35% of files are marked investigated, derived from the path
// hash so the marking is stable across renders.
function isInvestigated(path: string): boolean {
  return hashString(path) % 100 < 35
}

function isRawNode(v: unknown): v is RawNode {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as RawNode).name === 'string' &&
    ((v as RawNode).type === 'directory' || (v as RawNode).type === 'file')
  )
}

// Accept either a bare RawNode or a wrapper object { "<label>": RawNode }.
function unwrapRoot(raw: unknown): RawNode | null {
  if (isRawNode(raw)) return raw
  if (typeof raw === 'object' && raw !== null) {
    const first = Object.values(raw as Record<string, unknown>)[0]
    if (isRawNode(first)) return first
  }
  return null
}

function convert(raw: RawNode, parentPath: string): TreeNode {
  const path = parentPath ? `${parentPath}/${raw.name}` : raw.name
  if (raw.type === 'file') {
    return { kind: 'file', name: raw.name, path, investigated: isInvestigated(path) }
  }
  const children = (raw.children ?? []).map((child) => convert(child, path))
  return { kind: 'dir', name: raw.name, path, children, coverage: 'none' }
}

/** Aggregate folder coverage from descendant files. Mutates `dir.coverage`. */
export function computeCoverage(dir: DirNode): { total: number; done: number } {
  let total = 0
  let done = 0
  for (const child of dir.children) {
    if (child.kind === 'file') {
      total += 1
      if (child.investigated) done += 1
    } else {
      const sub = computeCoverage(child)
      total += sub.total
      done += sub.done
    }
  }
  dir.coverage =
    total === 0 ? 'none' : done === total ? 'full' : done === 0 ? 'none' : 'partial'
  return { total, done }
}

// Folders first, then by name — deterministic so the output is testable.
function sortTree(dir: DirNode): void {
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const child of dir.children) {
    if (child.kind === 'dir') sortTree(child)
  }
}

/**
 * Build the C: directory tree from the raw nested structure. Returns the
 * root directory node; invalid input yields an empty C: root.
 */
export function buildDirectoryTree(raw: unknown): DirNode {
  const root = unwrapRoot(raw)
  if (!root || root.type !== 'directory') {
    return { kind: 'dir', name: 'C', path: 'C', children: [], coverage: 'none' }
  }
  const tree = convert(root, '') as DirNode
  computeCoverage(tree)
  sortTree(tree)
  return tree
}
