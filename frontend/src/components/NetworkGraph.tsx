import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import type { GraphLink, GraphNode, Severity } from '../types'

type Props = {
  nodes: GraphNode[]
  links: GraphLink[]
  activeCaseId: string
  replayTransactionId: string
  selectedTransactionId: string
  reducedMotion: boolean
  heatmap: boolean
  heldAccountIds: string[]
  interruptedTransferIds: string[]
  onCase: (caseId: string) => void
  onAccount: (node: GraphNode) => void
  onContext: (node: GraphNode) => void
  onTransaction: (link: GraphLink) => void
}

const severityColor: Record<Severity, string> = {
  CRITICAL: '#d76655',
  HIGH: '#d49257',
  MEDIUM: '#c3a044',
  LOW: '#5d7ea4',
}

function nodeColor(node: GraphNode, activeCaseId: string) {
  if (node.kind === 'case') return severityColor[node.severity ?? 'MEDIUM']
  if (node.kind === 'device') return '#be9847'
  if (node.kind === 'network') return '#8093a7'
  if (node.caseId !== activeCaseId) return '#8999a8'
  return node.riskScore == null ? '#8999a8' : node.riskScore >= 80 ? '#d77b63' : node.riskScore >= 60 ? '#c3a044' : '#527ca5'
}

function heatColor(score: number | null) {
  if (score == null) return '#8999a8'
  return score >= 70 ? '#d76655' : score >= 40 ? '#c3a044' : '#527ca5'
}

function transferCurvature(link: GraphLink) {
  const id = link.transaction?.transaction_id
  if (!id) return 0
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0
  return ((Math.abs(hash) % 7) - 3) * 0.035
}

export default function NetworkGraph({ nodes, links, activeCaseId, replayTransactionId, selectedTransactionId, reducedMotion, heatmap, heldAccountIds, interruptedTransferIds, onCase, onAccount, onContext, onTransaction }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const fittedGraph = useRef('')
  const zoomLevel = useRef(50)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(50)
  const graphKey = `${nodes.map(node => node.id).join('|')}::${links.length}`
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => setSize({ width: container.clientWidth, height: container.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size.width || !size.height || !nodes.length) return
    graphRef.current?.zoomToFit(0, 80)
  }, [size.width, size.height, graphKey, nodes.length])
  useEffect(() => {
    // The renderer uses Three's TrackballControls. Its default zoomSpeed of 1
    // is deliberately conservative for dense graphs, so make wheel navigation
    // feel responsive without changing the camera's fitted bounds.
    const controls = graphRef.current?.controls() as { zoomSpeed?: number } | undefined
    if (controls) controls.zoomSpeed = 2.4
  }, [size.width, size.height])
  // react-force-graph mutates node/link objects while running its force simulation.
  // Keep that mutable state inside this renderer instead of corrupting adapter data.
  const graphData = useMemo(() => ({ nodes: nodes.map(node => ({ ...node })), links: links.map(link => ({ ...link })) }), [nodes, links])
  const updateZoom = (next: number) => {
    const graph = graphRef.current
    const camera = graph?.camera()
    const controls = graph?.controls() as { target?: { x: number; y: number; z: number } } | undefined
    if (!graph || !camera) return
    const target = controls?.target ?? { x: 0, y: 0, z: 0 }
    // Each slider step changes the camera distance by ~5.5%, preserving the
    // current orbit and look-at point instead of snapping the graph view.
    const scale = Math.pow(1.055, zoomLevel.current - next)
    graph.cameraPosition({
      x: target.x + (camera.position.x - target.x) * scale,
      y: target.y + (camera.position.y - target.y) * scale,
      z: target.z + (camera.position.z - target.z) * scale,
    }, target)
    zoomLevel.current = next
    setZoom(next)
  }
  const fitNetwork = () => {
    graphRef.current?.zoomToFit(650, 65)
    zoomLevel.current = 50
    setZoom(50)
  }

  return (
    <div className="network-canvas" ref={containerRef}>
      <ForceGraph3D<GraphNode, GraphLink>
        ref={graphRef}
        width={size.width || undefined}
        height={size.height || undefined}
        graphData={graphData}
        backgroundColor="#f7faf3"
        showNavInfo={false}
        nodeLabel={(node) => `${node.kind === 'case' ? `${node.severity} CASE` : node.kind.toUpperCase()} · ${node.name} · Risk ${node.riskScore?.toFixed(1) ?? 'unavailable'}`}
        nodeColor={(node) => node.kind === 'account' && heldAccountIds.includes(node.name) ? '#ff5277' : heatmap ? heatColor(node.riskScore) : nodeColor(node, activeCaseId)}
        nodeVal={(node) => node.kind === 'case' ? 13 : 4 + (node.riskScore ?? 0) / 36}
        nodeOpacity={0.94}
        linkColor={(link) => link.kind === 'involves' ? 'rgba(104, 124, 145, .34)' : link.kind === 'context' ? 'rgba(175, 134, 60, .60)' : link.transaction && interruptedTransferIds.includes(link.transaction.transaction_id) ? '#d76655' : link.transaction?.transaction_id === (selectedTransactionId || replayTransactionId) ? '#c39436' : heatmap ? heatColor(link.transaction?.risk_score ?? null) : 'rgba(74, 113, 153, .60)'}
        linkOpacity={0.76}
        linkCurvature={transferCurvature}
        linkWidth={(link) => link.kind === 'involves' || link.kind === 'context' ? 0.8 : link.transaction && interruptedTransferIds.includes(link.transaction.transaction_id) ? 3 : link.transaction?.transaction_id === (selectedTransactionId || replayTransactionId) ? 3 : 1.1 + (link.transaction?.risk_score ?? 0) / 70}
        linkDirectionalArrowLength={(link) => link.kind === 'transaction' ? 3.6 : 0}
        linkDirectionalArrowRelPos={0.88}
        linkDirectionalArrowColor={(link) => link.kind !== 'transaction' ? 'transparent' : link.transaction && interruptedTransferIds.includes(link.transaction.transaction_id) ? '#d76655' : link.transaction?.transaction_id === (selectedTransactionId || replayTransactionId) ? '#c39436' : '#527ca5'}
        linkDirectionalParticles={(link) => link.kind === 'transaction' && !reducedMotion ? 2 : 0}
        linkDirectionalParticleWidth={1.8}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => '#6892ba'}
        linkLabel={(link) => link.transaction ? `${link.transaction.transaction_id} · ${link.transaction.amount} ${link.transaction.currency} · ${new Date(link.transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : link.kind === 'context' ? `Synthetic ${link.contextLabel} context` : 'Involved in case'}
        onNodeClick={(node) => node.kind === 'case' ? onCase(node.caseId) : node.kind === 'account' ? onAccount(node) : onContext(node)}
        onLinkClick={(link) => link.kind === 'transaction' && onTransaction(link)}
        cooldownTicks={reducedMotion ? 70 : 140}
        warmupTicks={30}
        onEngineStop={() => {
          if (nodes.length && fittedGraph.current !== graphKey) {
            graphRef.current?.zoomToFit(500, 80)
            fittedGraph.current = graphKey
          }
        }}
        enableNodeDrag
        enableNavigationControls
      />
      <div className="graph-zoom-controls">
        <label htmlFor="network-zoom">Zoom</label>
        <span aria-hidden="true">+</span><input id="network-zoom" aria-label="Graph zoom" type="range" min="0" max="100" value={zoom} onChange={event => updateZoom(Number(event.target.value))} /><span aria-hidden="true">−</span>
        <button className="graph-reset" onClick={fitNetwork} title="Fit all visible nodes">Fit network</button>
      </div>
    </div>
  )
}
