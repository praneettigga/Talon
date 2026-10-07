import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import type { InfrastructureLink, ReplayEvent } from './api'

const emptyRoles: Record<string, string> = {}
const emptyLinks: InfrastructureLink[] = []
const emptyIds: string[] = []
const accountNodeId = (bank: string, account: string) => JSON.stringify([bank, account])
const accountId = (bank: string, account: string) => `${bank}/${account}`

export function Graph({ events, selectedId, onSelect, onSelectAccount, roles = emptyRoles, labelPrefix = 'Transaction graph',
  enrichmentLinks = emptyLinks, heldAccountIds = emptyIds, interruptedTransferIds = emptyIds }: {
  events: ReplayEvent[]; selectedId: string | null; onSelect: (id: string) => void;
  onSelectAccount?: (id: string) => void; roles?: Record<string, string>; labelPrefix?: string;
  enrichmentLinks?: InfrastructureLink[]; heldAccountIds?: string[]; interruptedTransferIds?: string[];
}) {
  const container = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const firstLayout = useRef(true)
  const callbacks = useRef({ onSelect, onSelectAccount })
  callbacks.current = { onSelect, onSelectAccount }

  useEffect(() => {
    if (!container.current) return
    const cy = cytoscape({ container: container.current, elements: [], minZoom: 0.1, maxZoom: 4, wheelSensitivity: 0.2,
      style: [
        { selector: 'node', style: { 'background-color': '#24534f', 'border-color': '#6ed4bb', 'border-width': 1,
          label: 'data(label)', color: '#dce9e7', 'font-size': 9, 'text-margin-y': 6, 'text-valign': 'bottom', width: 24, height: 24 } },
        { selector: 'node[kind = "account"][role != "counterparty"]', style: { 'background-color': '#596cb0', 'border-color': '#9eade7', width: 30, height: 30 } },
        { selector: 'node[kind = "device"]', style: { shape: 'diamond', 'background-color': '#b38842', width: 25, height: 25 } },
        { selector: 'node[kind = "network"]', style: { shape: 'round-rectangle', 'background-color': '#73868b', width: 28, height: 20 } },
        { selector: 'edge', style: { 'line-color': '#4f9d90', 'target-arrow-color': '#72dbc4', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'control-point-step-size': 26, width: 1.8 } },
        { selector: 'edge[kind = "context"]', style: { 'line-style': 'dotted', 'line-color': '#c09a54', 'target-arrow-shape': 'none', width: 1 } },
        { selector: '.highlight', style: { 'line-color': '#f6c56d', 'target-arrow-color': '#f6c56d', width: 4 } },
        { selector: 'node.held', style: { 'border-width': 3, 'border-color': '#ff5277' } },
        { selector: 'edge.interrupted', style: { 'line-color': '#ff5277', 'target-arrow-color': '#ff5277', 'line-style': 'dashed', width: 3 } },
      ],
    })
    cy.on('tap', 'edge[kind = "transfer"]', event => callbacks.current.onSelect(event.target.id()))
    cy.on('tap', 'node[kind = "account"]', event => callbacks.current.onSelectAccount?.(event.target.data('accountId')))
    graph.current = cy
    const observer = new ResizeObserver(() => cy.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); cy.destroy(); graph.current = null; firstLayout.current = true }
  }, [])

  useEffect(() => {
    const cy = graph.current
    if (!cy) return
    const nodes = new Map<string, ElementDefinition>()
    const edges: ElementDefinition[] = events.map((event, index) => {
      const source = accountNodeId(event.fromBank, event.fromAccount)
      const target = accountNodeId(event.toBank, event.toAccount)
      const fromId = accountId(event.fromBank, event.fromAccount)
      const toId = accountId(event.toBank, event.toAccount)
      nodes.set(source, { data: { id: source, kind: 'account', label: event.fromAccount.slice(-6), accountId: fromId, role: roles[fromId] ?? 'counterparty' } })
      nodes.set(target, { data: { id: target, kind: 'account', label: event.toAccount.slice(-6), accountId: toId, role: roles[toId] ?? 'counterparty' } })
      return { data: { id: event.id, source, target, kind: 'transfer', eventIndex: index } }
    })
    for (const link of enrichmentLinks) {
      const id = `synthetic:${link.kind}:${link.id}`
      const members = [...nodes.values()].filter(node => node.data?.kind === 'account' && link.accountIds.includes(String(node.data.accountId)))
      if (members.length < 2) continue
      nodes.set(id, { data: { id, kind: link.kind, label: link.kind === 'device' ? 'Synthetic device' : 'Synthetic network' } })
      for (const member of members) edges.push({ data: { id: `context:${link.id}:${member.data?.id}`, source: member.data?.id, target: id, kind: 'context' } })
    }
    const desiredIds = new Set([...nodes.keys(), ...edges.map(edge => String(edge.data?.id))])
    let addedNode = false
    cy.batch(() => {
      cy.elements().forEach(element => { if (!desiredIds.has(element.id())) element.remove() })
      nodes.forEach((element, id) => {
        const existing = cy.getElementById(id)
        if (existing.length) existing.data(element.data ?? {})
        else { cy.add(element); addedNode = true }
      })
      edges.forEach(element => {
        const existing = cy.getElementById(String(element.data?.id))
        if (existing.length) existing.data(element.data ?? {})
        else cy.add(element)
      })
      cy.elements().removeClass('held interrupted highlight')
      cy.nodes().filter(node => heldAccountIds.includes(String(node.data('accountId')))).addClass('held')
      interruptedTransferIds.forEach(id => cy.getElementById(id).addClass('interrupted'))
      cy.getElementById(selectedId ?? '').addClass('highlight')
    })
    if (firstLayout.current && nodes.size) {
      cy.layout({ name: 'cose', fit: true, animate: false, randomize: false, padding: 45 }).run()
      firstLayout.current = false
    } else if (addedNode) {
      cy.layout({ name: 'cose', fit: false, animate: false, randomize: false, padding: 25 }).run()
    }
  }, [events, roles, enrichmentLinks, heldAccountIds, interruptedTransferIds, selectedId])

  return <div className="graph-wrap"><div className="graph-canvas-wrap"><div ref={container} className="graph"
    aria-label={`${labelPrefix} showing ${events.length} transfers`} data-context-links={enrichmentLinks.length}
    data-interrupted-transfers={interruptedTransferIds.length} />
    {!events.length && <p className="graph-empty">The network will grow as events arrive.</p>}
    <button className="fit" onClick={() => graph.current?.fit(undefined, 40)}>Fit graph</button></div>
    {enrichmentLinks.length > 0 && <p className="graph-context-legend">Synthetic Talon enrichment; not supplied by IBM AMLWorld · diamonds: devices · rectangles: networks · dotted lines: context, not transfers.</p>}
    {heldAccountIds.length > 0 && <p className="graph-context-legend">Hold preview only · red borders: selected accounts · dashed red arrows: interrupted observed links.</p>}
  </div>
}
