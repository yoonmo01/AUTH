// Pure layout for the evidence network graph (레이아웃 개선 S3).
// Node types are arranged along a primary axis (evidence-flow order); nodes
// of the same type stack along the cross axis. Direction flips the axes:
//   horizontal → layers left→right  (wide focused panel)
//   vertical   → layers top→down    (narrow expanded panel)
// Side-effect free so it can be unit tested in isolation.

import { Position } from '@xyflow/react'
import type { GraphNode, NodeType } from './types'

export type LayoutDirection = 'horizontal' | 'vertical'

export interface PositionedNode {
  id: string
  x: number
  y: number
  sourcePosition: Position
  targetPosition: Position
}

// Evidence-flow order of node types along the primary axis.
export const TYPE_ORDER: NodeType[] = [
  'user',
  'email_identity',
  'email',
  'file',
  'external_recipient',
  'entity',
  'event',
]

const HORIZONTAL = { layerGap: 250, nodeGap: 92 }
const VERTICAL = { layerGap: 120, nodeGap: 210 }

/**
 * Place graph nodes on a 2D canvas. Nodes whose type is not in TYPE_ORDER
 * are skipped. Returns one positioned entry per laid-out node.
 */
export function layoutGraphNodes(
  nodes: GraphNode[],
  direction: LayoutDirection,
): PositionedNode[] {
  const rowInLayer = new Map<NodeType, number>()
  const out: PositionedNode[] = []

  for (const node of nodes) {
    const layer = TYPE_ORDER.indexOf(node.node_type)
    if (layer < 0) continue
    const row = rowInLayer.get(node.node_type) ?? 0
    rowInLayer.set(node.node_type, row + 1)

    if (direction === 'horizontal') {
      out.push({
        id: node.node_id,
        x: layer * HORIZONTAL.layerGap,
        y: row * HORIZONTAL.nodeGap,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })
    } else {
      out.push({
        id: node.node_id,
        x: row * VERTICAL.nodeGap,
        y: layer * VERTICAL.layerGap,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      })
    }
  }
  return out
}
