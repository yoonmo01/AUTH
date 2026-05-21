import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { fetchSession } from '../api/client'
import { classifyReport } from '../report'
import { relationLabel } from '../reportLabels'
import type { ConsoleLayout } from '../consoleLayout'
import type { EvidenceNode, EvidenceEdge, Session } from '../types'

const TYPE_META: Record<string, { label: string; style: CSSProperties }> = {
  USER:    { label: '사용자', style: { background: '#1559ee', color: '#fff', borderColor: '#1559ee', borderRadius: 18 } },
  FILE:    { label: '파일',   style: { background: '#ffffff', color: '#16222b', borderColor: '#bcc6cf' } },
  EMAIL:   { label: '이메일', style: { background: '#e3f6fb', color: '#16222b', borderColor: '#0ea5d4' } },
  CHANNEL: { label: '채널',   style: { background: '#fde6ea', color: '#e0274a', borderColor: '#e0274a', borderRadius: 18 } },
  LOG:     { label: '로그',   style: { background: '#eef1f5', color: '#16222b', borderColor: '#93a1ad', borderRadius: 3 } },
}

const RELATION_COLOR: Record<string, string> = {
  DELETED:      '#9c1029',
  TRIGGERED:    '#9c1029',
  ACCESSED:     '#1559ee',
  USED:         '#c2790b',
  USED_CHANNEL: '#c2790b',
  SENT_TO:      '#0ea5d4',
  ATTACHED:     '#0ea5d4',
}

const TYPE_ORDER = ['USER', 'CHANNEL', 'FILE', 'EMAIL', 'LOG']

function layoutNodes(nodes: EvidenceNode[]): Map<string, { x: number; y: number }> {
  const byType: Record<string, EvidenceNode[]> = {}
  for (const n of nodes) {
    byType[n.type] = byType[n.type] ?? []
    byType[n.type].push(n)
  }
  const positions = new Map<string, { x: number; y: number }>()
  const ordered = [
    ...TYPE_ORDER,
    ...Object.keys(byType).filter((t) => !TYPE_ORDER.includes(t)),
  ]
  let y = 0
  for (const type of ordered) {
    const group = byType[type]
    if (!group || group.length === 0) continue
    const startX = -((group.length - 1) * 220) / 2
    group.forEach((n, i) => {
      positions.set(n.id, { x: startX + i * 220, y })
    })
    y += 130
  }
  return positions
}

function buildRFNodes(nodes: EvidenceNode[]): Node[] {
  const positions = layoutNodes(nodes)
  return nodes.map((n) => ({
    id: n.id,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: { label: n.label },
    style: {
      width: 188,
      fontSize: 11,
      border: '1px solid',
      ...(TYPE_META[n.type]?.style ?? { background: '#fff', borderColor: '#bcc6cf' }),
    },
  }))
}

function buildRFEdges(edges: EvidenceEdge[], nodeIds: Set<string>): Edge[] {
  return edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e, i) => {
      const color = RELATION_COLOR[e.relation] ?? '#586875'
      return {
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        label: relationLabel(e.relation),
        labelStyle: { fontSize: 9, fill: '#586875' },
        labelBgStyle: { fill: '#ffffff' },
        style: { stroke: color, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      }
    })
}

function NetworkInner({
  nodes: evidenceNodes,
  edges: evidenceEdges,
}: {
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
}) {
  const { fitView } = useReactFlow()
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(evidenceNodes.map((n) => n.type)),
  )

  const presentTypes = useMemo(
    () => [...new Set(evidenceNodes.map((n) => n.type))],
    [evidenceNodes],
  )

  const { rfNodes, rfEdges } = useMemo(() => {
    const filtered = evidenceNodes.filter((n) => visible.has(n.type))
    const nodeIds = new Set(filtered.map((n) => n.id))
    return {
      rfNodes: buildRFNodes(filtered),
      rfEdges: buildRFEdges(evidenceEdges, nodeIds),
    }
  }, [evidenceNodes, evidenceEdges, visible])

  function toggle(type: string) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div className="net">
      <div className="net__bar">
        {presentTypes.map((type) => (
          <label key={type} className="net__chk">
            <input
              type="checkbox"
              checked={visible.has(type)}
              onChange={() => toggle(type)}
            />
            <span className="net__swatch" style={TYPE_META[type]?.style ?? {}} />
            {TYPE_META[type]?.label ?? type}
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

export function NetworkViewer({
  layout: _layout,
  sessionId,
}: {
  layout: ConsoleLayout
  sessionId: string | null
}) {
  const { data, isLoading, isError } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId as string),
    enabled: sessionId != null,
  })

  if (sessionId == null) {
    return (
      <div className="ph">
        <span className="ph__mark" aria-hidden="true">◇</span>
        <span className="ph__txt">세션을 선택하면 증거 네트워크가 표시됩니다</span>
      </div>
    )
  }
  if (isError) return <div className="table__msg">세션 조회 실패 — 백엔드 응답을 확인하세요</div>
  if (isLoading || !data) return <div className="table__msg">네트워크 그래프 불러오는 중…</div>

  const classified = classifyReport(data.report_json)
  if (classified.kind !== 'exfiltration') {
    return <div className="table__msg">증거 네트워크 데이터가 없습니다</div>
  }

  const { nodes, edges } = classified.report.evidence_network
  if (nodes.length === 0) {
    return <div className="table__msg">표시할 네트워크 노드가 없습니다</div>
  }

  return (
    <ReactFlowProvider>
      <NetworkInner nodes={nodes} edges={edges} />
    </ReactFlowProvider>
  )
}
