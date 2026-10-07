import { Term } from './components/Term'
import { useEffect, useState } from 'react';

interface Metrics {
  detectedCases: number; groundTruthAttempts: number; matched: number; unmatchedDetected: number; missedAttempts: number;
  precision: number | null; recall: number | null; meanMatchedJaccard: number | null;
}
interface Report {
  schemaVersion: 1; status: 'ready'; dataset: string; window: { start: string; endExclusive: string };
  warmupEvents: number; replayedEvents: number; overall: Metrics; byTypology: Record<string, Metrics>;
  scope: string; matching: string; projection: string; limitations: string[];
  sourceSha256: string; datasetSha256: string; transactionEvaluationSha256: string;
  population: { testTransactions: number; metricTransactions: number; excludedTransactions: number;
    excludedAttempts: { id: string; typology: string; reason: string }[] };
}
type EvaluationState = { status: 'ready'; report: Report } | { status: 'unavailable'; error: string };
const fraction = (value: number | null) => value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;

export function CaseEvaluation({ expanded = false }: { expanded?: boolean }) {
  const [state, setState] = useState<EvaluationState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/v1/evaluation/cases', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (body.status !== 'ready' && body.status !== 'unavailable') throw new Error('Invalid evaluation response');
      setState(body);
    }).catch(error => { if (!controller.signal.aborted) setState({ status: 'unavailable', error: error.message }); });
    return () => controller.abort();
  }, []);
  const report = state?.status === 'ready' ? state.report : null;
  return <section className="panel model-status" aria-label="Case reconstruction evaluation"><div className="evaluation-section-heading"><div><span className="eyebrow">02 / CASE QUALITY</span><h2><Term>Case reconstruction</Term></h2></div><span className={`evaluation-status ${state?.status ?? 'loading'}`}>{state?.status ?? 'loading'}</span></div>
    {!state && <p className="muted" role="status">Loading case evaluation metrics…</p>}
    {state?.status === 'unavailable' && <p role="alert" className="notice">{state.error}</p>}
    {report && <><p className="muted">{report.scope} This frozen evaluation is separate from the curated live demo. Test window {report.window.start.replace('T', ' ')} → {report.window.endExclusive.replace('T', ' ')} (end exclusive).</p>
      <div className="risk-metrics"><div><span><Term>Case precision</Term></span><strong>{fraction(report.overall.precision)}</strong></div>
        <div><span><Term>Case recall</Term></span><strong>{fraction(report.overall.recall)}</strong></div>
        <div><span><Term>Mean matched Jaccard</Term></span><strong>{report.overall.meanMatchedJaccard?.toFixed(3) ?? 'Unavailable'}</strong></div></div>
      <p className="muted">{report.overall.matched} matched / {report.overall.detectedCases} detected cases / {report.overall.groundTruthAttempts} supported attempts.
        {' '}{report.overall.unmatchedDetected} unmatched cases; {report.overall.missedAttempts} missed attempts.</p>
      <details className="evaluation" open={expanded}><summary>Supported typologies and evaluation method</summary>
        <table><thead><tr><th><Term>Typology</Term></th><th><Term>Detected / attempts / matched</Term></th><th><Term>Precision</Term></th><th><Term>Recall</Term></th><th><Term>Jaccard</Term></th></tr></thead>
          <tbody>{Object.entries(report.byTypology).map(([name, m]) => <tr key={name}><td>{name}</td>
            <td>{m.detectedCases} / {m.groundTruthAttempts} / {m.matched}</td><td>{fraction(m.precision)}</td><td>{fraction(m.recall)}</td>
            <td>{m.meanMatchedJaccard?.toFixed(3) ?? 'Unavailable'}</td></tr>)}</tbody></table>
        <p className="muted">{report.matching}</p><p className="muted">{report.projection}</p>
        <p className="muted">{report.warmupEvents} warmup events; {report.population.testTransactions} test transfers;
          {' '}{report.population.excludedTransactions} excluded campaign transfers; {report.population.excludedAttempts.length} excluded attempts.</p>
        {report.limitations.map(item => <p className="muted" key={item}>{item}</p>)}
        <p className="muted">Dataset: {report.dataset}<br />Source SHA-256: {report.sourceSha256}<br />Evaluation input SHA-256: {report.datasetSha256}</p>
      </details></>}
  </section>;
}
