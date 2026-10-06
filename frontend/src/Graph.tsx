import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { InfrastructureLink, ReplayEvent } from './api';
const emptyRoles: Record<string, string> = {};
const emptyLinks: InfrastructureLink[] = [];
const emptyIds: string[] = [];

export function Graph({ events, selectedId, onSelect, onSelectAccount, roles = emptyRoles, labelPrefix = 'Transaction graph',
  enrichmentLinks = emptyLinks, heldAccountIds = emptyIds, interruptedTransferIds = emptyIds }: {
  events: ReplayEvent[]; selectedId: string | null; onSelect: (id: string) => void;
  onSelectAccount?: (id: string) => void; roles?: Record<string, string>; labelPrefix?: string;
  enrichmentLinks?: InfrastructureLink[]; heldAccountIds?: string[]; interruptedTransferIds?: string[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  useEffect(() => {
    const cy = cytoscape({ container: container.current!, elements: [],
      style: [
        { selector: 'node', style: { 'background-color': '#14776e', 'label': 'data(label)',
          'color': '#38514f', 'font-size': 10, 'text-margin-y': 5, 'text-valign': 'bottom', 'width': 22, 'height': 22 } },
        { selector: 'edge', style: { 'line-color': '#a6bec0', 'target-arrow-color': '#7e9fa2',
          'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'width': 1.7, 'arrow-scale': 0.9 } },
        { selector: '.highlight', style: { 'line-color': '#d77424', 'target-arrow-color': '#d77424', 'width': 4 } },
        { selector: 'node:selected', style: { 'background-color': '#d77424' } },
        { selector: 'node[kind = "account"][role != "counterparty"]', style: { 'background-color': '#596cb0' } },
        { selector: 'node[kind = "device"]', style: { 'shape': 'diamond', 'background-color': '#c3903f', 'width': 25, 'height': 25 } },
        { selector: 'node[kind = "network"]', style: { 'shape': 'round-rectangle', 'background-color': '#879895', 'width': 25, 'height': 18 } },
        { selector: 'edge[kind = "context"]', style: { 'line-style': 'dotted', 'line-color': '#b6a276', 'target-arrow-shape': 'none', 'width': 1 } },
        { selector: 'node.held', style: { 'border-width': 3, 'border-color': '#b84d40' } },
        { selector: 'edge.interrupted', style: { 'line-color': '#b84d40', 'target-arrow-color': '#b84d40', 'line-style': 'dashed', 'width': 3 } },
      ], minZoom: 0.1, maxZoom: 4, wheelSensitivity: 0.2 });
    cy.on('tap', 'edge[kind = "transfer"]', event => onSelect(event.target.id()));
    cy.on('tap', 'node[kind = "account"]', event => onSelectAccount?.(event.target.data('accountId')));
    graph.current = cy;
    const observer = new ResizeObserver(() => { cy.resize(); cy.fit(undefined, 40); });
    observer.observe(container.current!);
    return () => { observer.disconnect(); cy.destroy(); graph.current = null; };
  }, [onSelect, onSelectAccount]);
  useEffect(() => {
    const cy = graph.current;
    if (!cy) return;
    const nodes = new Map<string, ElementDefinition>();
    const nodeId = (bank: string, account: string) => JSON.stringify([bank, account]);
    const edges = events.map(event => {
      const source = nodeId(event.fromBank, event.fromAccount);
      const target = nodeId(event.toBank, event.toAccount);
      const fromId = `${event.fromBank}/${event.fromAccount}`;
      const toId = `${event.toBank}/${event.toAccount}`;
      nodes.set(source, { data: { id: source, kind: 'account', label: event.fromAccount.slice(-6), accountId: fromId, role: roles[fromId] ?? 'counterparty' } });
      nodes.set(target, { data: { id: target, kind: 'account', label: event.toAccount.slice(-6), accountId: toId, role: roles[toId] ?? 'counterparty' } });
      return { data: { id: event.id, source, target, kind: 'transfer' } };
    });
    const contextEdges: ElementDefinition[] = [];
    for (const link of enrichmentLinks) {
      const id = `synthetic:${link.kind}:${link.value}`;
      const members = [...nodes.values()].filter(node => node.data.kind === 'account' && link.accountIds.includes(node.data.accountId));
      if (members.length < 2) continue;
      nodes.set(id, { data: { id, kind: link.kind, label: link.kind === 'device' ? 'Synthetic device' : 'Synthetic network' } });
      for (const member of members) contextEdges.push({ data: { id: `${link.id}:${member.data.id}`, source: member.data.id, target: id, kind: 'context' } });
    }
    cy.batch(() => {
      cy.elements().remove(); cy.add([...nodes.values(), ...edges, ...contextEdges]);
      cy.nodes().filter(node => heldAccountIds.includes(node.data('accountId'))).addClass('held');
      for (const id of interruptedTransferIds) cy.getElementById(id).addClass('interrupted');
    });
    const components = cy.elements().components();
    const cols = Math.max(1, Math.ceil(Math.sqrt(components.length)));
    components.forEach((component, index) => {
      component.layout({ name: 'circle', fit: false, animate: false,
        boundingBox: { x1: (index % cols) * 200, y1: Math.floor(index / cols) * 200, w: 150, h: 150 },
        sort: (a, b) => a.id().localeCompare(b.id()), padding: 20 }).run();
    });
    cy.fit(undefined, 40);
    if (selectedId) cy.getElementById(selectedId).addClass('highlight');
  }, [events, roles, enrichmentLinks, heldAccountIds, interruptedTransferIds]);
  useEffect(() => {
    graph.current?.edges().removeClass('highlight');
    if (selectedId) graph.current?.getElementById(selectedId).addClass('highlight');
  }, [selectedId]);
  return <div className="graph-wrap"><div className="graph-canvas-wrap"><div ref={container} className="graph" aria-label={`${labelPrefix} showing ${events.length} transfers`}
    data-context-links={enrichmentLinks.length} data-interrupted-transfers={interruptedTransferIds.length} />
    {!events.length && <p className="graph-empty">The network will grow as events arrive.</p>}
    <button className="fit" onClick={() => graph.current?.fit(undefined, 40)}>Fit graph</button></div>
    {enrichmentLinks.length > 0 && <p className="graph-context-legend">Synthetic Talon enrichment; not supplied by IBM AMLWorld · diamonds: devices · rectangles: networks · dotted lines: context, not transfers.</p>}
    {heldAccountIds.length > 0 && <p className="graph-context-legend">Hold preview only · red borders: selected accounts · dashed red arrows: interrupted observed links.</p>}
  </div>;
}
