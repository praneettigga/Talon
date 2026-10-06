import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Control, ReplayEvent, Snapshot } from './api';
import { Graph } from './Graph';
import { Investigation } from './Investigation';
import './style.css';

const account = (bank: string, id: string) => `${bank} / ${id}`;
const time = (stamp: string | null) => stamp?.replace('T', ' ') ?? 'Waiting for first event';

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullGraph, setFullGraph] = useState(false);
  useEffect(() => {
    const stream = new EventSource('/v1/events/stream');
    stream.addEventListener('snapshot', event => {
      const next: Snapshot = JSON.parse((event as MessageEvent).data);
      setSnapshot(next); setConnected(true);
      if (next.cursor === 0) setSelectedId(null);
    });
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, []);
  async function control(command: Control) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/v1/replay/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Replay control failed');
      // SSE is authoritative; HTTP replies can arrive out of order.
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  const events = snapshot?.events ?? [];
  const visible = useMemo(() => fullGraph ? events : events.slice(-40), [snapshot, fullGraph]);
  const selected = events.find(event => event.id === selectedId);
  const accounts = new Set(events.flatMap(event => [account(event.fromBank, event.fromAccount), account(event.toBank, event.toAccount)]));
  const disabled = !connected || busy || snapshot?.status === 'unavailable';
  return <main>
    <header><div><p className="eyebrow">TALON / TRANSACTION REPLAY</p><h1>Follow the money.</h1>
      <p className="muted">IBM AMLWorld HI-Small synthetic AML benchmark</p></div>
      <span className={`badge ${connected ? 'online' : ''}`}>{connected ? 'Connected' : 'Connecting…'}</span></header>
    <section className="controls" aria-label="Replay controls">
      <button className="primary" disabled={disabled || snapshot?.status === 'completed'}
        onClick={() => control({ action: snapshot?.status === 'running' ? 'pause' : 'start' })}>
        {snapshot?.status === 'running' ? 'Pause' : 'Start replay'}</button>
      <button disabled={disabled} onClick={() => control({ action: 'reset' })}>Reset</button>
      <label>Speed <select aria-label="Replay speed" value={snapshot?.speed ?? 1} disabled={disabled}
        onChange={event => control({ action: 'speed', speed: Number(event.target.value) as 1 | 5 | 20 })}>
        <option value="1">1 event / sec</option><option value="5">5 events / sec</option><option value="20">20 events / sec</option>
      </select></label>
      <span className="play-state">{snapshot?.status ?? 'Loading'}</span>
      <span className="progress-label">{snapshot?.cursor ?? 0} / {snapshot?.total ?? 0} events</span>
      <progress aria-label="Replay progress" value={snapshot?.cursor ?? 0} max={snapshot?.total || 1} />
    </section>
    {(error || snapshot?.error || !connected) && <p role="alert" className="notice">
      {error || snapshot?.error || 'Connecting to the replay service. Controls will be available when the connection returns.'}</p>}
    <div className="stats"><div><span>Event time · source timezone unspecified</span><strong>{time(snapshot?.eventTime ?? null)}</strong></div>
      <div><span>Accounts observed</span><strong>{accounts.size}</strong></div>
      <div><span>Replay mode</span><strong>Curated sample</strong></div></div>
    <div className="workspace">
      <section className="panel graph-panel"><div className="panel-heading"><div><h2>Transaction network</h2>
        <p className="muted">Accounts are nodes. Arrows show transfers.</p></div>
        <label className="toggle"><input type="checkbox" checked={fullGraph} onChange={event => setFullGraph(event.target.checked)} /> All observed events</label></div>
        <Graph events={visible} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="graph-footer"><span>Showing {visible.length} {fullGraph ? 'observed' : 'most recent'} transfers · click an arrow to inspect</span>
          <span>Scroll to zoom · drag to pan</span></div>
      </section>
      <section className="panel feed-panel"><div className="panel-heading"><div><h2>Live event feed</h2><p className="muted">Latest 50 transactions · newest first</p></div></div>
        <div className="feed" aria-label="Transaction feed">
          {!events.length && <p className="empty">Start replay to watch transactions arrive.</p>}
          {events.slice(-50).reverse().map(event => <button key={event.id} className={`event ${event.id === selectedId ? 'selected' : ''}`}
            onClick={() => setSelectedId(event.id)}><span className="event-top"><strong>{event.amountPaid} {event.paymentCurrency}</strong><small>{event.timestamp.slice(11, 16)}</small></span>
            <span className="route">{event.fromAccount} → {event.toAccount}</span>
            <span className="muted">{event.paymentFormat} · Source row {event.sourceRow.toLocaleString()}</span></button>)}
        </div></section>
    </div>
    {snapshot && <Investigation intelligence={snapshot.intelligence} events={events}
      selectedTransaction={selectedId} onSelectTransaction={setSelectedId} />}
    <section className="panel detail-panel"><h2>Transaction details</h2>
      {selected ? <Details event={selected} /> : <p className="muted">Select a transaction from the feed or graph to see its source fields.</p>}
    </section>
    <footer>Curated demonstration subset. Structure strength is a heuristic, not fraud probability. Risk models arrive in milestone 4.</footer>
  </main>;
}

function Details({ event }: { event: ReplayEvent }) {
  return <dl><div><dt>Transaction / source row</dt><dd>{event.id} / {event.sourceRow}</dd></div>
    <div><dt>Timestamp</dt><dd>{time(event.timestamp)}</dd></div>
    <div><dt>Sender · bank / account</dt><dd>{account(event.fromBank, event.fromAccount)}</dd></div>
    <div><dt>Recipient · bank / account</dt><dd>{account(event.toBank, event.toAccount)}</dd></div>
    <div><dt>Amount paid</dt><dd>{event.amountPaid} {event.paymentCurrency}</dd></div>
    <div><dt>Amount received</dt><dd>{event.amountReceived} {event.receivingCurrency}</dd></div>
    <div><dt>Payment format</dt><dd>{event.paymentFormat}</dd></div></dl>;
}
createRoot(document.getElementById('root')!).render(<App />);
