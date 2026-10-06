import type { DecisionRisk, EntityRisk, ModelStatus } from './api';

const score = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toFixed(1);
const fraction = (value: number | null) => value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;

export function Risk({ risk }: { risk: DecisionRisk | EntityRisk | undefined }) {
  if (!risk) return <p className="muted">No model decision observed.</p>;
  const contributions = [...risk.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const aggregate = 'aggregation' in risk ? risk : null;
  return <div className="risk-panel" aria-label="Model risk explanation">
    <div className="risk-metrics"><div><span>{aggregate ? 'Entity risk / 100' : 'Transaction risk / 100'}</span><strong>{score(risk.riskScore)}</strong></div>
      <div><span>Behaviour anomaly / 1</span><strong>{risk.behaviourScore?.toFixed(3) ?? 'Unavailable'}</strong></div>
      <div><span>IBM GIN relational score / 1</span><strong>{risk.ginScore?.toFixed(3) ?? 'Unavailable'}</strong></div></div>
    <p className="muted">{risk.status} · {risk.asOf.replace('T', ' ')} · {risk.reason}</p>
    {risk.behaviourScore == null && risk.status === 'scored' && <p className="muted">Insufficient behavioural history or no trained currency baseline. No behavioural anomaly penalty.</p>}
    {aggregate && <p className="muted">Entity aggregate as of {aggregate.riskAsOf.replace('T', ' ')}. {aggregate.aggregation} Highest contributing transaction: {aggregate.riskSourceTransactionId ?? 'none'}.
      {' '}Latest transaction score: {score(aggregate.transactionRiskScore)} / 100.</p>}
    {risk.status === 'scored' && <>
      <p className="muted">Behaviour means unusual compared with historical account behaviour. GIN supplies learned relational evidence. Neither is a fraud probability.</p>
      <details className="contributions"><summary>XGBoost decision contributions ({contributions.length} inputs)</summary>
        <p className="muted">Signed contributions explain the latest transaction's raw XGBoost margin before calibration and entity aggregation.
          {' '}Base {risk.baseMargin?.toFixed(3)} + contributions = margin {risk.rawMargin?.toFixed(3)}.</p>
        <table><thead><tr><th>Input</th><th>Model value</th><th>Margin contribution</th></tr></thead><tbody>
          {contributions.map(item => <tr key={item.feature}><td>{item.feature}</td><td>{risk.inputs[item.feature]?.toFixed(3)}</td>
            <td>{item.value >= 0 ? '+' : ''}{item.value.toFixed(3)}</td></tr>)}</tbody></table>
      </details>
    </>}
  </div>;
}

export function Models({ models }: { models: ModelStatus }) {
  const report = models.evaluation;
  return <section className="panel model-status" aria-label="Model availability and evaluation">
    <h2>Learned scoring · {models.status}</h2>
    {models.status === 'unavailable' ? <p role="alert" className="notice">{models.error}</p> : <>
      <p className="muted">Isolation Forest · {models.graphModel} · XGBoost · {models.version}<br />
        Frozen scoring starts {models.availableFrom?.replace('T', ' ')}. Earlier events remain unscored.
        {' '}Review threshold {score(models.reviewThreshold)} / 100 also requires supported structure and model corroboration.</p>
      {report && <details className="evaluation"><summary>Frozen temporal test evaluation</summary>
        <p className="muted">Bounded case-enriched IBM AMLWorld synthetic subset; these are not full-benchmark estimates.</p>
        <table><thead><tr><th>Test metric</th><th>Risk threshold</th><th>With review gate</th></tr></thead><tbody>
          <tr><td>Transactions / labelled positives</td><td colSpan={2}>{report.test.rows} / {report.test.positives}</td></tr>
          <tr><td>Precision</td><td>{fraction(report.test.precision)}</td><td>{fraction(report.testReviewGate.precision)}</td></tr>
          <tr><td>Recall</td><td>{fraction(report.test.recall)}</td><td>{fraction(report.testReviewGate.recall)}</td></tr>
          <tr><td>PR-AUC (average precision)</td><td colSpan={2}>{report.test.prAuc?.toFixed(3) ?? 'Unavailable'}</td></tr>
          <tr><td>False-positive rate</td><td>{fraction(report.test.falsePositiveRate)}</td><td>{fraction(report.testReviewGate.falsePositiveRate)}</td></tr>
          <tr><td>TP / FP / FN / TN</td>{[report.test, report.testReviewGate].map((m, index) => <td key={index}>{m.confusion.tp} / {m.confusion.fp} / {m.confusion.fn} / {m.confusion.tn}</td>)}</tr>
          <tr><td>Brier score (transaction calibration)</td><td colSpan={2}>{report.test.brierScore.toFixed(3)}</td></tr>
        </tbody></table>
        <p className="muted">No predicted positives means precision is unavailable. Case reconstruction is not evaluated here.</p>
        {report.limitations.map(item => <p className="muted" key={item}>{item}</p>)}
      </details>}
    </>}
  </section>;
}
