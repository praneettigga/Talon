import { Term } from './components/Term'
import type { DecisionRisk, EntityRisk, ModelStatus } from './api';

const score = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toFixed(1);
const fraction = (value: number | null) => value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;

export function Risk({ risk }: { risk: DecisionRisk | EntityRisk | undefined }) {
  if (!risk) return <p className="muted">No model decision observed.</p>;
  const contributions = [...risk.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const aggregate = 'aggregation' in risk ? risk : null;
  return <div className="risk-panel" aria-label="Model risk explanation">
    <div className="risk-metrics"><div><span><Term>{aggregate ? 'Entity risk / 100' : 'Transaction risk / 100'}</Term></span><strong>{score(risk.riskScore)}</strong></div>
      <div><span><Term>Behaviour anomaly / 1</Term></span><strong>{risk.behaviourScore?.toFixed(3) ?? 'Unavailable'}</strong></div>
      <div><span><Term>IBM GIN relational score / 1</Term></span><strong>{risk.ginScore?.toFixed(3) ?? 'Unavailable'}</strong></div></div>
    <p className="muted">{risk.status} · {risk.asOf.replace('T', ' ')} · {risk.reason}</p>
    {risk.behaviourScore == null && risk.status === 'scored' && <p className="muted">Insufficient behavioural history or no trained currency baseline. No behavioural anomaly penalty.</p>}
    {aggregate && <p className="muted">Entity aggregate as of {aggregate.riskAsOf.replace('T', ' ')}. {aggregate.aggregation} Highest contributing transaction: {aggregate.riskSourceTransactionId ?? 'none'}.
      {' '}Latest transaction score: {score(aggregate.transactionRiskScore)} / 100.</p>}
    {risk.status === 'scored' && <>
      <p className="muted">Behaviour means unusual compared with historical account behaviour. GIN supplies learned relational evidence. Neither is a fraud probability.</p>
      <details className="contributions"><summary>XGBoost decision contributions ({contributions.length} inputs)</summary>
        <p className="muted">Signed contributions explain the latest transaction's raw XGBoost margin before calibration and entity aggregation.
          {' '}Base {risk.baseMargin?.toFixed(3)} + contributions = margin {risk.rawMargin?.toFixed(3)}.</p>
        <table><thead><tr><th>Input</th><th><Term>Model value</Term></th><th><Term>Margin contribution</Term></th></tr></thead><tbody>
          {contributions.map(item => <tr key={item.feature}><td>{item.feature}</td><td>{risk.inputs[item.feature]?.toFixed(3)}</td>
            <td>{item.value >= 0 ? '+' : ''}{item.value.toFixed(3)}</td></tr>)}</tbody></table>
      </details>
    </>}
  </div>;
}

export function Models({ models, expanded = false }: { models: ModelStatus; expanded?: boolean }) {
  const report = models.evaluation;
  return <section className="panel model-status" aria-label="Model availability and evaluation">
    <div className="evaluation-section-heading"><div><span className="eyebrow">01 / SCORING QUALITY</span><h2><Term>Learned scoring</Term></h2></div><span className={`evaluation-status ${models.status}`}>{models.status}</span></div>
    {models.status === 'unavailable' ? <p role="alert" className="notice">{models.error}</p> : <>
      <p className="muted"><Term>Isolation Forest</Term> · <Term term="IBM GIN relational score / 1">{models.graphModel ?? 'Graph model'}</Term> · <Term>XGBoost</Term> · {models.version}<br />
        Frozen scoring starts {models.availableFrom?.replace('T', ' ')}. Earlier events remain unscored.
        {' '}Review threshold {score(models.reviewThreshold)} / 100 also requires supported structure and model corroboration.</p>
      {report && <><div className="risk-metrics evaluation-highlights">
        <div><span><Term>Risk-threshold precision</Term></span><strong>{fraction(report.test.precision)}</strong></div>
        <div><span><Term>Risk-threshold recall</Term></span><strong>{fraction(report.test.recall)}</strong></div>
        <div><span><Term>PR-AUC</Term></span><strong>{report.test.prAuc?.toFixed(3) ?? 'Unavailable'}</strong></div>
      </div><details className="evaluation" open={expanded}><summary><Term>Frozen temporal test evaluation</Term></summary>
        <p className="muted">Bounded case-enriched IBM AMLWorld synthetic subset; these are not full-benchmark estimates.</p>
        <table><thead><tr><th>Test metric</th><th><Term>Risk threshold</Term></th><th><Term>With review gate</Term></th></tr></thead><tbody>
          <tr><td><Term>Transactions / labelled positives</Term></td><td colSpan={2}>{report.test.rows} / {report.test.positives}</td></tr>
          <tr><td><Term>Precision</Term></td><td>{fraction(report.test.precision)}</td><td>{fraction(report.testReviewGate.precision)}</td></tr>
          <tr><td><Term>Recall</Term></td><td>{fraction(report.test.recall)}</td><td>{fraction(report.testReviewGate.recall)}</td></tr>
          <tr><td><Term>PR-AUC (average precision)</Term></td><td colSpan={2}>{report.test.prAuc?.toFixed(3) ?? 'Unavailable'}</td></tr>
          <tr><td><Term>False-positive rate</Term></td><td>{fraction(report.test.falsePositiveRate)}</td><td>{fraction(report.testReviewGate.falsePositiveRate)}</td></tr>
          <tr><td><Term>TP / FP / FN / TN</Term></td>{[report.test, report.testReviewGate].map((m, index) => <td key={index}>{m.confusion.tp} / {m.confusion.fp} / {m.confusion.fn} / {m.confusion.tn}</td>)}</tr>
          <tr><td><Term>Brier score (transaction calibration)</Term></td><td colSpan={2}>{report.test.brierScore.toFixed(3)}</td></tr>
        </tbody></table>
        <p className="muted">No predicted positives means precision is unavailable. This historical milestone 4 report evaluates transactions; separate case reconstruction results appear below.</p>
        {report.limitations.map(item => <p className="muted" key={item}>{item}</p>)}
      </details></>}
    </>}
  </section>;
}
