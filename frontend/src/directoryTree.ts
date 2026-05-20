// Pure builder: flat file list → nested C: directory tree (콘솔 개편 S3).
// Each file's path is split into segments; folders aggregate an investigation
// coverage from their descendant files. Side-effect free for unit testing.

import type { FileRecord } from './types'

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
  file: FileRecord
  investigated: boolean
}

export type TreeNode = DirNode | FileNode

// A file counts as investigated once ETL has fully processed it.
function isInvestigated(file: FileRecord): boolean {
  return file.etl_status === 'done'
}

function pathSegments(file: FileRecord): string[] {
  const raw = file.original_path || file.relative_path || ''
  return raw.split(/[/\\]/).filter((s) => s.length > 0)
}

function computeCoverage(dir: DirNode): { total: number; done: number } {
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
 * Build the C: directory tree from a flat file list. The first path segment
 * (the drive) becomes the root; intermediate segments become folders and the
 * last segment a file node. Folders carry an aggregated coverage marker.
 */
export function buildDirectoryTree(files: FileRecord[]): DirNode {
  const root: DirNode = { kind: 'dir', name: 'C:', path: 'C:', children: [], coverage: 'none' }

  for (const file of files) {
    const segs = pathSegments(file)
    if (segs.length === 0) continue

    let dir = root
    let path = root.path
    // segs[0] is the drive (root) — walk intermediate folders.
    for (let i = 1; i < segs.length - 1; i++) {
      const name = segs[i]
      path = `${path}/${name}`
      let next = dir.children.find(
        (c): c is DirNode => c.kind === 'dir' && c.name === name,
      )
      if (!next) {
        next = { kind: 'dir', name, path, children: [], coverage: 'none' }
        dir.children.push(next)
      }
      dir = next
    }

    const name = segs[segs.length - 1]
    dir.children.push({
      kind: 'file',
      name,
      path: `${path}/${name}`,
      file,
      investigated: isInvestigated(file),
    })
  }

  computeCoverage(root)
  sortTree(root)
  return root
}
