import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { toPng } from 'html-to-image'
import { fetchSession } from '../api/client'
import { classifyReport } from '../report'
import { relationLabel } from '../reportLabels'
import { buildDownloadFilename } from '../downloadFilename'
import type { ConsoleLayout } from '../consoleLayout'
import type { EvidenceNode, EvidenceEdge, Session } from '../types'

// ContentViewer(탭 바)가 "그래프 다운로드" 버튼을 소유하지만 export 자체는
// ReactFlow 컨텍스트가 필요하므로, NetworkInner가 자신의 export 함수를 이
// ref에 publish한다. 마운트 해제 시 null로 되돌림.
export type GraphExportRef = MutableRefObject<(() => void) | null>

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
  USES:         '#c2790b',
  SENT_TO:      '#0ea5d4',
  SENT:         '#0ea5d4',
  ATTACHED:     '#0ea5d4',
}

type Direction = 'LR' | 'TB'
type SizePreset = 'compact' | 'comfortable' | 'large'

interface LayoutParams {
  direction: Direction
  minNodeWidth: number
  maxNodeWidth: number
  ranksep: number
  nodesep: number
  edgesep: number
  nodeFontSize: number
  edgeFontSize: number
  hPadding: number
  vPadding: number
  maxLines: number
}

// 사이즈 프리셋 — 일반/풀스크린에서 동일한 방향(LR/TB) 파라미터 세트를 공유하되
// 풀스크린에서는 더 큰 사이즈를 쓰도록 분리.
function buildParams(direction: Direction, preset: SizePreset): LayoutParams {
  if (preset === 'large') {
    // 풀스크린 모달 — 라벨이 여유롭게 배치되도록 rank 간 간격을 크게
    return direction === 'LR'
      ? {
          direction: 'LR',
          minNodeWidth: 160, maxNodeWidth: 360,
          ranksep: 220, nodesep: 48, edgesep: 28,
          nodeFontSize: 15, edgeFontSize: 16,
          hPadding: 28, vPadding: 18, maxLines: 2,
        }
      : {
          direction: 'TB',
          minNodeWidth: 150, maxNodeWidth: 320,
          ranksep: 150, nodesep: 34, edgesep: 24,
          nodeFontSize: 14, edgeFontSize: 15,
          hPadding: 26, vPadding: 18, maxLines: 2,
        }
  }
  if (preset === 'comfortable') {
    // focused (판정 크게 보기)
    return direction === 'LR'
      ? {
          direction: 'LR',
          minNodeWidth: 140, maxNodeWidth: 320,
          ranksep: 160, nodesep: 38, edgesep: 20,
          nodeFontSize: 14, edgeFontSize: 14,
          hPadding: 24, vPadding: 16, maxLines: 2,
        }
      : {
          direction: 'TB',
          minNodeWidth: 130, maxNodeWidth: 280,
          ranksep: 90, nodesep: 22, edgesep: 18,
          nodeFontSize: 13, edgeFontSize: 13,
          hPadding: 22, vPadding: 16, maxLines: 2,
        }
  }
  // compact — expanded (파일 모두 보기, 좁은 패널)
  return direction === 'TB'
    ? {
        direction: 'TB',
        minNodeWidth: 120, maxNodeWidth: 220,
        ranksep: 76, nodesep: 20, edgesep: 16,
        nodeFontSize: 12, edgeFontSize: 12,
        hPadding: 20, vPadding: 14, maxLines: 2,
      }
    : {
        direction: 'LR',
        minNodeWidth: 130, maxNodeWidth: 240,
        ranksep: 120, nodesep: 28, edgesep: 18,
        nodeFontSize: 12, edgeFontSize: 12,
        hPadding: 22, vPadding: 14, maxLines: 2,
      }
}

function defaultDirectionFor(layout: ConsoleLayout): Direction {
  return layout === 'focused' ? 'LR' : 'TB'
}

function presetFor(layout: ConsoleLayout, isModal: boolean): SizePreset {
  if (isModal) return 'large'
  return layout === 'focused' ? 'comfortable' : 'compact'
}

// 측정용 canvas (싱글톤)
let _measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (_measureCtx) return _measureCtx
  const c = document.createElement('canvas')
  _measureCtx = c.getContext('2d')
  return _measureCtx
}

function measureWidth(text: string, fontSize: number): number {
  const ctx = getMeasureCtx()
  if (!ctx) return text.length * fontSize * 0.62
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
  return ctx.measureText(text).width
}

interface NodeDims { width: number; height: number; lines: number }

function computeNodeDims(label: string, p: LayoutParams): NodeDims {
  const lineHeight = p.nodeFontSize * 1.3
  const textW = measureWidth(label, p.nodeFontSize)
  const wantW = textW + p.hPadding
  if (wantW <= p.maxNodeWidth) {
    return {
      width: Math.max(p.minNodeWidth, Math.ceil(wantW)),
      height: Math.ceil(lineHeight + p.vPadding),
      lines: 1,
    }
  }
  const innerW = p.maxNodeWidth - p.hPadding
  const linesNeeded = Math.min(p.maxLines, Math.max(2, Math.ceil(textW / innerW)))
  return {
    width: p.maxNodeWidth,
    height: Math.ceil(lineHeight * linesNeeded + p.vPadding),
    lines: linesNeeded,
  }
}

function computeLayout(
  nodes: EvidenceNode[],
  edges: EvidenceEdge[],
  dims: Map<string, NodeDims>,
  p: LayoutParams,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: p.direction,
    nodesep: p.nodesep,
    ranksep: p.ranksep,
    edgesep: p.edgesep,
    marginx: 16,
    marginy: 16,
  })
  for (const n of nodes) {
    const d = dims.get(n.id)!
    g.setNode(n.id, { width: d.width, height: d.height })
  }
  const nodeIds = new Set(nodes.map((n) => n.id))
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      g.setEdge(e.source, e.target)
    }
  }
  dagre.layout(g)
  const positions = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const pos = g.node(n.id)
    const d = dims.get(n.id)!
    if (pos) {
      positions.set(n.id, {
        x: pos.x - d.width / 2,
        y: pos.y - d.height / 2,
      })
    }
  }
  return positions
}

function buildRFNodes(
  nodes: EvidenceNode[],
  positions: Map<string, { x: number; y: number }>,
  dims: Map<string, NodeDims>,
  p: LayoutParams,
): Node[] {
  const sourcePos = p.direction === 'LR' ? Position.Right : Position.Bottom
  const targetPos = p.direction === 'LR' ? Position.Left : Position.Top
  return nodes.map((n) => {
    const d = dims.get(n.id)!
    const multiline = d.lines > 1
    return {
      id: n.id,
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { label: n.label },
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      style: {
        width: d.width,
        height: d.height,
        padding: `${Math.round(p.vPadding / 2)}px ${Math.round(p.hPadding / 2)}px`,
        fontSize: p.nodeFontSize,
        lineHeight: 1.3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center' as const,
        whiteSpace: multiline ? ('normal' as const) : ('nowrap' as const),
        wordBreak: 'break-all' as const,
        overflow: 'visible' as const,
        border: '1px solid',
        ...(TYPE_META[n.type]?.style ?? { background: '#fff', borderColor: '#bcc6cf' }),
      },
      title: n.label,
    }
  })
}

// 엣지 라벨이 다른 엣지 선에 가려지지 않도록 HTML 포털(EdgeLabelRenderer)로
// 모든 라벨을 SVG 위에 띄움. 동시에 동일 소스에서 출발하는 형제 엣지가
// 여럿이면 labelOffset(엣지 방향 수직 픽셀)로 라벨 위치를 분산시켜 겹침을
// 회피한다.
interface LabeledEdgeData extends Record<string, unknown> {
  labelText: string
  labelOffset: number   // 엣지 방향 수직축 오프셋(px)
  direction: Direction
  fontSize: number
}

function LabeledSmoothStep(props: EdgeProps) {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    style, markerEnd, data,
  } = props
  const d = data as LabeledEdgeData | undefined

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  // LR(가로 진행)이면 라벨을 세로로 분산, TB(세로 진행)이면 가로로 분산
  const offset = d?.labelOffset ?? 0
  const dir = d?.direction ?? 'LR'
  const adjX = dir === 'TB' ? labelX + offset : labelX
  const adjY = dir === 'LR' ? labelY + offset : labelY

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {d?.labelText && (
        <EdgeLabelRenderer>
          <div
            className="net-edge-label nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${adjX}px, ${adjY}px)`,
              fontSize: d.fontSize,
            }}
          >
            {d.labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const EDGE_TYPES: EdgeTypes = { labeled: LabeledSmoothStep }

function buildRFEdges(
  edges: EvidenceEdge[],
  nodeIds: Set<string>,
  p: LayoutParams,
): Edge[] {
  const filtered = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  )

  // 소스별 형제 카운트
  const sourceCount = new Map<string, number>()
  for (const e of filtered) {
    sourceCount.set(e.source, (sourceCount.get(e.source) ?? 0) + 1)
  }
  // 소스별 누적 인덱스 (각 형제에게 0..N-1 배정)
  const sourceIdx = new Map<string, number>()

  // 형제 간 라벨 분산 간격 — 라벨 폰트 높이 + 약간의 여백
  const spread = p.edgeFontSize + 10

  return filtered.map((e, i) => {
    const color = RELATION_COLOR[e.relation] ?? '#586875'
    const total = sourceCount.get(e.source) ?? 1
    const idx = sourceIdx.get(e.source) ?? 0
    sourceIdx.set(e.source, idx + 1)
    // 한 소스에서 2개 이상일 때만 분산 (-((n-1)/2) ~ +((n-1)/2)) * spread
    const labelOffset = total > 1 ? (idx - (total - 1) / 2) * spread : 0

    const data: LabeledEdgeData = {
      labelText: relationLabel(e.relation),
      labelOffset,
      direction: p.direction,
      fontSize: p.edgeFontSize,
    }

    return {
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      type: 'labeled',
      data,
      style: { stroke: color, strokeWidth: 1.6 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    }
  })
}

function DirectionToggle({
  value,
  onChange,
}: {
  value: Direction
  onChange: (d: Direction) => void
}) {
  return (
    <div className="net__dir" role="group" aria-label="레이아웃 방향">
      <button
        type="button"
        className={`net__dir-btn${value === 'LR' ? ' net__dir-btn--on' : ''}`}
        onClick={() => onChange('LR')}
        title="가로 (좌→우)"
      >
        ↔ 가로
      </button>
      <button
        type="button"
        className={`net__dir-btn${value === 'TB' ? ' net__dir-btn--on' : ''}`}
        onClick={() => onChange('TB')}
        title="세로 (위→아래)"
      >
        ↕ 세로
      </button>
    </div>
  )
}

// PNG 내보내기 해상도 — 그래프 전체를 프레임에 fit해도 가독성 유지되는 크기
const EXPORT_W = 1920
const EXPORT_H = 1200

function NetworkInner({
  nodes: evidenceNodes,
  edges: evidenceEdges,
  layout,
  isModal,
  onFullscreen,
  exportRef,
}: {
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
  layout: ConsoleLayout
  isModal: boolean
  onFullscreen?: () => void
  exportRef?: GraphExportRef
}) {
  const { fitView, getNodes, getViewport, setViewport } = useReactFlow()
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(evidenceNodes.map((n) => n.type)),
  )
  const [direction, setDirection] = useState<Direction>(() => defaultDirectionFor(layout))

  const presentTypes = useMemo(
    () => [...new Set(evidenceNodes.map((n) => n.type))],
    [evidenceNodes],
  )

  const params = useMemo(
    () => buildParams(direction, presetFor(layout, isModal)),
    [direction, layout, isModal],
  )

  const { rfNodes, rfEdges } = useMemo(() => {
    const filtered = evidenceNodes.filter((n) => visible.has(n.type))
    const nodeIds = new Set(filtered.map((n) => n.id))
    const filteredEdges = evidenceEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    )
    const dims = new Map<string, NodeDims>()
    for (const n of filtered) dims.set(n.id, computeNodeDims(n.label, params))
    const positions = computeLayout(filtered, filteredEdges, dims, params)
    return {
      rfNodes: buildRFNodes(filtered, positions, dims, params),
      rfEdges: buildRFEdges(filteredEdges, nodeIds, params),
    }
  }, [evidenceNodes, evidenceEdges, visible, params])

  useEffect(() => {
    const t = setTimeout(() => {
      fitView({ padding: 0.1, duration: 250, maxZoom: 1 })
    }, 0)
    return () => clearTimeout(t)
  }, [fitView, rfNodes, rfEdges])

  // PNG 스냅샷 — `.react-flow` 컨테이너 전체를 캡처해서 viewport와 별도
  // 컨테이너인 edge-label-renderer까지 포함시킨다. 위치는 style transform을
  // 직접 덮어쓰는 대신 setViewport()로 정식 호출 → viewport와 label-renderer
  // transform이 React Flow 내부에서 동기 업데이트되므로 라벨이 어긋나지 않음.
  // 캡처 직후 원래 pan/zoom으로 복원해서 사용자 화면은 잠깐 깜빡일 뿐.
  const exportPng = useCallback(async () => {
    const flowEl = document.querySelector<HTMLElement>('.net__canvas .react-flow')
    const nodes = getNodes()
    if (!flowEl || nodes.length === 0) return

    const bounds = getNodesBounds(nodes)
    const { x, y, zoom } = getViewportForBounds(bounds, EXPORT_W, EXPORT_H, 0.2, 2, 0.12)

    const saved = getViewport()
    flowEl.classList.add('is-exporting')
    setViewport({ x, y, zoom })

    // viewport + label-renderer transform이 DOM에 반영될 때까지 2프레임 대기
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    )

    try {
      const dataUrl = await toPng(flowEl, {
        backgroundColor: '#ffffff',
        width: EXPORT_W,
        height: EXPORT_H,
        cacheBust: true,
        style: {
          width: `${EXPORT_W}px`,
          height: `${EXPORT_H}px`,
        },
      })
      const link = document.createElement('a')
      link.download = buildDownloadFilename({
        kind: 'network-graph',
        extension: 'png',
        date: new Date(),
      })
      link.href = dataUrl
      link.click()
    } catch (err: unknown) {
      console.error('네트워크 그래프 내보내기 실패', err)
    } finally {
      flowEl.classList.remove('is-exporting')
      setViewport(saved)
    }
  }, [getNodes, getViewport, setViewport])

  // 메인 인스턴스(비-모달)만 export 함수를 ref에 publish. 모달이 같이
  // 등록하면 ContentViewer의 ref가 모달 인스턴스로 덮여 위험.
  useEffect(() => {
    if (!exportRef || isModal) return
    exportRef.current = exportPng
    return () => {
      exportRef.current = null
    }
  }, [exportRef, exportPng, isModal])

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
        <div className="net__tools">
          <DirectionToggle value={direction} onChange={setDirection} />
          <button
            type="button"
            className="net__fit"
            onClick={() => fitView({ padding: 0.1, duration: 300, maxZoom: 1 })}
          >
            Fit View
          </button>
          {onFullscreen && (
            <button
              type="button"
              className="net__full"
              onClick={onFullscreen}
              title="풀스크린"
            >
              ⛶ 풀스크린
            </button>
          )}
        </div>
      </div>
      <div className="net__canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
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

function FullscreenNetwork({
  nodes,
  edges,
  layout,
  onClose,
}: {
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
  layout: ConsoleLayout
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="net-modal" role="dialog" aria-modal="true">
      <div className="net-modal__head">
        <span className="net-modal__title">증거 네트워크 — 풀스크린</span>
        <button
          type="button"
          className="net-modal__close"
          onClick={onClose}
          aria-label="닫기"
        >
          ✕ 닫기 (Esc)
        </button>
      </div>
      <div className="net-modal__body">
        <ReactFlowProvider>
          <NetworkInner nodes={nodes} edges={edges} layout={layout} isModal />
        </ReactFlowProvider>
      </div>
    </div>,
    document.body,
  )
}

export function NetworkViewer({
  layout,
  sessionId,
  exportRef,
}: {
  layout: ConsoleLayout
  sessionId: string | null
  exportRef?: GraphExportRef
}) {
  const [fullscreen, setFullscreen] = useState(false)

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
    <>
      <ReactFlowProvider>
        <NetworkInner
          nodes={nodes}
          edges={edges}
          layout={layout}
          isModal={false}
          onFullscreen={() => setFullscreen(true)}
          exportRef={exportRef}
        />
      </ReactFlowProvider>
      {fullscreen && (
        <FullscreenNetwork
          nodes={nodes}
          edges={edges}
          layout={layout}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  )
}
