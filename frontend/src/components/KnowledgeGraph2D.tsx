import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import type { GraphLink, GraphNode } from '../types'

type Props = {
  nodes: GraphNode[]
  links: GraphLink[]
  selectedTransactionId: string
  replayTransactionId: string
  heldAccountIds: string[]
  interruptedTransferIds: string[]
  onCase: (id: string) => void
  onAccount: (node: GraphNode) => void
  onContext: (node: GraphNode) => void
  onTransaction: (link: GraphLink) => void
}

const shortLabel = (node: GraphNode) => node.kind === 'account' ? node.name.split('/').at(-1) ?? node.name : node.name

function nodeElement(node: GraphNode): ElementDefinition {
  return { data: {
    id: node.id, label: shortLabel(node), kind: node.kind, accountId: node.name,
    risk: node.riskScore ?? -1, severity: node.severity ?? '', role: node.role ?? '',
    node,
  } }
}

function linkElement(link: GraphLink, index: number): ElementDefinition {
  const id = link.kind === 'transaction'
    ? link.transaction?.transaction_id ?? `transfer:${index}`
    : `${link.kind}:${link.source}:${link.target}:${index}`
  return { data: {
    id, source: link.source, target: link.target, kind: link.kind,
    label: link.transaction ? `${link.transaction.transaction_id} · ${link.transaction.amount} ${link.transaction.currency}` : link.kind,
    risk: link.transaction?.risk_score ?? -1, link,
  } }
}

export default function KnowledgeGraph2D({ nodes, links, selectedTransactionId, replayTransactionId,
  heldAccountIds, interruptedTransferIds, onCase, onAccount, onContext, onTransaction }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const firstLayout = useRef(true)
  const callbacks = useRef({ onCase, onAccount, onContext, onTransaction })
  callbacks.current = { onCase, onAccount, onContext, onTransaction }

  useEffect(() => {
    if (!container.current) return
    const cy = cytoscape({
      container: container.current,
      elements: [],
      minZoom: 0.12,
      maxZoom: 3,
      wheelSensitivity: 0.18,
      style: [
        { selector: 'node', style: {
          'background-color': '#a8b5ad', 'border-color': '#83948a', 'border-width': 1,
          label: 'data(label)', color: '#34443c', 'font-size': 13, 'font-weight': 600,
          'text-wrap': 'wrap', 'text-max-width': '110px', 'text-valign': 'bottom', 'text-margin-y': 7,
          width: 25, height: 25, 'overlay-opacity': 0,
        } },
        { selector: 'node[kind = "case"]', style: { shape: 'hexagon', width: 35, height: 35, 'background-color': '#6687aa', 'border-color': '#b5cbe0' } },
        { selector: 'node[kind = "case"][severity = "CRITICAL"]', style: { 'background-color': '#d76655', 'border-color': '#edaca3' } },
        { selector: 'node[kind = "case"][severity = "HIGH"]', style: { 'background-color': '#d49257', 'border-color': '#f0c9a7' } },
        { selector: 'node[kind = "case"][severity = "MEDIUM"]', style: { 'background-color': '#c3a044', 'border-color': '#e9d89a' } },
        { selector: 'node[kind = "account"]', style: { 'background-color': '#527ca5', 'border-color': '#a8c4dc' } },
        { selector: 'node[kind = "account"][role = "collector"]', style: { 'background-color': '#cf7665', 'border-color': '#edaea2', 'border-width': 2, width: 34, height: 34 } },
        { selector: 'node[kind = "account"][role = "intermediary"]', style: { 'background-color': '#c9a04a', 'border-color': '#ead491', 'border-width': 2, width: 31, height: 31 } },
        { selector: 'node[kind = "device"]', style: { shape: 'diamond', 'background-color': '#b38842', 'border-color': '#e4c077', width: 25, height: 25 } },
        { selector: 'node[kind = "network"]', style: { shape: 'round-rectangle', 'background-color': '#73868b', 'border-color': '#a8c2c0', width: 31, height: 22 } },
        { selector: 'edge', style: {
          width: 1.8, 'line-color': '#668bb1', 'target-arrow-color': '#668bb1', 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', 'control-point-step-size': 30, 'line-cap': 'round',
          label: 'data(label)', color: '#53645b', 'font-size': 11, 'text-background-color': '#f7faf3',
          'text-background-opacity': 0.9, 'text-background-padding': '2px', 'text-rotation': 'autorotate',
        } },
        { selector: 'edge[kind = "involves"]', style: { width: 1, 'line-color': '#75899e', 'target-arrow-shape': 'none', label: '' } },
        { selector: 'edge[kind = "context"]', style: { width: 1, 'line-style': 'dotted', 'line-color': '#c09a54', 'target-arrow-shape': 'none', label: '' } },
        { selector: 'edge[kind = "transaction"]', style: { 'line-color': '#4fbd9f', 'target-arrow-color': '#72dbc4' } },
        { selector: 'edge.interrupted', style: { 'line-color': '#ff5277', 'target-arrow-color': '#ff5277', width: 4, 'line-style': 'dashed', 'z-index': 10 } },
        { selector: 'edge.selected-edge', style: { 'line-color': '#f6c56d', 'target-arrow-color': '#f6c56d', width: 4, 'z-index': 9 } },
        { selector: 'edge.replay-edge', style: { 'line-color': '#e9c77a', 'target-arrow-color': '#e9c77a', width: 3, 'z-index': 8 } },
        { selector: 'node.held', style: { 'border-color': '#ff5277', 'border-width': 4 } },
      ],
    })
    cy.on('tap', 'node', event => {
      const node = event.target.data('node') as GraphNode | undefined
      if (!node) return
      if (node.kind === 'case') callbacks.current.onCase(node.caseId)
      else if (node.kind === 'account') callbacks.current.onAccount(node)
      else callbacks.current.onContext(node)
    })
    cy.on('tap', 'edge[kind = "transaction"]', event => {
      const link = event.target.data('link') as GraphLink | undefined
      if (link) callbacks.current.onTransaction(link)
    })
    graph.current = cy
    const observer = new ResizeObserver(() => { cy.resize(); if (cy.nodes().length) cy.fit(undefined, 65) })
    observer.observe(container.current)
    return () => { observer.disconnect(); cy.destroy(); graph.current = null; firstLayout.current = true }
  }, [])

  useEffect(() => {
    const cy = graph.current
    if (!cy) return
    const desiredNodes = nodes.map(nodeElement)
    const desiredLinks = links.map(linkElement)
    const desiredIds = new Set([...desiredNodes, ...desiredLinks].map(item => String(item.data?.id)))
    let addedNode = false
    cy.batch(() => {
      cy.elements().forEach(element => { if (!desiredIds.has(element.id())) element.remove() })
      desiredNodes.forEach((element, index) => {
        const id = String(element.data?.id)
        const existing = cy.getElementById(id)
        if (existing.length) existing.data(element.data ?? {})
        else {
          const angle = index * 2.399963
          const radius = 90 + Math.sqrt(index + 1) * 32
          cy.add({ ...element, position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius } })
          addedNode = true
        }
      })
      desiredLinks.forEach(element => {
        const existing = cy.getElementById(String(element.data?.id))
        if (existing.length) existing.data(element.data ?? {})
        else cy.add(element)
      })
      cy.nodes().removeClass('held')
      cy.edges().removeClass('interrupted selected-edge replay-edge')
      cy.nodes().filter(node => heldAccountIds.includes(node.data('accountId'))).addClass('held')
      interruptedTransferIds.forEach(id => cy.getElementById(id).addClass('interrupted'))
      cy.getElementById(selectedTransactionId).addClass('selected-edge')
      if (!selectedTransactionId) cy.getElementById(replayTransactionId).addClass('replay-edge')
    })
    if (firstLayout.current && nodes.length) {
      cy.layout({ name: 'cose', animate: false, fit: true, randomize: false, padding: 55 }).run()
      firstLayout.current = false
    } else if (addedNode) {
      cy.layout({ name: 'cose', animate: false, fit: true, randomize: false, padding: 55 }).run()
    }
  }, [nodes, links, selectedTransactionId, replayTransactionId, heldAccountIds, interruptedTransferIds])

  return <div className="knowledge-graph-2d">
    <div ref={container} className="knowledge-graph-2d-canvas" aria-label={`Interactive knowledge graph with ${nodes.length} nodes and ${links.length} relationships`} />
    {!nodes.length && <p className="knowledge-graph-empty">The knowledge graph will grow as replay events are observed.</p>}
    <button className="graph-reset" onClick={() => graph.current?.fit(undefined, 55)} title="Fit all visible nodes">Fit network</button>
  </div>
}
