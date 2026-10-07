import { Term } from './Term'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import SpriteText from 'three-spritetext'
import Chart from 'chart.js/auto'
import { Activity, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Database, FileUp, Search, Shield, Upload, X } from 'lucide-react'
import type { ImportedAccount, ImportedDataset, ImportedTransaction } from '../importedData'
import { accountReasons } from '../importedData'

type Props = { dataset: ImportedDataset; onExit: () => void; onImport: () => void; importError: string; onDismissImportError: () => void }

type NodeKind = 'account' | 'fraud' | 'device' | 'merchant' | 'transaction'
type GraphNode = {
  id: string
  name: string
  kind: NodeKind
  accountId?: string
  account?: ImportedAccount
  transaction?: ImportedTransaction
  risk?: number | null
  linked?: boolean
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
}
type GraphLink = { source: string; target: string; kind: 'fraud' | 'transfer' | 'branch'; risk?: number | null }

const detectionDuration = 10_000
const pipeline = [
  { number: '01', label: 'Local file ingest', start: 0, end: 900 },
  { number: '02', label: 'Field and transaction extraction', start: 900, end: 1_800 },
  { number: '03', label: 'Risk signal evaluation', start: 1_800, end: 5_000 },
  { number: '04', label: 'Relationship and device linking', start: 1_800, end: 5_000 },
  { number: '05', label: 'Account risk aggregation', start: 5_000, end: 6_200 },
  { number: '06', label: 'Entity profiles', start: 6_200, end: 7_100 },
  { number: '07', label: 'Network correlation', start: 7_100, end: 8_000 },
  { number: '08', label: 'Detection summary', start: 8_000, end: 9_000 },
  { number: '09', label: 'Local results', start: 9_000, end: 10_000 },
]
const graphChecks = ['Linked accounts', 'Counterparties', 'Fan-out', 'Circular flow', 'Shared devices', 'Network branches']

export function DetectionProgress({ dataset, onExit, onComplete }: { dataset: ImportedDataset; onExit: () => void; onComplete: () => void }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const startedAt = performance.now()
    const timer = window.setInterval(() => {
      const next = Math.min(detectionDuration, performance.now() - startedAt)
      setElapsed(next)
      if (next >= detectionDuration) {
        window.clearInterval(timer)
        onComplete()
      }
    }, 60)
    return () => window.clearInterval(timer)
  }, [onComplete])

  const percent = Math.floor((elapsed / detectionDuration) * 100)
  const graphElapsed = Math.max(0, elapsed - 1_800)
  return <main className="detection-screen" aria-label="Dataset detection progress">
    <div className="detection-topbar"><div className="brand-lockup"><div className="brand-mark"><Shield size={18} /><span /></div><div><b>TALON</b><small>NETWORK INTELLIGENCE</small></div></div><button className="button-quiet" onClick={onExit}><X size={14} /> Cancel analysis</button></div>
    <section className="detection-content">
      <div className="detection-kicker"><span className="detection-pulse" /> IMPORT ANALYSIS <span>·</span> {dataset.accounts.length.toLocaleString()} ACCOUNTS</div>
      <h1>Building your network</h1>
      <p className="detection-description">Running the detection pipeline against <strong>{dataset.name}</strong></p>
      <div className="detection-progress-head"><span>DETECTION PROGRESS</span><strong>{percent}<small>%</small></strong></div>
      <div className="detection-progress-track"><div style={{ width: `${percent}%` }} /></div>
      <div className="detection-step-list">
        {pipeline.slice(0, 2).map(step => <ProgressStep key={step.number} step={step} elapsed={elapsed} />)}
        <div className="parallel-heading"><span>PARALLEL ANALYSIS TRACKS</span><i /></div>
        <div className="parallel-tracks">
          {pipeline.slice(2, 4).map(step => <ProgressStep key={step.number} step={step} elapsed={elapsed} graphElapsed={graphElapsed} />)}
        </div>
        {pipeline.slice(4).map(step => <ProgressStep key={step.number} step={step} elapsed={elapsed} />)}
      </div>
      <div className="detection-footnote"><Database size={13} /> {dataset.transactionCount.toLocaleString()} transaction rows · local import analysis</div>
    </section>
  </main>
}

function ProgressStep({ step, elapsed, graphElapsed }: { step: (typeof pipeline)[number]; elapsed: number; graphElapsed?: number }) {
  const complete = elapsed >= step.end
  const active = elapsed >= step.start && !complete
  const isGraph = step.number === '04'
  const trackElapsed = graphElapsed ?? elapsed
  const checkIndex = Math.min(graphChecks.length, Math.floor(Math.max(0, trackElapsed - 200) / 480))
  const outputChecks = Math.min(3, Math.floor(Math.max(0, elapsed - step.start) / 270))
  return <div className={`detection-step ${complete ? 'is-complete' : active ? 'is-active' : 'is-upcoming'}`}>
    <span className="step-mark">{complete ? <Check size={13} /> : active ? <i className="step-spinner" /> : step.number}</span>
    <div className="step-copy"><div className="step-title"><span>{step.number}</span><strong>{step.label}</strong>{step.number === '03' && active && <small>RUNNING</small>}{complete && <small>COMPLETE</small>}</div>
      {isGraph && (active || complete) && <div className="graph-intelligence-checks">{graphChecks.map((check, index) => <span key={check} className={complete || index < checkIndex ? 'checked' : active && index === checkIndex ? 'checking' : ''}>{complete || index < checkIndex ? <Check size={11} /> : active && index === checkIndex ? <i className="step-spinner" /> : <i />}{check}</span>)}</div>}
      {step.number === '09' && (active || complete) && <div className="graph-intelligence-checks">{['Evidence', 'Timeline', 'Intervention what-if'].map((output, index) => <span key={output} className={complete || index < outputChecks ? 'checked' : active && index === outputChecks ? 'checking' : ''}>{complete || index < outputChecks ? <Check size={11} /> : active && index === outputChecks ? <i className="step-spinner" /> : <i />}{output}</span>)}</div>}
    </div>
  </div>
}

function riskTone(score: number | null) {
  if (score == null) return 'unknown'
  return score >= 85 ? 'critical' : score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low'
}

function accountTransactionCount(account: ImportedAccount) {
  return Math.max(account.transactions.length, account.reportedTransactions ?? 0)
}

function accountDeviceCount(account: ImportedAccount) {
  return Math.max(account.devices.length, account.reportedDevices ?? 0)
}

function accountMerchantCount(account: ImportedAccount) {
  return Math.max(account.merchants.length, account.reportedMerchants ?? 0)
}

function RiskBadge({ score }: { score: number | null }) {
  return <span className={`import-risk import-risk-${riskTone(score)}`} title={score == null ? 'No risk score supplied in the imported data' : 'Supplied or maximum observed transaction risk'}><i />{score?.toFixed(1) ?? '—'}</span>
}

function overviewGraph(accounts: ImportedAccount[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = accounts.map((account, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5))
    const radius = 100 + 9 * Math.sqrt(index)
    const vertical = 1 - (index / Math.max(accounts.length, 1)) * 2
    const ring = Math.sqrt(Math.max(0, 1 - vertical * vertical))
    return {
      id: `account:${account.id}`, name: account.id, kind: 'account', accountId: account.id, account,
      risk: account.risk, linked: account.linked,
      x: Math.cos(angle) * ring * radius, y: vertical * radius, z: Math.sin(angle) * ring * radius,
    }
  })
  const links: GraphLink[] = []
  const visibleIds = new Set(accounts.map(account => account.id))
  const fraudTypes = [...new Set(accounts.map(account => account.fraudType).filter(type => type !== 'Unlabelled' && type !== 'Unlinked'))]
  fraudTypes.forEach((name, index) => {
    const id = `fraud:${name}`
    const angle = index * (Math.PI * 2 / Math.max(1, fraudTypes.length))
    nodes.push({ id, name: `Fraud · ${name}`, kind: 'fraud', x: Math.cos(angle) * 26, y: 0, z: Math.sin(angle) * 26 })
    accounts.filter(account => account.fraudType === name).forEach(account => links.push({ source: `account:${account.id}`, target: id, kind: 'fraud', risk: account.risk }))
  })
  for (const account of accounts) {
    for (const transaction of account.transactions) {
      if (transaction.direction === 'outgoing' && visibleIds.has(transaction.counterparty)) {
        links.push({ source: `account:${account.id}`, target: `account:${transaction.counterparty}`, kind: 'transfer', risk: transaction.txRisk ?? account.risk })
      }
    }
  }
  return { nodes, links }
}

function accountTree(account: ImportedAccount): { nodes: GraphNode[]; links: GraphLink[] } {
  const rootId = `account:${account.id}`
  const nodes: GraphNode[] = [{ id: rootId, name: account.id, kind: 'account', accountId: account.id, account, risk: account.risk, linked: account.linked, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0 }]
  const links: GraphLink[] = []
  const branches: Array<{ kind: 'device' | 'merchant'; label: string; value: string; transactions: ImportedTransaction[] }> = []

  for (const kind of ['device', 'merchant'] as const) {
    const grouped = new Map<string, ImportedTransaction[]>()
    for (const transaction of account.transactions) {
      const value = kind === 'device' ? transaction.device : transaction.merchant
      if (!value) continue
      const group = grouped.get(value) ?? []
      group.push(transaction)
      grouped.set(value, group)
    }
    const importedValues = kind === 'device' ? account.devices : account.merchants
    importedValues.forEach(value => { if (!grouped.has(value)) grouped.set(value, []) })
    grouped.forEach((transactions, value) => branches.push({ kind, label: value, value, transactions }))
  }

  branches.forEach((branch, index) => {
    const angle = (index / Math.max(1, branches.length)) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(angle) * 140
    const y = Math.sin(angle) * 100
    const z = (index % 3 - 1) * 30
    const branchId = `${branch.kind}:${branch.value}`
    nodes.push({ id: branchId, name: branch.label, kind: branch.kind, x, y, z, fx: x, fy: y, fz: z })
    links.push({ source: rootId, target: branchId, kind: 'branch' })
    branch.transactions.forEach((transaction, transactionIndex) => {
      const spread = transactionIndex - (branch.transactions.length - 1) / 2
      const txId = `${branchId}:tx:${transaction.id}:${transactionIndex}`
      const txX = x + Math.cos(angle) * 95 - Math.sin(angle) * spread * 22
      const txY = y + Math.sin(angle) * 95 + Math.cos(angle) * spread * 22
      const txZ = z + spread * 16
      nodes.push({ id: txId, name: transaction.id, kind: 'transaction', transaction, risk: transaction.txRisk ?? account.risk, x: txX, y: txY, z: txZ, fx: txX, fy: txY, fz: txZ })
      links.push({ source: branchId, target: txId, kind: 'branch', risk: transaction.txRisk ?? account.risk })
    })
  })

  const withoutBranch = account.transactions.filter(transaction => !transaction.device && !transaction.merchant)
  withoutBranch.forEach((transaction, index) => {
    const angle = index * 0.42
    const id = `activity:tx:${transaction.id}:${index}`
    const x = Math.cos(angle) * 95
    const y = Math.sin(angle) * 95
    const z = (index - withoutBranch.length / 2) * 17
    nodes.push({ id, name: transaction.id, kind: 'transaction', transaction, risk: transaction.txRisk ?? account.risk, x, y, z, fx: x, fy: y, fz: z })
    links.push({ source: rootId, target: id, kind: 'branch', risk: transaction.txRisk ?? account.risk })
  })
  return { nodes, links }
}

function nodeColor(node: GraphNode, selectedAccountId: string) {
  if (node.kind === 'fraud') return '#68b9ff'
  if (node.kind === 'account') {
    if (!node.linked) return '#697580'
    if (node.accountId === selectedAccountId) return '#f1cf80'
    if ((node.risk ?? 0) >= 85) return '#ff728b'
    if ((node.risk ?? 0) >= 70) return '#ff9a73'
    if ((node.risk ?? 0) >= 45) return '#e8c56e'
    return '#57c8b0'
  }
  if (node.kind === 'device') return '#d7a55d'
  if (node.kind === 'merchant') return '#9c8be9'
  return '#b5c3cc'
}

function graphLabel(node: GraphNode) {
  if (node.kind === 'account') return node.accountId ?? node.name
  if (node.kind === 'transaction') return `${node.name}${node.transaction?.amount == null ? '' : ` · ${node.transaction.amount.toLocaleString()}`}`
  return node.name
}

function NetworkCanvas({ accounts, expanded, selectedAccountId, onAccount, linking }: {
  accounts: ImportedAccount[]; expanded: ImportedAccount | null; selectedAccountId: string; onAccount: (accountId: string) => void; linking: boolean
}) {
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const resumeTimer = useRef<number | null>(null)
  const [fraudName, setFraudName] = useState('')
  const graphData = useMemo(() => expanded ? accountTree(expanded) : overviewGraph(accounts), [accounts, expanded])

  useEffect(() => {
    const graph = graphRef.current
    const canvas = graph?.renderer().domElement
    if (!graph || !canvas) return
    const controls = graph.controls() as { autoRotate?: boolean; autoRotateSpeed?: number }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.autoRotate = !reducedMotion
    controls.autoRotateSpeed = 0.22
    let pointerActive = false
    const stopRotate = () => {
      controls.autoRotate = false
      if (resumeTimer.current != null) window.clearTimeout(resumeTimer.current)
      resumeTimer.current = null
    }
    const resumeRotate = () => {
      if (resumeTimer.current != null) window.clearTimeout(resumeTimer.current)
      resumeTimer.current = window.setTimeout(() => { controls.autoRotate = !reducedMotion }, 1_350)
    }
    const pointerDown = () => { pointerActive = true; stopRotate() }
    const pointerUp = () => { pointerActive = false; resumeRotate() }
    const pointerLeave = () => { if (!pointerActive) resumeRotate() }
    const wheel = () => { stopRotate(); resumeRotate() }
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointerleave', pointerLeave)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerUp)
    canvas.addEventListener('wheel', wheel, { passive: true })
    return () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointerleave', pointerLeave)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerUp)
      canvas.removeEventListener('wheel', wheel)
      if (resumeTimer.current != null) window.clearTimeout(resumeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!fraudName) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFraudName('') }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [fraudName])

  useEffect(() => {
    if (expanded) {
      graphRef.current?.cameraPosition({ x: 0, y: 50, z: 285 }, { x: 0, y: 0, z: 0 }, 950)
    } else graphRef.current?.zoomToFit(850, 70)
  }, [expanded])

  return <div className="import-network-canvas">
    <ForceGraph3D<GraphNode, GraphLink>
      ref={graphRef}
      graphData={graphData}
      backgroundColor="#080d14"
      showNavInfo={false}
      nodeLabel={graphLabel}
      nodeColor={node => nodeColor(node, selectedAccountId)}
      nodeVal={node => node.kind === 'fraud' ? 24 : node.kind === 'account' ? 5 + (node.risk ?? 0) / 20 : node.kind === 'transaction' ? 1.9 : 3.8}
      nodeOpacity={0.96}
      nodeThreeObject={(node: GraphNode) => {
        const sprite = new SpriteText(graphLabel(node), node.kind === 'fraud' ? 8 : node.kind === 'account' ? 5 : 3.2, '#dce8ef')
        sprite.color = node.kind === 'fraud' ? '#91ccff' : '#c5d0d8'
        sprite.backgroundColor = node.kind === 'fraud' ? 'rgba(52, 125, 193, .18)' : node.kind === 'account' && node.linked ? 'rgba(28, 99, 87, .18)' : 'rgba(5, 10, 15, .78)'
        sprite.padding = node.kind === 'account' ? 2 : 1
        sprite.borderRadius = 2
        sprite.position.y = node.kind === 'account' || node.kind === 'fraud' ? 8 : 4
        return sprite as never
      }}
      nodeThreeObjectExtend
      linkColor={link => link.kind === 'fraud' ? 'rgba(93, 173, 245, .54)' : link.kind === 'transfer' ? 'rgba(76, 207, 180, .34)' : 'rgba(142, 162, 183, .34)'}
      linkOpacity={0.75}
      linkWidth={link => link.kind === 'fraud' ? 1.25 : 0.8}
      linkCurvature={link => link.kind === 'transfer' ? 0.16 : 0.12}
      linkDirectionalParticles={link => linking && (link.kind === 'fraud' || link.kind === 'transfer') ? 2 : 0}
      linkDirectionalParticleWidth={1.8}
      linkDirectionalParticleSpeed={0.006}
      linkDirectionalParticleColor={link => link.kind === 'fraud' ? '#73baff' : '#8bffe1'}
      cooldownTicks={expanded ? 2 : 115}
      warmupTicks={expanded ? 0 : 24}
      enableNodeDrag
      enableNavigationControls
      onNodeClick={node => {
        if (node.kind === 'account' && node.accountId) onAccount(node.accountId)
        if (node.kind === 'fraud') setFraudName(node.name)
      }}
    />
    <div className="network-controls"><span className="graph-rotate-dot" /> IDLE ORBIT <i /> DRAG TO ROTATE <i /> RIGHT-DRAG TO PAN <i /> SCROLL TO ZOOM <button onClick={() => graphRef.current?.zoomToFit(700, 60)}>Fit</button></div>
    {fraudName && <div className="import-fraud-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFraudName('') }}>
      <section className="import-fraud-card" role="dialog" aria-modal="true" aria-label="Fraud network details"><button className="icon-button" onClick={() => setFraudName('')} aria-label="Close fraud details"><X size={15} /></button><span className="eyebrow">FRAUD NETWORK</span><h3>{fraudName.replace(/^Fraud · /, '')}</h3><p>{graphData.links.filter(link => link.kind === 'fraud' && link.target === `fraud:${fraudName.replace(/^Fraud · /, '')}`).length} accounts in this imported label group.</p><small>Click outside this card to return to the graph.</small></section>
    </div>}
  </div>
}

function RiskTrend({ account }: { account: ImportedAccount }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const element = canvas.current
    const chartContext = element?.getContext('2d')
    if (!element || !chartContext) { setUnavailable(true); return }
    setUnavailable(false)
    const chart = new Chart(chartContext, {
      type: 'line',
      data: {
        labels: account.transactions.map((transaction, index) => transaction.timestamp || `Row ${index + 1}`),
        datasets: [{
          label: 'Transaction risk',
          data: account.transactions.map(transaction => transaction.txRisk),
          borderColor: '#63c9bd',
          backgroundColor: 'rgba(64, 181, 179, .16)',
          pointBackgroundColor: '#9ce8df',
          pointBorderColor: '#63c9bd',
          pointRadius: 2,
          borderWidth: 2,
          fill: true,
          tension: 0.36,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#17232d', titleColor: '#e6eff2', bodyColor: '#a5b5bd', borderColor: 'rgba(158,180,197,.16)', borderWidth: 1 } },
        scales: {
          x: { grid: { color: 'rgba(154,177,195,.06)' }, ticks: { color: '#6c7b88', maxTicksLimit: 5, maxRotation: 0, font: { size: 9 } } },
          y: { min: 0, max: 100, grid: { color: 'rgba(154,177,195,.08)' }, ticks: { color: '#6c7b88', stepSize: 25, font: { size: 9 } } },
        },
      },
    })
    return () => chart.destroy()
  }, [account])

  const hasRisk = account.transactions.some(transaction => transaction.txRisk != null)
  return <div className="risk-chart-wrap">{!hasRisk && <div className="chart-empty">No tx_risk values were supplied for this account.</div>}{unavailable && hasRisk && <div className="chart-empty">Risk trend unavailable while Chart.js loads.</div>}<canvas ref={canvas} aria-label="Transaction risk over imported row order" />{hasRisk && <div className="chart-row-note">ROW ORDER <span>·</span> {account.transactions.length} transactions</div>}</div>
}

export default function ImportedDatasetWorkspace({ dataset, onExit, onImport, importError, onDismissImportError }: Props) {
  const [ready] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'flagged' | 'linked' | 'unlinked'>('all')
  const [minimumRisk, setMinimumRisk] = useState(0)
  const [sortDescending, setSortDescending] = useState(true)
  const [selectedAccountId, setSelectedAccountId] = useState(dataset.accounts[0]?.id ?? '')
  const [expandedAccountId, setExpandedAccountId] = useState('')
  const [linking, setLinking] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const selectedAccount = dataset.accounts.find(account => account.id === selectedAccountId) ?? null

  useEffect(() => {
    if (!ready) return
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !['f', 'k'].includes(event.key.toLowerCase())) return
      event.preventDefault()
      searchInput.current?.focus()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [ready])

  const visibleAccounts = useMemo(() => {
    const search = query.trim().toLowerCase()
    return dataset.accounts.filter(account => {
      const searchable = `${account.id} ${account.fraudType} ${account.transactions.map(item => `${item.id} ${item.device} ${item.merchant}`).join(' ')}`.toLowerCase()
      if (search && !searchable.includes(search)) return false
      if (minimumRisk > 0 && (account.risk == null || account.risk < minimumRisk)) return false
      if (filter === 'flagged' && (account.risk == null || account.risk < 70)) return false
      if (filter === 'linked' && !account.linked) return false
      if (filter === 'unlinked' && account.linked) return false
      return true
    }).sort((a, b) => sortDescending ? (b.risk ?? -1) - (a.risk ?? -1) || a.id.localeCompare(b.id) : (a.risk ?? -1) - (b.risk ?? -1) || a.id.localeCompare(b.id))
  }, [dataset.accounts, filter, minimumRisk, query, sortDescending])

  const expandedAccount = visibleAccounts.find(account => account.id === expandedAccountId) ?? null
  const importedTransactionAmount = selectedAccount?.transactions.reduce((total, transaction) => total + (transaction.amount ?? 0), 0) ?? 0
  const totalAmount = selectedAccount?.transactions.some(transaction => transaction.amount != null) ? importedTransactionAmount : selectedAccount?.reportedAmount ?? 0

  useEffect(() => {
    if (ready) {
      setLinking(true)
      const timer = window.setTimeout(() => setLinking(false), 2_100)
      return () => window.clearTimeout(timer)
    }
  }, [ready])

  const selectAccount = (accountId: string) => {
    setSelectedAccountId(accountId)
    setExpandedAccountId(accountId)
  }

  return <main className="import-app-shell">
    <header className="topbar import-topbar">
      <div className="brand-lockup"><div className="brand-mark"><Shield size={18} /><span /></div><div><b>TALON</b><small>NETWORK INTELLIGENCE</small></div></div>
      <div className="topbar-divider" /><div className="workspace-crumb"><span className="crumb-muted">IMPORTED DATASET</span><ChevronRight size={13} /><span>{dataset.name}</span></div>
      <div className="topbar-right"><button className="button-quiet import-return" onClick={onExit}><ArrowLeft size={14} /> Live workspace</button><button className="import-dataset-trigger" onClick={onImport}><Upload size={13} /> Import another</button></div>
    </header>
    {importError && <div className="import-error-banner" role="alert"><span>{importError}</span><button onClick={onDismissImportError} aria-label="Dismiss import error"><X size={13} /></button></div>}
    <div className="import-workspace-heading"><div><span className="eyebrow">LOCAL ANALYSIS RESULTS</span><h1>Dataset network</h1><p>{dataset.name} <span>·</span> {dataset.accounts.length.toLocaleString()} accounts <span>·</span> {dataset.transactionCount.toLocaleString()} transaction rows</p></div><div className="import-detection-status"><span className="detection-pulse" /> Analysis complete</div></div>
    <div className="import-layout">
      <aside className="import-side-panel dataset-panel" aria-label="Imported dataset accounts">
        <div className="import-panel-head"><div><span className="eyebrow">DATASET</span><h2>Accounts</h2></div><span className="import-account-count">{visibleAccounts.length} / {dataset.accounts.length}</span></div>
        <label className="import-search"><Search size={13} /><input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search accounts, devices…" /><kbd>⌘ K</kbd></label>
        <div className="import-filter-row"><label>Show<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All accounts</option><option value="flagged">Flagged · risk 70+</option><option value="linked">Linked</option><option value="unlinked">Unlinked</option></select></label><label><Term>Risk</Term><select aria-label="Minimum account risk" value={minimumRisk} onChange={event => setMinimumRisk(Number(event.target.value))}><option value={0}>Any</option><option value={45}>45+</option><option value={70}>70+</option><option value={85}>85+</option></select></label></div>
        <div className="import-table-scroll"><table className="import-account-table"><thead><tr><th><button onClick={() => setSortDescending(value => !value)}>Account {sortDescending ? <ArrowDown size={10} /> : <ArrowUp size={10} />}</button></th><th><Term>Fraud type</Term></th><th><Term>Risk</Term></th><th><Term>Dev.</Term></th><th><Term>Tx</Term></th></tr></thead><tbody>
          {visibleAccounts.map(account => <tr key={account.id} className={account.id === selectedAccountId ? 'selected' : ''} onClick={() => selectAccount(account.id)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectAccount(account.id) }}>
            <td title={account.id}><strong>{account.id}</strong></td><td title={account.fraudType}><span className="fraud-type-cell">{account.fraudType}</span></td><td><RiskBadge score={account.risk} /></td><td>{accountDeviceCount(account)}</td><td>{accountTransactionCount(account)}</td>
          </tr>)}
          {visibleAccounts.length === 0 && <tr><td colSpan={5} className="import-no-results">No accounts match the current filters.</td></tr>}
        </tbody></table></div>
        <div className="dataset-foot"><FileUp size={12} /><span>{dataset.name}</span></div>
      </aside>

      <section className="import-graph-panel" aria-label="3D account network">
        <div className="import-graph-toolbar"><div><span className="eyebrow">3D NETWORK GRAPH</span><h2>{expandedAccount ? 'Account branches' : 'Account overview'}</h2></div><div className="graph-key"><span><i className="key-fraud" /> <Term>Fraud node</Term></span><span><i className="key-account" /> <Term>Account risk</Term></span><span><i className="key-unlinked" /> <Term>Unlinked</Term></span></div></div>
        <nav className="import-breadcrumb" aria-label="Graph navigation"><button onClick={() => setExpandedAccountId('')}>All accounts</button>{expandedAccount && <><ChevronRight size={12} /><span>{expandedAccount.id}</span></>}</nav>
        <div className="import-graph-viewport"><NetworkCanvas accounts={visibleAccounts} expanded={expandedAccount} selectedAccountId={selectedAccountId} onAccount={selectAccount} linking={linking} />
          {expandedAccount && <button className="collapse-graph" onClick={() => setExpandedAccountId('')}><ArrowLeft size={12} /> Collapse branches</button>}
          {visibleAccounts.length === 0 && <div className="import-graph-empty">Adjust search or risk filters to show accounts in the network.</div>}
        </div>
        <div className="import-graph-footer"><span><Activity size={12} /> {visibleAccounts.length} accounts in view</span><span>Drag to rotate <i /> Scroll to zoom <i /> Right-drag to pan</span></div>
      </section>

      <aside className="import-side-panel analytics-panel" aria-label="Selected account analytics">
        {selectedAccount ? <>
          <div className="analytics-account-head"><div><span className="eyebrow">ACCOUNT PROFILE</span><h2 title={selectedAccount.id}>{selectedAccount.id}</h2></div><RiskBadge score={selectedAccount.risk} /></div>
          <div className="account-fraud-type"><span>FRAUD TYPE</span><strong>{selectedAccount.fraudType}</strong></div>
          <div className="risk-score-block"><div><span>ACCOUNT RISK SCORE</span><small>{selectedAccount.sourceRisk != null ? 'Supplied account risk' : selectedAccount.risk != null ? 'Maximum supplied transaction risk' : 'No risk value supplied'}</small></div><strong className={`score-${riskTone(selectedAccount.risk)}`}>{selectedAccount.risk?.toFixed(1) ?? '—'}<small>{selectedAccount.risk == null ? '' : '/ 100'}</small></strong></div>
          <div className="account-kpis"><div><span>TOTAL TRANSACTIONS</span><strong>{accountTransactionCount(selectedAccount).toLocaleString()}</strong></div><div><span>TOTAL AMOUNT</span><strong>{totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div><div><span>DEVICES</span><strong>{accountDeviceCount(selectedAccount)}</strong></div><div><span>MERCHANTS</span><strong>{accountMerchantCount(selectedAccount)}</strong></div></div>
          <section className="analytics-section"><div className="import-section-title"><h3><Term>Risk over time</Term></h3><span><Term>TX_RISK</Term></span></div><RiskTrend account={selectedAccount} /></section>
          <section className="analytics-section why-flagged"><div className="import-section-title"><h3>Why it was flagged</h3><span>{accountReasons(selectedAccount, dataset.accounts).length} signals</span></div><ul>{accountReasons(selectedAccount, dataset.accounts).map((reason, index) => <li key={`${index}:${reason}`}><span>{String(index + 1).padStart(2, '0')}</span>{reason}</li>)}</ul></section>
          <section className="analytics-section transaction-section"><div className="import-section-title"><h3>Transactions</h3><span>{selectedAccount.transactions.length} ROWS</span></div><div className="transaction-table-scroll"><table className="account-transaction-table"><thead><tr><th>Device</th><th>Merchant</th><th>Amount</th><th><Term>Risk</Term></th></tr></thead><tbody>{selectedAccount.transactions.map((transaction, index) => <tr key={`${transaction.id}:${transaction.direction}:${index}`}><td title={transaction.device || 'Not supplied'}>{transaction.device || '—'}</td><td title={transaction.merchant || 'Not supplied'}>{transaction.merchant || '—'}</td><td>{transaction.amount == null ? '—' : transaction.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>{transaction.txRisk == null ? '—' : transaction.txRisk.toFixed(1)}</td></tr>)}</tbody></table>{selectedAccount.transactions.length === 0 && <div className="empty-transaction-table">No transaction rows for this account.</div>}</div></section>
        </> : <div className="analytics-empty"><Database size={20} /><h2>Select an account</h2><p>Account risk, trends and transaction details will appear here.</p></div>}
      </aside>
    </div>
    <footer className="import-footer"><span><span className="tiny-status" /> Local dataset analysis</span><span>Analysis uses fields available in the imported CSV and stays in this browser.</span><button onClick={onImport}><Upload size={12} /> Import another dataset</button></footer>
  </main>
}
