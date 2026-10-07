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
  return <section className="panel model-status" aria-label="Case reconstruction evaluation"><h2>Case reconstruction · {state?.status ?? 'loading'}</h2>
    {state?.status === 'unavailable' && <p role="alert" className="notice">{state.error}</p>}
    {report && <><p className="muted">{report.scope} This frozen evaluation is separate from the curated live demo. Test window {report.window.start.replace('T', ' ')} → {report.window.endExclusive.replace('T', ' ')} (end exclusive).</p>
      <div className="risk-metrics"><div><span>Case precision</span><strong>{fraction(report.overall.precision)}</strong></div>
        <div><span>Case recall</span><strong>{fraction(report.overall.recall)}</strong></div>
        <div><span>Mean matched Jaccard</span><strong>{report.overall.meanMatchedJaccard?.toFixed(3) ?? 'Unavailable'}</strong></div></div>
      <p className="muted">{report.overall.matched} matched / {report.overall.detectedCases} detected cases / {report.overall.groundTruthAttempts} supported attempts.
        {' '}{report.overall.unmatchedDetected} unmatched cases; {report.overall.missedAttempts} missed attempts.</p>
      <details className="evaluation" open={expanded}><summary>Supported typologies and evaluation method</summary>
        <table><thead><tr><th>Typology</th><th>Detected / attempts / matched</th><th>Precision</th><th>Recall</th><th>Jaccard</th></tr></thead>
          <tbody>{Object.entries(report.byTypology).map(([name, m]) => <tr key={name}><td>{name}</td>
            <td>{m.detectedCases} / {m.groundTruthAttempts} / {m.matched}</td><td>{fraction(m.precision)}</td><td>{fraction(m.recall)}</td>
            <td>{m.meanMatchedJaccard?.toFixed(3) ?? 'Unavailable'}</td></tr>)}</tbody></table>
        <p className="muted">{report.matching}</p><p className="muted">{report.projection}</p>
        <p className="muted">{report.warmupEvents} warmup events; {report.population.testTransactions} test transfers;
          {' '}{report.population.excludedTransactions} excluded campaign transfers; {report.population.excludedAttempts.length} excluded attempts.</p>
        <details><summary>Excluded attempts ({report.population.excludedAttempts.length})</summary>
          {report.population.excludedAttempts.map(attempt => <p className="muted" key={attempt.id}>{attempt.id} · {attempt.typology} · {attempt.reason}</p>)}
        </details>
        {report.limitations.map(item => <p className="muted" key={item}>{item}</p>)}
        <p className="muted">Dataset: {report.dataset}<br />Source SHA-256: {report.sourceSha256}<br />Evaluation input SHA-256: {report.datasetSha256}</p>
      </details></>}
  </section>;
}
