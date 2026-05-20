import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  Position,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { fetchGraphNodes, fetchEmailEdges, fetchActivityEdges } from '../api/client'
import type { GraphNode, GraphEdge, NodeType } from '../types'

// Node types laid out left→right in evidence-flow order.
const TYPE_META: Record<NodeType, { label: string; col: number; style: CSSProperties }> = {
  user:               { label: '사용자',     col: 0, style: { background: '#1559ee', color: '#fff', borderColor: '#1559ee', borderRadius: 18 } },
  email_identity:     { label: '메일 계정',  col: 1, style: { background: '#e8f0ff', color: '#16222b', borderColor: '#3b82f6' } },
  email:              { label: '이메일',     col: 2, style: { background: '#e3f6fb', color: '#16222b', borderColor: '#0ea5d4' } },
  file:               { label: '파일',       col: 3, style: { background: '#ffffff', color: '#16222b', borderColor: '#bcc6cf' } },
  external_recipient: { label: '외부 수신자', col: 4, style: { background: '#fde6ea', color: '#e0274a', borderColor: '#e0274a', borderRadius: 18 } },
  entity:             { label: '엔티티',     col: 5, style: { background: '#fdf0db', color: '#8a5708', borderColor: '#c2790b' } },
  event:              { label: '이벤트',     col: 6, style: { background: '#eef1f5', color: '#16222b', borderColor: '#93a1ad', borderRadius: 3 } },
}
const ALL_TYPES = Object.keys(TYPE_META) as NodeType[]

const COL_W = 250
const ROW_H = 92

function buildNodes(graphNodes: GraphNode[], visible: Set<NodeType>): Node[] {
  const stacked = new Map<NodeType, number>()
  const out: Node[] = []
  for (const n of graphNodes) {
    const meta = TYPE_META[n.node_type]
    if (!meta || !visible.has(n.node_type)) continue
    const row = stacked.get(n.node_type) ?? 0
    stacked.set(n.node_type, row + 1)
    out.push({
      id: n.node_id,
      position: { x: meta.col * COL_W, y: row * ROW_H },
      data: { label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: 188, fontSize: 11, border: '1px solid', ...meta.style },
    })
  }
  return out
}

function buildEdges(
  emailEdges: GraphEdge[],
  activityEdges: GraphEdge[],
  nodeIds: Set<string>,
): Edge[] {
  const make = (e: GraphEdge, kind: 'email' | 'activity'): Edge | null => {
    // Drop dangling edges — a referenced node may be filtered out or missing.
    if (!nodeIds.has(e.source_id) || !nodeIds.has(e.target_id)) return null
    const isEmail = kind === 'email'
    return {
      id: e.edge_id,
      source: e.source_id,
      target: e.target_id,
      label: e.label,
      labelStyle: { fontSize: 9, fill: '#586875' },
      labelBgStyle: { fill: '#ffffff' },
      style: {
        stroke: isEmail ? '#0ea5d4' : '#586875',
        strokeWidth: isEmail ? Math.max(1, e.confidence * 3) : 1.5,
        strokeDasharray: isEmail ? '6 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: isEmail ? '#0ea5d4' : '#586875' },
    }
  }
  return [
    ...emailEdges.map((e) => make(e, 'email')),
    ...activityEdges.map((e) => make(e, 'activity')),
  ].filter((e): e is Edge => e !== null)
}

function NetworkInner() {
  const [visible, setVisible] = useState<Set<NodeType>>(() => new Set(ALL_TYPES))
  const { fitView } = useReactFlow()

  const nodesQ = useQuery({ queryKey: ['graph-nodes'], queryFn: () => fetchGraphNodes() })
  const emailQ = useQuery({ queryKey: ['graph-edges-email'], queryFn: () => fetchEmailEdges() })
  const actQ = useQuery({ queryKey: ['graph-edges-activity'], queryFn: () => fetchActivityEdges() })

  const { rfNodes, rfEdges } = useMemo(() => {
    const nodes = buildNodes(nodesQ.data ?? [], visible)
    const ids = new Set(nodes.map((n) => n.id))
    const edges = buildEdges(emailQ.data ?? [], actQ.data ?? [], ids)
    return { rfNodes: nodes, rfEdges: edges }
  }, [nodesQ.data, emailQ.data, actQ.data, visible])

  function toggle(type: NodeType) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  if (nodesQ.isError || emailQ.isError || actQ.isError) {
    return <div className="table__msg">그래프 조회 실패 — 백엔드 응답을 확인하세요</div>
  }
  if (nodesQ.isLoading || emailQ.isLoading || actQ.isLoading) {
    return <div className="table__msg">네트워크 그래프 불러오는 중…</div>
  }
  if ((nodesQ.data ?? []).length === 0) {
    return <div className="table__msg">표시할 그래프 노드가 없습니다</div>
  }

  return (
    <div className="net">
      <div className="net__bar">
        {ALL_TYPES.map((type) => (
          <label key={type} className="net__chk">
            <input
              type="checkbox"
              checked={visible.has(type)}
              onChange={() => toggle(type)}
            />
            <span className="net__swatch" style={TYPE_META[type].style} />
            {TYPE_META[type].label}
          </label>
        ))}
        <button
          type="button"
          className="net__fit"
          onClick={() => fitView({ padding: 0.2, duration: 300 })}
        >
          Fit View
        </button>
      </div>
      <div className="net__canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          fitView
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={28} color="#d2dae1" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}

export function NetworkViewer() {
  return (
    <ReactFlowProvider>
      <NetworkInner />
    </ReactFlowProvider>
  )
}
