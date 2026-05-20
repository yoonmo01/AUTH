import { describe, it, expect } from 'vitest'
import { Position } from '@xyflow/react'
import { layoutGraphNodes } from './graphLayout'
import type { GraphNode, NodeType } from './types'

function mk(node_id: string, node_type: NodeType): GraphNode {
  return { node_id, node_type, label: node_id, properties: {} }
}

describe('layoutGraphNodes', () => {
  it('returns an empty list for no nodes', () => {
    expect(layoutGraphNodes([], 'horizontal')).toEqual([])
  })

  it('horizontal — type layers spread along x, handles left/right', () => {
    const out = layoutGraphNodes([mk('u', 'user'), mk('f', 'file')], 'horizontal')
    const user = out.find((n) => n.id === 'u')!
    const file = out.find((n) => n.id === 'f')!
    // user is layer 0, file is layer 3 → file sits further right.
    expect(user.x).toBe(0)
    expect(file.x).toBeGreaterThan(user.x)
    expect(user.y).toBe(0)
    expect(user.sourcePosition).toBe(Position.Right)
    expect(user.targetPosition).toBe(Position.Left)
  })

  it('vertical — type layers spread along y, handles top/bottom', () => {
    const out = layoutGraphNodes([mk('u', 'user'), mk('f', 'file')], 'vertical')
    const user = out.find((n) => n.id === 'u')!
    const file = out.find((n) => n.id === 'f')!
    expect(user.y).toBe(0)
    expect(file.y).toBeGreaterThan(user.y)
    expect(user.x).toBe(0)
    expect(user.sourcePosition).toBe(Position.Bottom)
    expect(user.targetPosition).toBe(Position.Top)
  })

  it('stacks nodes of the same type along the cross axis', () => {
    const out = layoutGraphNodes([mk('u1', 'user'), mk('u2', 'user')], 'horizontal')
    expect(out[0].y).toBe(0)
    expect(out[1].y).toBeGreaterThan(0)
    expect(out[0].x).toBe(out[1].x)
  })

  it('skips nodes whose type is not in the layout order', () => {
    const out = layoutGraphNodes(
      [mk('u', 'user'), mk('x', 'mystery' as NodeType)],
      'horizontal',
    )
    expect(out.map((n) => n.id)).toEqual(['u'])
  })
})
