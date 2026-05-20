import { describe, it, expect } from 'vitest'
import { buildDirectoryTree, type DirNode, type TreeNode } from './directoryTree'
import type { FileRecord } from './types'

function mk(over: Partial<FileRecord> & { original_path: string }): FileRecord {
  return {
    id: over.id ?? over.original_path,
    filename: over.filename ?? 'f',
    extension: 'txt',
    category: 'document',
    file_size: 0,
    file_modified_at: null,
    file_accessed_at: null,
    file_created_at: null,
    relative_path: '',
    sha256_hash: null,
    source_label: 'C-drive image',
    is_user_content: true,
    etl_status: 'done',
    ...over,
  }
}

function dir(node: TreeNode): DirNode {
  if (node.kind !== 'dir') throw new Error('expected a directory node')
  return node
}

describe('buildDirectoryTree', () => {
  it('returns a C: root for an empty file list', () => {
    const root = buildDirectoryTree([])
    expect(root.name).toBe('C:')
    expect(root.children).toEqual([])
  })

  it('nests a single file under its path folders', () => {
    const root = buildDirectoryTree([
      mk({ original_path: 'C:/Users/minsoo/a.txt', filename: 'a.txt' }),
    ])
    const users = dir(root.children[0])
    expect(users.name).toBe('Users')
    const minsoo = dir(users.children[0])
    expect(minsoo.name).toBe('minsoo')
    expect(minsoo.children[0].kind).toBe('file')
    expect(minsoo.children[0].name).toBe('a.txt')
  })

  it('merges files sharing a folder path', () => {
    const root = buildDirectoryTree([
      mk({ original_path: 'C:/Docs/a.txt' }),
      mk({ original_path: 'C:/Docs/b.txt' }),
    ])
    expect(root.children).toHaveLength(1)
    expect(dir(root.children[0]).children).toHaveLength(2)
  })

  it('sorts folders before files, each alphabetically', () => {
    const root = buildDirectoryTree([
      mk({ original_path: 'C:/z.txt' }),
      mk({ original_path: 'C:/Beta/x.txt' }),
      mk({ original_path: 'C:/a.txt' }),
      mk({ original_path: 'C:/Alpha/y.txt' }),
    ])
    expect(root.children.map((c) => c.name)).toEqual(['Alpha', 'Beta', 'a.txt', 'z.txt'])
  })

  it('marks a file investigated only when etl_status is done', () => {
    const root = buildDirectoryTree([
      mk({ original_path: 'C:/d.txt', etl_status: 'done' }),
      mk({ original_path: 'C:/p.txt', etl_status: 'partial' }),
    ])
    const files = root.children.filter((c) => c.kind === 'file')
    expect(files[0].kind === 'file' && files[0].investigated).toBe(true)
    expect(files[1].kind === 'file' && files[1].investigated).toBe(false)
  })

  it('aggregates folder coverage: full / partial / none', () => {
    const full = buildDirectoryTree([
      mk({ original_path: 'C:/Full/a.txt', etl_status: 'done' }),
      mk({ original_path: 'C:/Full/b.txt', etl_status: 'done' }),
    ])
    expect(dir(full.children[0]).coverage).toBe('full')

    const partial = buildDirectoryTree([
      mk({ original_path: 'C:/Mix/a.txt', etl_status: 'done' }),
      mk({ original_path: 'C:/Mix/b.txt', etl_status: 'partial' }),
    ])
    expect(dir(partial.children[0]).coverage).toBe('partial')

    const none = buildDirectoryTree([
      mk({ original_path: 'C:/None/a.txt', etl_status: 'pending' }),
    ])
    expect(dir(none.children[0]).coverage).toBe('none')
  })

  it('rolls coverage up through nested folders', () => {
    const root = buildDirectoryTree([
      mk({ original_path: 'C:/Top/Sub/a.txt', etl_status: 'done' }),
      mk({ original_path: 'C:/Top/b.txt', etl_status: 'pending' }),
    ])
    expect(dir(root.children[0]).coverage).toBe('partial')
  })
})
