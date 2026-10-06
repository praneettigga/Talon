import { useMemo, useState } from 'react';
import type { IntelligenceSnapshot, ReplayEvent } from './api';
import { Graph } from './Graph';

export function Investigation({ intelligence, events, selectedTransaction, onSelectTransaction }: {
  intelligence: IntelligenceSnapshot; events: ReplayEvent[]; selectedTransaction: string | null;
  onSelectTransaction: (id: string) => void;
}) {
  const [caseId, setCaseId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const cases = intelligence.cases;
  const selected = cases.find(item => item.id === caseId || (caseId && item.mergedCaseIds.includes(caseId))) ?? cases[0];
  const transactions = useMemo(() => events.filter(event => selected?.transactionIds.includes(event.id)), [events, selected]);
  const roles = useMemo(() => Object.fromEntries(selected?.entities.map(entity => [entity.id, entity.roles.join(', ')]) ?? []), [selected]);
  const entity = selected?.entities.find(item => item.id === accountId) ?? selected?.entities.find(item => !item.roles.every(role => role === 'counterparty'));
  const features = entity && intelligence.entities[entity.id];
  return <section className="investigation" aria-label="Case investigation">
    <aside className="panel case-queue"><div className="panel-heading"><div><h2>Case queue</h2>
      <p className="muted">{cases.length} structural cases · severity order</p></div></div>
      <p className="queue-note">Rules: {intelligence.enabledTypologies.join(', ') || 'Unavailable'}<br />Structure window: {intelligence.ruleWindow}</p>
      {intelligence.status === 'unavailable' ? <p role="alert" className="notice">Intelligence unavailable: {intelligence.error}</p>
        : !cases.length ? <p className="empty">Cases appear when supported structures emerge.</p>
        : <div className="case-list">{cases.map(item => <button key={item.id} className={`case-item ${selected?.id === item.id ? 'selected' : ''}`}
          onClick={() => { setCaseId(item.id); setAccountId(null); }}>
          <span className="event-top"><strong>{item.id}</strong><span className="severity">{item.severity}</span></span>
          <span className="case-types">{item.typologies.join(' · ')}</span>
          <span className="muted">{item.transactionIds.length} transfers · {item.entities.length} accounts</span></button>)}</div>}
    </aside>
    <div className="panel case-detail"><div className="panel-heading"><div><h2>{selected ? `Investigation · ${selected.id}` : 'Evidence and timeline'}</h2>
      <p className="muted">Structural findings are hypotheses; model corroboration is pending.</p></div></div>
      {selected ? <>
        <p className="severity-explanation"><span className="severity">{selected.severity}</span> {selected.severityReason}<br />
          <span className="muted">Inputs: {selected.severityInputs.structuralFindings} structures · {selected.severityInputs.affectedEntities} accounts ·
            {' '}{selected.severityInputs.corroboratedSignals} corroborated signals · highest entity risk: unavailable</span></p>
        <Graph events={transactions} selectedId={selectedTransaction} onSelect={onSelectTransaction}
          onSelectAccount={setAccountId} roles={roles} labelPrefix="Case graph" />
        <div className="case-columns"><div><h3>Evidence</h3><div className="evidence-list">
          {selected.connections.length > 0 && <details className="correlation-links"><summary>Why these findings belong together ({selected.connections.length} links)</summary>
            {selected.connections.map((link, index) => <p key={index} className="muted">{link.via}: {link.sharedIds.join(', ')} · {link.observedAt.replace('T', ' ')}</p>)}</details>}
          {selected.evidence.map(finding => <article key={finding.id} className="evidence-card"><strong>{finding.typology}</strong>
            <span className="muted"> · Structure strength {finding.strength.toFixed(2)} / 1</span>
            {finding.facts.map(fact => <p key={fact}>{fact}</p>)}
            <p className="muted">{finding.window.first.replace('T', ' ')} → {finding.window.last.replace('T', ' ')} · observed {finding.observedAt.replace('T', ' ')}</p>
            <details><summary>{finding.transactionIds.length} supporting transactions</summary><div className="transaction-links">
              {finding.transactionIds.map(id => <button key={id} onClick={() => onSelectTransaction(id)}>{id}</button>)}</div></details>
          </article>)}</div></div>
          <div><h3>Case timeline</h3><ol className="timeline">{selected.timeline.map((point, index) => <li key={`${point.findingId}-${index}`}>
            <time>{point.timestamp.replace('T', ' ')}</time><strong>{point.stage}</strong>
            <span>{point.linkedTransactions} linked transfers · {point.severity}</span></li>)}</ol></div></div>
        <div className="account-details"><h3>Account evidence</h3><label>Inspect account <select aria-label="Inspect case account" value={entity?.id ?? ''}
          onChange={event => setAccountId(event.target.value)}>{selected.entities.map(item => <option key={item.id} value={item.id}>{item.id} · {item.roles.join(', ')}</option>)}</select></label>
          {entity && <p><strong>{entity.id}</strong> · Observed role: {entity.roles.join(', ')}. Suspicion status: unassessed.</p>}
          <p className="muted">Risk score: unavailable · Behaviour model: not trained · GNN: not trained</p>
          {features && <><p className="muted">Prior-event feature snapshot at {features.asOf.replace('T', ' ')} · {features.currency} · {features.historyStatus}</p>
            <dl><div><dt>Prior one-hour inflow</dt><dd>{features.incomingTotal} {features.currency} / {features.incomingCount} transfers</dd></div>
              <div><dt>Prior one-hour outflow</dt><dd>{features.outgoingTotal} {features.currency} / {features.outgoingCount} transfers</dd></div>
              <div><dt>Five-minute / one-hour velocity</dt><dd>{features.fiveMinuteVelocity} / {features.oneHourVelocity}</dd></div>
              <div><dt>Fan-in / fan-out degree</dt><dd>{features.fanInDegree} / {features.fanOutDegree}</dd></div>
              <div><dt>Forwarding ratio</dt><dd>{features.forwardingRatio ?? 'Insufficient inflow'}</dd></div>
              <div><dt>Historical amount mean</dt><dd>{features.amountMean ?? 'No history'}</dd></div>
              <div><dt>Amount deviation (z-score)</dt><dd>{features.amountZScore ?? 'Insufficient history or zero variance'}</dd></div>
              <div><dt>New counterparty</dt><dd>{features.newCounterparty ? 'Yes' : 'No'}</dd></div></dl></>}
        </div>
      </> : <p className="empty">Start the replay to build an investigation from observed transfers.</p>}
    </div>
  </section>;
}
