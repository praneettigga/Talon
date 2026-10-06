import { useMemo, useRef, useState } from 'react';
import type { InvestigationCase, ReplayEvent, ReplayStatus, SimulationResult, SimulationScenario } from './api';

export interface HoldPreview { caseId: string; snapshotCursor: number; scenario: SimulationScenario }

export function Intervention({ investigation, events, replayStatus, onPreview }: {
  investigation: InvestigationCase; events: ReplayEvent[]; replayStatus: ReplayStatus;
  onPreview: (preview: HoldPreview | null) => void;
}) {
  const candidates = useMemo(() => {
    const outgoing = new Map<string, number>();
    for (const event of events.filter(e => investigation.transactionIds.includes(e.id))) {
      const id = `${event.fromBank}/${event.fromAccount}`;
      outgoing.set(id, (outgoing.get(id) ?? 0) + 1);
    }
    return investigation.entities.filter(e => outgoing.has(e.id)).sort((a, b) =>
      Number(a.roles.every(r => r === 'counterparty')) - Number(b.roles.every(r => r === 'counterparty')) ||
      (outgoing.get(b.id)! - outgoing.get(a.id)!) || a.id.localeCompare(b.id));
  }, [events, investigation]);
  const [primary, setPrimary] = useState(candidates[0]?.id ?? '');
  const [additional, setAdditional] = useState<string[] | null>(null);
  const [source, setSource] = useState('');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const requestId = useRef(0);
  const validPrimary = candidates.some(e => e.id === primary) ? primary : candidates[0]?.id ?? '';
  const selectedAdditional = additional ?? candidates.filter(e => e.id !== validPrimary).slice(0, 1).map(e => e.id);
  const group = [validPrimary, ...selectedAdditional.filter(id => id !== validPrimary && candidates.some(e => e.id === id))].filter(Boolean);
  const stale = result && result.snapshotCursor !== events.length;
  function clear() { requestId.current += 1; setResult(null); setError(''); setBusy(false); onPreview(null); }
  async function compare() {
    const identity = ++requestId.current;
    setBusy(true); setError(''); setResult(null); onPreview(null);
    try {
      const response = await fetch('/v1/interventions/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: investigation.id, heldAccountIds: [validPrimary], compareHeldAccountIds: group,
          sourceAccountIds: source ? [source] : undefined, expectedCursor: events.length }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Comparison unavailable');
      if (identity !== requestId.current) return;
      setResult(body); setPreviewIndex(0);
      onPreview({ caseId: body.caseId, snapshotCursor: body.snapshotCursor, scenario: body.scenarios[0] });
    } catch (failure) { if (identity === requestId.current) setError((failure as Error).message); }
    finally { if (identity === requestId.current) setBusy(false); }
  }
  return <section className="intervention" aria-label="Intervention comparison"><h3>Compare observed-route disruption</h3>
    <p className="muted">Observed-route disruption; assumes similar routes recur. This compares the observed graph only and executes no hold.</p>
    <div className="hold-controls"><label>Single-account hold <select aria-label="Single-account hold" value={validPrimary} disabled={busy}
      onChange={event => { clear(); setPrimary(event.target.value); setAdditional(candidates.filter(e => e.id !== event.target.value).slice(0, 1).map(e => e.id)); }}>
      {candidates.map(e => <option key={e.id} value={e.id}>{e.id} · {e.roles.join(', ')}</option>)}</select></label>
      <label>Compare routes from <select aria-label="Comparison source" value={source} disabled={busy}
        onChange={event => { clear(); setSource(event.target.value); }}><option value="">Automatic observed sources</option>
        {candidates.map(e => <option key={e.id} value={e.id}>{e.id}</option>)}</select></label></div>
    <fieldset className="group-holds" disabled={busy}><legend>Group hold · includes the single-account hold</legend>
      {candidates.map(e => <label key={e.id}><input type="checkbox" aria-label={`Include ${e.id} in group hold`}
        checked={group.includes(e.id)} disabled={e.id === validPrimary || (group.length >= 32 && !group.includes(e.id))}
        onChange={event => { clear(); setAdditional(event.target.checked ? [...selectedAdditional, e.id] : selectedAdditional.filter(id => id !== e.id)); }} />
        {e.id} <span className="muted">{e.roles.join(', ')}</span></label>)}</fieldset>
    <div className="compare-action"><button disabled={busy || replayStatus === 'running' || !validPrimary || group.length < 2} onClick={compare}>
      {busy ? 'Comparing…' : 'Compare holds'}</button>
      <span className="muted">{replayStatus === 'running' ? 'Pause replay to compare a stable view.' : group.length < 2 ? 'Select another account for the group comparison.' : `${group.length} accounts in group hold.`}</span></div>
    {error && <p role="alert" className="notice">{error}</p>}
    {result && <div className="simulation-result" aria-label="Hold comparison result">
      <p className="muted">{result.label} Snapshot {result.snapshotCursor} · {result.observedAt.replace('T', ' ')}.<br />
        Sources: {result.sourceAccountIds.join(', ')} · {result.sourcePolicy}</p>
      {stale && <p role="status" className="notice">Replay advanced since this comparison. Pause and compare again; the graph preview is cleared.</p>}
      <table><thead><tr><th>Observed-graph effect</th><th>Single hold</th><th>Group hold</th></tr></thead><tbody>
        <tr><td>Held accounts</td>{result.scenarios.map(s => <td key={s.name}>{s.heldAccountIds.length}</td>)}</tr>
        <tr><td>Interrupted transfer links</td>{result.scenarios.map(s => <td key={s.name}>{s.interruptedTransferCount}</td>)}</tr>
        <tr><td>Downstream accounts no longer reachable</td>{result.scenarios.map(s => <td key={s.name}>{s.noLongerReachableAccountIds.length}</td>)}</tr>
        <tr><td>Remaining observed alternate route witnesses</td>{result.scenarios.map(s => <td key={s.name}>{s.remainingAlternateRouteCount}</td>)}</tr>
        <tr><td>Directly touched accounts / counterparties</td>{result.scenarios.map(s => <td key={s.name}>{s.directlyTouchedAccountIds.length} / {s.touchedCounterpartyIds.length}</td>)}</tr>
      </tbody></table>
      {result.comparison && <p className="muted">Group hold interrupts {result.comparison.additionalInterruptedTransferIds.length} additional links and makes
        {' '}{result.comparison.additionalUnreachableAccountIds.length} additional downstream accounts unreachable.</p>}
      <div className="preview-controls">{result.scenarios.map((scenario, index) => <button key={scenario.name} disabled={!!stale}
        aria-pressed={previewIndex === index} onClick={() => { setPreviewIndex(index); onPreview({ caseId: result.caseId, snapshotCursor: result.snapshotCursor, scenario }); }}>
        Preview {index === 0 ? 'single' : 'group'} hold</button>)}</div>
      <p className="muted">{result.method}</p>
      <div className="simulation-details">{result.scenarios.map((scenario, index) => <details key={scenario.name}><summary>{index === 0 ? 'Single' : 'Group'} hold · supporting route evidence</summary>
        <p>Held: {scenario.heldAccountIds.join(', ')}</p>
        <p>No longer reachable: {scenario.noLongerReachableAccountIds.join(', ') || 'None'}</p>
        <p>Directly touched: {scenario.directlyTouchedAccountIds.join(', ')}</p>
        <p>Counterparties touched: {scenario.touchedCounterpartyIds.join(', ') || 'None'}</p>
        <details><summary>Interrupted transfers ({scenario.interruptedTransferCount})</summary><p>{scenario.interruptedTransferIds.join(', ') || 'None'}</p></details>
        <details><summary>Remaining route witnesses ({scenario.remainingRouteCount}){scenario.routesTruncated ? ' · first 50 shown' : ''}</summary>
          {scenario.remainingRoutes.map(route => <p key={route.destination}>{route.accountIds.join(' → ')}
            {route.alternateToInterruptedBaseline ? ' · alternate to interrupted baseline witness' : ''}<br />
            <span className="muted">Transfers: {route.transactionIds.join(', ')}</span></p>)}</details>
      </details>)}</div>
    </div>}
  </section>;
}
