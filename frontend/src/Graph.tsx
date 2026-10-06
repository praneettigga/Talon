import { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import type { ReplayEvent } from '../../backend/src/contracts';

export function Graph({ events, selectedId, onSelect }: {
  events: ReplayEvent[]; selectedId: string | null; onSelect: (id: string) => void;
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
      ], minZoom: 0.1, maxZoom: 4, wheelSensitivity: 0.2 });
    cy.on('tap', 'edge', event => onSelect(event.target.id()));
    graph.current = cy;
    const observer = new ResizeObserver(() => { cy.resize(); cy.fit(undefined, 40); });
    observer.observe(container.current!);
    return () => { observer.disconnect(); cy.destroy(); graph.current = null; };
  }, [onSelect]);
  useEffect(() => {
    const cy = graph.current;
    if (!cy) return;
    const nodes = new Map<string, { data: { id: string; label: string } }>();
    const nodeId = (bank: string, account: string) => JSON.stringify([bank, account]);
    const edges = events.map(event => {
      const source = nodeId(event.fromBank, event.fromAccount);
      const target = nodeId(event.toBank, event.toAccount);
      nodes.set(source, { data: { id: source, label: event.fromAccount.slice(-6) } });
      nodes.set(target, { data: { id: target, label: event.toAccount.slice(-6) } });
      return { data: { id: event.id, source, target } };
    });
    cy.batch(() => { cy.elements().remove(); cy.add([...nodes.values(), ...edges]); });
    const components = cy.elements().components();
    const cols = Math.max(1, Math.ceil(Math.sqrt(components.length)));
    components.forEach((component, index) => {
      component.layout({ name: 'circle', fit: false, animate: false,
        boundingBox: { x1: (index % cols) * 200, y1: Math.floor(index / cols) * 200, w: 150, h: 150 },
        sort: (a, b) => a.id().localeCompare(b.id()), padding: 20 }).run();
    });
    cy.fit(undefined, 40);
    if (selectedId) cy.getElementById(selectedId).addClass('highlight');
  }, [events]);
  useEffect(() => {
    graph.current?.edges().removeClass('highlight');
    if (selectedId) graph.current?.getElementById(selectedId).addClass('highlight');
  }, [selectedId]);
  return <div className="graph-wrap"><div ref={container} className="graph" aria-label={`Transaction graph showing ${events.length} transfers`} />
    {!events.length && <p className="graph-empty">The network will grow as events arrive.</p>}
    <button className="fit" onClick={() => graph.current?.fit(undefined, 40)}>Fit graph</button></div>;
}
