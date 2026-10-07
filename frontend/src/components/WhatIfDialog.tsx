import { useMemo, useState } from 'react'
import { ArrowDownRight, Check, GitCompareArrows, X } from 'lucide-react'
import type { ReplayStatus, SimulationResult, SimulationScenario } from '../api'
import { simulateHolds } from '../api'
import type { AccountRecord, CaseRecord, TransactionRecord } from '../types'

type Props = {
  caseRecord: CaseRecord
  accounts: AccountRecord[]
  transactions: TransactionRecord[]
  cursor: number
  replayStatus: ReplayStatus
  onPreview: (preview: { heldAccountIds: string[]; interruptedTransferIds: string[] } | null) => void
  onClose: () => void
}

function ScenarioSummary({ scenario }: { scenario: SimulationScenario }) {
  return <div className="simulation-links">
    <div>Interrupted transfers <b>{scenario.interruptedTransferCount}</b></div>
    <div>Accounts no longer reachable <b>{scenario.noLongerReachableAccountIds.length}</b></div>
    <div>Remaining route witnesses <b>{scenario.remainingRouteCount}{scenario.routesTruncated ? '+' : ''}</b></div>
    <div>Directly touched accounts <b>{scenario.directlyTouchedAccountIds.length}</b></div>
    <details><summary>Observed route details</summary>
      <p>Held: {scenario.heldAccountIds.join(', ') || 'None'}</p>
      <p>Interrupted: {scenario.interruptedTransferIds.join(', ') || 'None'}</p>
      <p>No longer reachable: {scenario.noLongerReachableAccountIds.join(', ') || 'None'}</p>
      {scenario.remainingRoutes.slice(0, 10).map(route => <p key={route.destination}>
        {route.accountIds.join(' → ')}<br /><small>Transfers: {route.transactionIds.join(', ')}</small>
      </p>)}
    </details>
  </div>
}

export default function WhatIfDialog({ caseRecord, accounts, transactions, cursor, replayStatus, onPreview, onClose }: Props) {
  const caseAccounts = accounts.filter(account => account.case_ids.includes(caseRecord.case_id))
  const caseTransactions = transactions.filter(transaction => transaction.case_id === caseRecord.case_id)
  const candidates = useMemo(() => {
    const outgoing = new Map<string, number>()
    for (const event of caseTransactions) outgoing.set(event.source_account, (outgoing.get(event.source_account) ?? 0) + 1)
    return caseAccounts.filter(account => outgoing.has(account.account_id)).sort((a, b) =>
      Number(a.role === 'counterparty') - Number(b.role === 'counterparty') ||
      (outgoing.get(b.account_id)! - outgoing.get(a.account_id)!) || a.account_id.localeCompare(b.account_id))
  }, [caseAccounts, caseTransactions])
  const [primary, setPrimary] = useState(candidates[0]?.account_id ?? '')
  const [additional, setAdditional] = useState<string[] | null>(null)
  const [source, setSource] = useState('')
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const validPrimary = candidates.some(account => account.account_id === primary) ? primary : candidates[0]?.account_id ?? ''
  const selectedAdditional = additional ?? candidates.filter(account => account.account_id !== validPrimary).slice(0, 1).map(account => account.account_id)
  const group = [validPrimary, ...selectedAdditional.filter(id => id !== validPrimary && candidates.some(account => account.account_id === id))].filter(Boolean)
  const stale = result !== null && result.snapshotCursor !== cursor

  function clearResult() {
    setResult(null)
    setError('')
    onPreview(null)
  }

  async function compare() {
    setBusy(true)
    setError('')
    clearResult()
    try {
      const next = await simulateHolds({
        caseId: caseRecord.case_id,
        heldAccountIds: [validPrimary],
        compareHeldAccountIds: group,
        sourceAccountIds: source ? [source] : undefined,
        expectedCursor: cursor,
      })
      setResult(next)
      onPreview({ heldAccountIds: next.scenarios[0].heldAccountIds, interruptedTransferIds: next.scenarios[0].interruptedTransferIds })
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="whatif-dialog" role="dialog" aria-modal="true" aria-labelledby="whatif-title">
        <div className="dialog-head"><span className="icon-tile amber"><GitCompareArrows size={17} /></span><div><span className="eyebrow">OBSERVED ROUTE SIMULATION</span><h2 id="whatif-title">Compare a hold set</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div>
        <p className="dialog-intro">Compare holds against observed transfers in <b>{caseRecord.case_id}</b>. This does not execute a hold.</p>
        <div className="whatif-options">
          {candidates.map(account => <label key={account.account_id} className={`whatif-account ${group.includes(account.account_id) ? 'whatif-account-selected' : ''}`}>
            <input type="checkbox" checked={group.includes(account.account_id)} disabled={busy || account.account_id === validPrimary || (group.length >= 32 && !group.includes(account.account_id))}
              onChange={event => setAdditional(event.target.checked ? [...selectedAdditional, account.account_id] : selectedAdditional.filter(id => id !== account.account_id))} />
            <span className="checkmark"><Check size={12} /></span><span className="whatif-name"><strong>{account.display_name}</strong><small>{account.account_id} · {account.role}</small></span>
            <span className="mini-risk">{account.risk_score?.toFixed(0) ?? '—'}</span>
          </label>)}
        </div>
        <div className="hold-controls">
          <label>Single-account hold <select aria-label="Single-account hold" value={validPrimary} disabled={busy} onChange={event => { setPrimary(event.target.value); setAdditional(candidates.filter(item => item.account_id !== event.target.value).slice(0, 1).map(item => item.account_id)); clearResult() }}>
            {candidates.map(account => <option key={account.account_id} value={account.account_id}>{account.account_id} · {account.role}</option>)}
          </select></label>
          <label>Comparison source <select aria-label="Comparison source" value={source} disabled={busy} onChange={event => { setSource(event.target.value); clearResult() }}>
            <option value="">Automatic observed sources</option>{candidates.map(account => <option key={account.account_id} value={account.account_id}>{account.account_id}</option>)}
          </select></label>
        </div>
        <div className="simulation-result">
          <div className="result-stat"><span>Selected accounts</span><strong>{group.length}</strong></div>
          <div className="result-stat"><span>Observed transfers</span><strong>{caseTransactions.length}</strong></div>
          {result ? <>
            {stale && <p role="status" className="notice">The replay advanced after this comparison. Run it again for the current snapshot.</p>}
            <p className="muted">Snapshot {result.snapshotCursor} · {result.observedAt.replace('T', ' ')} · {result.label}</p>
            {result.scenarios.map(scenario => <details key={scenario.name} open><summary>{scenario.name === 'initial' ? 'Single-account hold' : 'Group hold'}</summary><ScenarioSummary scenario={scenario} /></details>)}
            {result.comparison && <p className="muted">Group hold adds {result.comparison.additionalInterruptedTransferIds.length} interrupted transfers and {result.comparison.additionalUnreachableAccountIds.length} unreachable accounts.</p>}
            <p className="muted">{result.method}</p>
          </> : <div className="simulation-links">{caseTransactions.length ? caseTransactions.slice(0, 8).map(transaction => <div key={transaction.transaction_id}><ArrowDownRight size={13} /><span>{transaction.source_account} → {transaction.destination_account}</span><b>{transaction.amount} {transaction.currency}</b></div>) : <p>No observed transfers in this case yet.</p>}</div>}
        </div>
        {error && <p role="alert" className="notice">{error}</p>}
        <div className="compare-action"><button disabled={busy || replayStatus === 'running' || !validPrimary || group.length < 2} onClick={compare}>{busy ? 'Comparing…' : 'Compare holds'}</button>
          <span className="muted">{replayStatus === 'running' ? 'Pause replay before comparing a stable snapshot.' : group.length < 2 ? 'Select at least two accounts for the group comparison.' : `Snapshot cursor ${cursor}.`}</span></div>
        <div className="simulation-note"><span className="tiny-status" /> Observed-graph simulation only. No hold or payment action is executed.</div>
      </section>
    </div>
  )
}
