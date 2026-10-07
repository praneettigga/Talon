import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

export const explanations: Record<string, string> = {
  'Single-account hold': 'A hypothetical block on outgoing transfers from one account, used to explore disruption without changing real transactions.',
  'Comparison source': 'The starting account for tracing observed transfer routes in both simulated scenarios.',
  'Compare observed-route disruption': 'Compare how hypothetical account holds interrupt paths in the observed transfer network.',
  'Entity risk / 100': 'An account-level aggregate of recent model scores, on a scale up to 100. It prioritizes review and is not a fraud probability.',
  'Transaction risk / 100': 'The model review-priority score for this transfer, on a scale up to 100. It is not a fraud probability.',
  'Precision': 'Of the items flagged by the model, the share that match known positive labels. Higher precision means fewer false alarms.',
  'Recall': 'Of all known positive items, the share the model found. Higher recall means fewer missed positives.',
  'Risk threshold': 'The minimum model score used to flag a transfer for review. A score is a review priority, not a fraud probability.',
  'With review gate': 'Results after requiring supporting transaction structure and model evidence in addition to the risk threshold.',
  'PR-AUC': 'Average precision summarizes the precision–recall tradeoff across score thresholds. Higher is better; the positive-label rate affects the baseline.',
  'False-positive rate': 'The share of known negative transfers incorrectly flagged by the model.',
  'TP / FP / FN / TN': 'True positives: correctly flagged. False positives: false alarms. False negatives: missed positives. True negatives: correctly unflagged.',
  'Brier score (transaction calibration)': 'The average squared difference between calibrated predictions and known labels. Lower means better calibration on this test set.',
  'Transactions / labelled positives': 'The total test transfers and the subset marked positive in the dataset’s reference labels.',
  'Learned scoring': 'Models trained on historical data combine account behaviour and network evidence into a score used to prioritize review.',
  'Case reconstruction': 'An evaluation of how well detected groups of related transfers match the dataset’s known laundering attempts.',
  'Case precision': 'The share of detected cases matched to a supported ground-truth attempt.',
  'Case recall': 'The share of supported ground-truth attempts matched by a detected case.',
  'Jaccard': 'Overlap between a detected case and a known attempt: shared transfers divided by all distinct transfers in either group. One means an exact match.',
  'Typology': 'A category of transaction pattern, such as a chain of transfers or funds spreading across many accounts.',
  'Detected / attempts / matched': 'The number of detected cases, supported known attempts, and successful matches between them.',
  'Frozen temporal test evaluation': 'Performance on a fixed, later time window kept separate from training. The live demo does not change these results.',
  'FROZEN TEST EVALUATION': 'Metrics from a fixed historical test dataset, separate from the current replay or selected transaction.',
  'Behaviour anomaly / 1': 'How unusual this activity is compared with historical account behaviour, on a scale up to one. It is not a fraud probability.',
  'IBM GIN relational score / 1': 'A Graph Isomorphism Network score based on relationships in the transaction network. It is learned evidence, not a fraud probability.',
  'Margin contribution': 'How much an input pushes the XGBoost raw output up or down, before calibration and account aggregation.',
  'Model value': 'The numeric feature value supplied to the scoring model.',
  'Prior one-hour inflow': 'The total incoming amount and number of transfers observed in the preceding hour.',
  'Prior one-hour outflow': 'The total outgoing amount and number of transfers observed in the preceding hour.',
  'Five-minute / one-hour velocity': 'The count of transfers in the preceding five minutes and hour. A rapid increase can indicate a burst of activity.',
  'Fan-in / fan-out degree': 'The number of distinct accounts sending funds in and receiving funds out. Large values can indicate collection or dispersal.',
  'Forwarding ratio': 'Outgoing funds relative to incoming funds in the observation window. High values can indicate rapid onward movement.',
  'Historical amount mean': 'The average transfer amount in the account’s available prior history.',
  'Amount deviation (z-score)': 'How far the amount is from the historical average, measured in standard deviations. Larger absolute values are more unusual.',
  'New counterparty': 'Whether the other account has not previously been observed interacting with this account.',
  'Synthetic infrastructure context': 'Artificial device and network relationships added for demonstration. They are not observed transaction evidence.',
  'Source row': 'The original dataset row associated with this record, used to trace displayed evidence back to its source.',
  'Payment format': 'The payment channel or method recorded in the source data, such as wire or cheque.',
  'Risk': 'A score used to prioritize review. Higher values indicate stronger risk signals, not proof of fraud.',
  'Account risk': 'An account-level risk summary based on available scores. Imported data uses a supplied account score or the highest supplied transaction score.',
  'Fraud type': 'A category supplied by the imported dataset. It is a source label, not an independently verified finding.',
  'Dev.': 'The number of devices associated with this account in the imported data.',
  'Tx': 'The number of transactions associated with this account.',
  'TX_RISK': 'The transaction risk value supplied by the imported dataset. Missing scores remain unavailable.',
  'Risk over time': 'Supplied transaction risk scores shown in imported row order; rows are not necessarily evenly spaced in time.',
  'Fraud node': 'A graph grouping for accounts sharing a fraud-type label in the imported data.',
  'Unlinked': 'An account with no connections available in the current graph data.',
  'Interrupted transfers': 'Observed transfers blocked in the hypothetical hold scenario. No real payment is stopped.',
  'Accounts no longer reachable': 'Accounts with no remaining observed, time-respecting route from the simulation’s source after the hypothetical hold.',
  'Remaining route witnesses': 'Example observed transfer paths that still connect a source to a destination after the simulated hold.',
  'Directly touched accounts': 'Accounts directly involved in transfers affected by the hypothetical hold.',
  'Observed route details': 'The transfer paths present in the replay snapshot used for this hypothetical simulation.',
  'REPLAY MODE': 'Historical transfers are revealed in sequence to simulate a live stream. This is not a live banking feed.',
  'OBSERVED REPLAY': 'Only events already revealed at the current replay position are included.',
  'EVENTS REPLAYED': 'The number of historical events processed so far in this replay.',
  'EVENT TIME': 'The timestamp of the historical event, rather than the current wall-clock time.',
  'RISK EXPLANATION': 'The model inputs and evidence behind a review-priority score. They do not establish fraud.',
  'Case timeline': 'The sequence of findings linked to a case as activity is observed.',
  'Isolation Forest': 'A model that identifies activity that differs from historical patterns by measuring how easily it can be isolated.',
  'XGBoost': 'A model combining many decision trees to produce a score from transaction and network features.',
}
Object.assign(explanations, {
  'Risk-threshold precision': explanations.Precision,
  'Risk-threshold recall': explanations.Recall,
  'PR-AUC (average precision)': explanations['PR-AUC'],
  'Mean matched Jaccard': 'The average transfer overlap across matched case–attempt pairs. Unmatched cases are not included. ' + explanations.Jaccard,
  'risk score': explanations.Risk,
  'source row': explanations['Source row'],
  'payment format': explanations['Payment format'],
  'severity': 'The urgency assigned to a case from its structural evidence and risk signals. It is not a finding of guilt.',
})

export function Term({ children, term = children }: { children: string; term?: string }) {
  const description = explanations[term]
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelClose = () => clearTimeout(closeTimer.current)
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setPosition(null), 150) }
  function show() {
    cancelClose()
    const rect = button.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)), top: rect.bottom + 8, above: rect.bottom > window.innerHeight - 180 })
  }
  useEffect(() => {
    if (!position) return
    const close = () => setPosition(null)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', key, true) }
  }, [position])
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  if (!description) return <>{children}</>
  return <span className="explained-term">{children}<button ref={button} type="button" className="term-info" aria-label={`About ${children}`} aria-describedby={position ? id : undefined}
    onMouseEnter={show} onMouseLeave={closeSoon} onFocus={show} onBlur={() => setPosition(null)}
    onClick={event => { event.preventDefault(); event.stopPropagation(); show() }}><Info size={13} aria-hidden="true" /></button>
    {position && createPortal(<span id={id} role="tooltip" className="term-tooltip" onMouseEnter={cancelClose} onMouseLeave={closeSoon}
      style={{ left: position.left, top: position.above ? undefined : position.top, bottom: position.above ? window.innerHeight - position.top + 32 : undefined }}><strong>{children}</strong>{description}</span>, document.body)}
  </span>
}
