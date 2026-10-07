import { Term } from './Term'
import type { Snapshot } from '../api'
import type { AccountRecord, CaseRecord, TransactionRecord } from '../types'
import { Risk } from '../Risk'

type Props = {
  activeCase: CaseRecord | null
  account: AccountRecord | null
  accounts: AccountRecord[]
  transactions: TransactionRecord[]
  selectedTransaction: TransactionRecord | null
  snapshot: Snapshot
  onSelectAccount: (account: AccountRecord) => void
}

function Trend({ accountId, snapshot, transactions }: { accountId: string; snapshot: Snapshot; transactions: TransactionRecord[] }) {
  const latest = snapshot.eventTime ? new Date(snapshot.eventTime).getTime() : null
  const since = latest == null ? null : latest - 30 * 24 * 60 * 60 * 1000
  const transactionById = new Map(transactions.map(item => [item.transaction_id, item] as const))
  const points = snapshot.intelligence.decisions
    .filter(decision => {
      const transaction = transactionById.get(decision.transactionId)
      return transaction && (transaction.source_account === accountId || transaction.destination_account === accountId) &&
        (since == null || new Date(decision.timestamp).getTime() >= since)
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(decision => decision.risk.riskScore)
    .filter((score): score is number => score != null)
  if (!points.length) return <p className="inspector-empty">No scored transfers for this account in the observed 30-day window.</p>
  const coords = points.map((value, index) => [index * 180 / Math.max(points.length - 1, 1), 54 - value * 0.48] as const)
  const path = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return <div className="inspector-trend"><svg viewBox="0 0 180 60" role="img" aria-label={`${points.length} observed transaction risk scores over the last 30 days`}>
    <path d="M0 54H180M0 30H180M0 6H180" stroke="rgba(128,151,160,.13)" />
    <path d={path} fill="none" stroke="#74cbb7" strokeWidth="1.8" />
    {coords.length > 0 && <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="3" fill="#f0c66c" />}
  </svg><small>{points.length} observed transaction scores · latest event time as reference</small></div>
}

export default function GraphInspector({ activeCase, account, accounts, transactions, selectedTransaction, snapshot, onSelectAccount }: Props) {
  const topRisk = [...accounts].filter(item => item.risk_score != null).sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0)).slice(0, 6)
  const features = account ? snapshot.intelligence.entities[account.account_id] : undefined
  const risk = account ? snapshot.intelligence.entityRisks[account.account_id] : undefined
  return <aside className="graph-inspector" aria-label="Selected graph entity and highest risk accounts">
    <div className="inspector-section">
      <span className="eyebrow">SELECTED</span>
      {account ? <>
        <strong className="inspector-title">{account.display_name}</strong>
        <span className="inspector-meta">{account.role} · entity risk {risk?.riskScore?.toFixed(1) ?? 'unavailable'}</span>
        {features && <span className="inspector-meta">{features.incomingCount} inbound · {features.outgoingCount} outbound · as of {features.asOf.replace('T', ' ')}</span>}
        <div className="inspector-chart-title">Transfer risk · last 30 days</div>
        <Trend accountId={account.account_id} snapshot={snapshot} transactions={transactions} />
        {risk?.reason && <p className="inspector-reason">{risk.reason}</p>}
      </> : activeCase ? <>
        <strong className="inspector-title">{activeCase.case_id}</strong>
        <span className="inspector-meta">{activeCase.typology} · {activeCase.severity} · risk {activeCase.risk_score?.toFixed(1) ?? 'unavailable'}</span>
        <p className="inspector-reason">{activeCase.summary}</p>
      </> : <p className="inspector-empty">Cases and account details appear as the replay builds observed activity.</p>}
    </div>
    <div className="inspector-section">
      <span className="eyebrow">HIGHEST RISK IN THIS VIEW</span>
      {topRisk.length ? <ul className="inspector-risk-list">{topRisk.map(item => <li key={item.account_id}>
        <button onClick={() => onSelectAccount(item)} title={`Inspect ${item.account_id}`}><span>{item.account_id}</span><b>{item.risk_score?.toFixed(1)}</b></button>
      </li>)}</ul> : <p className="inspector-empty">No entity risk scores are available yet.</p>}
    </div>
    {selectedTransaction && <div className="inspector-section selected-transaction-inspector">
      <span className="eyebrow">SELECTED TRANSFER</span>
      <strong className="inspector-title">{selectedTransaction.transaction_id}</strong>
      <span className="inspector-meta">{selectedTransaction.source_account} → {selectedTransaction.destination_account}</span>
      <span className="inspector-meta">{selectedTransaction.amount} {selectedTransaction.currency} · {selectedTransaction.timestamp.replace('T', ' ')}</span>
      <details><summary>Source fields and model explanation</summary>
        <dl className="inspector-fields">
          <div><dt><Term>Source row</Term></dt><dd>{selectedTransaction.source_row}</dd></div>
          <div><dt>Received</dt><dd>{selectedTransaction.received_amount} {selectedTransaction.receiving_currency}</dd></div>
          <div><dt><Term>Payment format</Term></dt><dd>{selectedTransaction.payment_format}</dd></div>
          <div><dt>Decision reason</dt><dd>{selectedTransaction.reason}</dd></div>
        </dl>
        <Risk risk={snapshot.intelligence.decisions.find(item => item.transactionId === selectedTransaction.transaction_id)?.risk} />
      </details>
    </div>}
    {snapshot.intelligence.enrichment.status === 'ready' && <small className="inspector-context-note">Device and network links are synthetic context; they do not change model risk.</small>}
  </aside>
}
