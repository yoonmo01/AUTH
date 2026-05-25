import { describe, it, expect } from 'vitest'
import { buildDirectoryTree, computeCoverage, type DirNode, type RawNode } from './directoryTree'

function dir(node: { kind: string }): DirNode {
  if (node.kind !== 'dir') throw new Error('expected a directory node')
  return node as DirNode
}

// stru.json-style wrapper: { "<label>": rootNode }.
const SAMPLE = {
  사례_데모: {
    name: 'C',
    type: 'directory',
    children: [
      {
        name: 'Users',
        type: 'directory',
        children: [
          { name: 'a.txt', type: 'file' },
          {
            name: 'minsoo',
            type: 'directory',
            children: [{ name: 'b.txt', type: 'file' }],
          },
        ],
      },
      { name: 'pagefile.sys', type: 'file' },
    ],
  } satisfies RawNode,
}

describe('buildDirectoryTree', () => {
  it('returns an empty C: root for invalid input', () => {
    expect(buildDirectoryTree(null).children).toEqual([])
    expect(buildDirectoryTree({}).children).toEqual([])
    expect(buildDirectoryTree(buildDirectoryTree(null)).name).toBe('C')
  })

  it('unwraps the { label: rootNode } wrapper', () => {
    const root = buildDirectoryTree(SAMPLE)
    expect(root.name).toBe('C')
    expect(root.kind).toBe('dir')
  })

  it('also accepts a bare root node', () => {
    expect(buildDirectoryTree(SAMPLE.사례_데모).name).toBe('C')
  })

  it('converts nested directories and files with accumulated paths', () => {
    const root = buildDirectoryTree(SAMPLE)
    const users = dir(root.children[0])
    expect(users.name).toBe('Users')
    expect(users.path).toBe('C/Users')
    const minsoo = dir(users.children.find((c) => c.kind === 'dir')!)
    expect(minsoo.path).toBe('C/Users/minsoo')
    expect(minsoo.children[0].kind).toBe('file')
    expect(minsoo.children[0].path).toBe('C/Users/minsoo/b.txt')
  })

  it('sorts folders before files, each alphabetically', () => {
    const raw: RawNode = {
      name: 'C',
      type: 'directory',
      children: [
        { name: 'z.txt', type: 'file' },
        { name: 'Beta', type: 'directory', children: [] },
        { name: 'a.txt', type: 'file' },
        { name: 'Alpha', type: 'directory', children: [] },
      ],
    }
    expect(buildDirectoryTree(raw).children.map((c) => c.name)).toEqual([
      'Alpha', 'Beta', 'a.txt', 'z.txt',
    ])
  })

  it('is deterministic — same input yields an identical tree', () => {
    expect(JSON.stringify(buildDirectoryTree(SAMPLE))).toBe(
      JSON.stringify(buildDirectoryTree(SAMPLE)),
    )
  })
})

describe('computeCoverage', () => {
  const mkDir = (children: DirNode['children']): DirNode => ({
    kind: 'dir', name: 'D', path: 'D', coverage: 'none', children,
  })

  it('is full when every descendant file is investigated', () => {
    const d = mkDir([
      { kind: 'file', name: 'a', path: 'D/a', investigated: true },
      { kind: 'file', name: 'b', path: 'D/b', investigated: true },
    ])
    computeCoverage(d)
    expect(d.coverage).toBe('full')
  })

  it('is partial when only some are investigated', () => {
    const d = mkDir([
      { kind: 'file', name: 'a', path: 'D/a', investigated: true },
      { kind: 'file', name: 'b', path: 'D/b', investigated: false },
    ])
    computeCoverage(d)
    expect(d.coverage).toBe('partial')
  })

  it('is none when no file is investigated or the folder is empty', () => {
    const empty = mkDir([])
    computeCoverage(empty)
    expect(empty.coverage).toBe('none')

    const d = mkDir([{ kind: 'file', name: 'a', path: 'D/a', investigated: false }])
    computeCoverage(d)
    expect(d.coverage).toBe('none')
  })

  it('rolls coverage up through nested folders', () => {
    const sub = mkDir([{ kind: 'file', name: 'a', path: 'D/S/a', investigated: true }])
    sub.name = 'S'
    sub.path = 'D/S'
    const top = mkDir([sub, { kind: 'file', name: 'b', path: 'D/b', investigated: false }])
    computeCoverage(top)
    expect(top.coverage).toBe('partial')
  })
})
