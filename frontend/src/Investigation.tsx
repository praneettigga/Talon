import { Term } from './components/Term'
import { useEffect, useMemo, useState } from 'react';
import type { IntelligenceSnapshot, ReplayEvent, ReplayStatus } from './api';
import { Graph } from './Graph';
import { Risk } from './Risk';
import { Intervention, type HoldPreview } from './Intervention';
import { Enrichment } from './Enrichment';

export function Investigation({ intelligence, events, selectedTransaction, onSelectTransaction, replayStatus, initialCaseId }: {
  intelligence: IntelligenceSnapshot; events: ReplayEvent[]; selectedTransaction: string | null;
  onSelectTransaction: (id: string) => void;
  replayStatus: ReplayStatus;
  initialCaseId?: string | null;
}) {
  const [caseId, setCaseId] = useState<string | null>(initialCaseId ?? null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [preview, setPreview] = useState<HoldPreview | null>(null);
  const cases = intelligence.cases;
  const selected = cases.find(item => item.id === caseId || (caseId && item.mergedCaseIds.includes(caseId))) ?? cases[0];
  const transactions = useMemo(() => events.filter(event => selected?.transactionIds.includes(event.id)), [events, selected]);
  const roles = useMemo(() => Object.fromEntries(selected?.entities.map(entity => [entity.id, entity.roles.join(', ')]) ?? []), [selected]);
  const entity = selected?.entities.find(item => item.id === accountId) ?? selected?.entities.find(item => !item.roles.every(role => role === 'counterparty'));
  const features = entity && intelligence.entities[entity.id];
  useEffect(() => { setCaseId(initialCaseId ?? null); setAccountId(null); }, [initialCaseId]);
  useEffect(() => { setPreview(null); }, [selected?.id]);
  const links = useMemo(() => intelligence.enrichment.links.filter(link =>
    link.accountIds.filter(id => selected?.entities.some(e => e.id === id)).length >= 2), [intelligence.enrichment.links, selected]);
  const shownPreview = preview?.caseId === selected?.id && preview?.snapshotCursor === events.length ? preview.scenario : null;
  return <section className="investigation" aria-label="Case investigation">
    <aside className="panel case-queue"><div className="panel-heading"><div><h2>Case queue</h2>
      <p className="muted">{cases.length} structural cases · severity order</p></div></div>
      <div className="queue-note"><div><strong>Enabled rules</strong><ul>{(intelligence.enabledTypologies.length ? intelligence.enabledTypologies : ['Unavailable']).map(rule => <li key={rule}>{rule}</li>)}</ul></div>
        <p><strong>Structure window</strong><span>{intelligence.ruleWindow}</span></p></div>
      {intelligence.status === 'unavailable' ? <p role="alert" className="notice">Intelligence unavailable: {intelligence.error}</p>
        : !cases.length ? <p className="empty">Cases appear when supported structures emerge.</p>
        : <div className="case-picker"><label htmlFor="investigation-case-select">Select a case</label>
          <select id="investigation-case-select" aria-label="Select an investigation case" value={selected?.id ?? ''}
            onChange={event => { setCaseId(event.target.value); setAccountId(null); }}>
            {cases.map(item => <option key={item.id} value={item.id}>{item.id} · {item.severity}</option>)}
          </select>
          {selected && <div className="case-picker-summary"><strong>{selected.typologies.join(' · ')}</strong>
            <span>{selected.transactionIds.length} transfers</span><span>{selected.entities.length} accounts</span>
          </div>}
        </div>}
    </aside>
    <div className="panel case-detail"><div className="panel-heading"><div><h2>{selected ? `Investigation · ${selected.id}` : 'Evidence and timeline'}</h2>
      <p className="muted">Structural findings are hypotheses; scores provide corroboration.</p></div></div>
      {selected ? <>
        <div className="severity-explanation"><span className="severity">{selected.severity}</span>
          <ul><li>{selected.severityReason}</li>
            <li>{selected.severityInputs.structuralFindings} structures · {selected.severityInputs.affectedEntities} accounts</li>
            <li>{selected.severityInputs.corroboratedSignals} corroborated signal types: {selected.severityInputs.signalTypes.join(', ') || 'none'}</li>
            <li>Highest structural entity risk: {selected.severityInputs.highestEntityRisk?.toFixed(1) ?? 'unavailable'} / 100</li>
            <li>Review threshold: {selected.severityInputs.reviewThreshold?.toFixed(1) ?? 'unavailable'} / 100</li>
          </ul></div>
        <Graph events={transactions} selectedId={selectedTransaction} onSelect={onSelectTransaction}
          onSelectAccount={setAccountId} roles={roles} labelPrefix="Case graph" enrichmentLinks={links}
          heldAccountIds={shownPreview?.heldAccountIds} interruptedTransferIds={shownPreview?.interruptedTransferIds} />
        <div className="case-columns"><div><h3>Evidence</h3><div className="evidence-list">
          {selected.connections.length > 0 && <details className="correlation-links"><summary>Why these findings belong together ({selected.connections.length} links)</summary>
            {selected.connections.map((link, index) => <p key={index} className="muted">{link.via}: {link.sharedIds.join(', ')} · {link.observedAt.replace('T', ' ')}</p>)}</details>}
          {selected.evidence.map(finding => <article key={finding.id} className="evidence-card"><strong>{finding.typology}</strong>
            <span className="muted"> · Structure strength {finding.strength.toFixed(2)} / 1</span>
            <p className="muted">{finding.corroborated ? 'Model corroboration observed' : 'No model corroboration'}</p>
            {finding.facts.length > 0 && <ul>{finding.facts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
            <p className="muted">{finding.window.first.replace('T', ' ')} → {finding.window.last.replace('T', ' ')} · observed {finding.observedAt.replace('T', ' ')}</p>
            <details><summary>{finding.transactionIds.length} supporting transactions</summary><div className="transaction-links">
              {finding.transactionIds.map(id => <button key={id} onClick={() => onSelectTransaction(id)}>{id}</button>)}</div></details>
          </article>)}</div></div>
          <div><h3><Term>Case timeline</Term></h3><ol className="timeline">{selected.timeline.map((point, index) => <li key={`${point.findingId}-${index}`}>
            <time>{point.timestamp.replace('T', ' ')}</time><strong>{point.stage}</strong>
            <span>{point.linkedTransactions} linked transfers · {point.severity} · highest entity risk {point.highestEntityRisk?.toFixed(1) ?? 'unavailable'}</span></li>)}</ol></div></div>
        <div className="account-details"><h3>Account evidence</h3><label>Inspect account <select aria-label="Inspect case account" value={entity?.id ?? ''}
          onChange={event => setAccountId(event.target.value)}>{selected.entities.map(item => <option key={item.id} value={item.id}>{item.id} · {item.roles.join(', ')}</option>)}</select></label>
          {entity && <p><strong>{entity.id}</strong> · Observed role: {entity.roles.join(', ')}. Suspicion status: unassessed.</p>}
          <Risk risk={entity ? intelligence.entityRisks[entity.id] : undefined} />
          {features && <><p className="muted">Prior-event feature snapshot at {features.asOf.replace('T', ' ')} · {features.currency} · {features.historyStatus}</p>
            <dl><div><dt><Term>Prior one-hour inflow</Term></dt><dd>{features.incomingTotal} {features.currency} / {features.incomingCount} transfers</dd></div>
              <div><dt><Term>Prior one-hour outflow</Term></dt><dd>{features.outgoingTotal} {features.currency} / {features.outgoingCount} transfers</dd></div>
              <div><dt><Term>Five-minute / one-hour velocity</Term></dt><dd>{features.fiveMinuteVelocity} / {features.oneHourVelocity}</dd></div>
              <div><dt><Term>Fan-in / fan-out degree</Term></dt><dd>{features.fanInDegree} / {features.fanOutDegree}</dd></div>
              <div><dt><Term>Forwarding ratio</Term></dt><dd>{features.forwardingRatio ?? 'Insufficient inflow'}</dd></div>
              <div><dt><Term>Historical amount mean</Term></dt><dd>{features.amountMean ?? 'No history'}</dd></div>
              <div><dt><Term>Amount deviation (z-score)</Term></dt><dd>{features.amountZScore ?? 'Insufficient history or zero variance'}</dd></div>
              <div><dt><Term>New counterparty</Term></dt><dd>{features.newCounterparty ? 'Yes' : 'No'}</dd></div></dl></>}
        </div>
        <Enrichment context={intelligence.enrichment} links={links} account={entity ? intelligence.enrichment.accounts[entity.id] : undefined} />
        <Intervention key={selected.id} investigation={selected} events={events} replayStatus={replayStatus} onPreview={setPreview} />
      </> : <p className="empty">Start the replay to build an investigation from observed transfers.</p>}
    </div>
  </section>;
}
