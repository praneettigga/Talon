import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Activity, ArrowDownUp, ArrowLeft, BarChart3, Bell, ChevronRight, CircleHelp, Clock3,
  Database, FileSearch, GitCompareArrows, Pause, Play, Radio, RotateCcw, Upload,
  Search, Shield, SlidersHorizontal, Sparkles, TableProperties, X,
} from 'lucide-react'
import DataRail from './components/DataRail'
import FlowGraph from './components/FlowGraph'
import GraphInspector from './components/GraphInspector'
import WhatIfDialog from './components/WhatIfDialog'
import KnowledgeGraph2D from './components/KnowledgeGraph2D'
import { sendControl, type ReplaySpeed, type Snapshot } from './api'
import { buildDashboardData } from './liveData'
import type { AccountRecord, CaseRecord, DataTable, GraphLink, GraphNode, SourceRowRef, TableRecord, TransactionRecord } from './types'
import { Investigation } from './Investigation'
import { Models } from './Risk'
import { EnrichmentControls } from './Enrichment'
import { CaseEvaluation } from './Evaluation'
import ImportedDatasetWorkspace from './components/ImportedDatasetWorkspace'
import { parseImportedFiles, type ImportedDataset } from './importedData'

const NetworkGraph = lazy(() => import('./components/NetworkGraph'))
const emptyTables: DataTable[] = [
  { name: 'cases.json', label: 'Cases', columns: ['case_id'], rows: [] },
  { name: 'accounts.json', label: 'Accounts', columns: ['account_id'], rows: [] },
  { name: 'events.json', label: 'Transfers', columns: ['transaction_id'], rows: [] },
  { name: 'findings.json', label: 'Findings', columns: ['evidence_id'], rows: [] },
]
const emptyIds: string[] = []

const severityClass: Record<CaseRecord['severity'], string> = {
  CRITICAL: 'severity-critical', HIGH: 'severity-high', MEDIUM: 'severity-medium', LOW: 'severity-low',
}
const severityOrder: Record<CaseRecord['severity'], number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
type GraphType = 'all' | 'case' | 'account' | 'transfer' | 'device' | 'network'

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
}

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch { return false }
}

function RiskPill({ score, compact = false }: { score: number | null; compact?: boolean }) {
  const tone = score == null ? 'risk-low' : score >= 85 ? 'risk-critical' : score >= 70 ? 'risk-high' : score >= 45 ? 'risk-medium' : 'risk-low'
  return <span className={`risk-pill ${tone} ${compact ? 'risk-pill-compact' : ''}`} title={score == null ? 'Risk score unavailable' : `Risk ${score.toFixed(1)}`}><span className="risk-pip" />{score == null ? '—' : score.toFixed(1)}<small>{compact ? '' : ' RISK'}</small></span>
}

function sourceRef(file: string, row: TableRecord): SourceRowRef {
  const key = Object.keys(row.values)[0] ?? 'id'
  return { file, id: row.id, sourceRow: row.sourceRow, key, value: row.values[key] ?? row.id }
}

function FeatureModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return <div className="feature-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="feature-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="feature-modal-heading"><div><span className="eyebrow">TALON INTELLIGENCE</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></header>
      <div className="feature-modal-content">{children}</div>
    </section>
  </div>
}

export default function App() {
  const importInput = useRef<HTMLInputElement>(null)
  const [importedDataset, setImportedDataset] = useState<ImportedDataset | null>(null)
  const [importSession, setImportSession] = useState(0)
  const [importError, setImportError] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null)
  const [graphLevel, setGraphLevel] = useState<'overview' | 'case' | 'account'>('overview')
  const [view, setView] = useState<'network' | 'flow'>('network')
  const [focusedAccountId, setFocusedAccountId] = useState('')
  const [focusedTransactionId, setFocusedTransactionId] = useState('')
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [activeTable, setActiveTable] = useState('cases.json')
  const [selectedSource, setSelectedSource] = useState<SourceRowRef | null>(null)
  const [riskThreshold, setRiskThreshold] = useState(0)
  const [sortDescending, setSortDescending] = useState(true)
  const [caseSearch, setCaseSearch] = useState('')
  const [graphSearch, setGraphSearch] = useState('')
  const [graphType, setGraphType] = useState<GraphType>('all')
  const [heatmap, setHeatmap] = useState(false)
  const [showWhatIf, setShowWhatIf] = useState(false)
  const [showInvestigation, setShowInvestigation] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showFeed, setShowFeed] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [webgl, setWebgl] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [holdPreview, setHoldPreview] = useState<{ heldAccountIds: string[]; interruptedTransferIds: string[] } | null>(null)

  useEffect(() => {
    const stream = new EventSource('/v1/events/stream')
    stream.addEventListener('snapshot', event => {
      try {
        const next: Snapshot = JSON.parse((event as MessageEvent).data)
        setSnapshot(next)
        setConnected(true)
        setError('')
      } catch {
        setError('Talon sent an invalid replay snapshot.')
      }
    })
    stream.onerror = () => setConnected(false)
    return () => stream.close()
  }, [])

  useEffect(() => {
    setWebgl(webglAvailable())
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const update = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.case-search input')?.focus()
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setDataOpen(true)
        window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-shortcut="table-search"] input')?.focus(), 40)
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  const data = useMemo(() => snapshot ? buildDashboardData(snapshot) : null, [snapshot])
  const cases = data?.cases ?? []
  const accounts = data?.accounts ?? []
  const transactions = data?.transactions ?? []
  const evidence = data?.evidence ?? []
  const tables = data?.tables ?? emptyTables
  const activeCase = cases.find(item => item.case_id === activeCaseId || Boolean(snapshot?.intelligence.cases.find(candidate => candidate.id === item.case_id)?.mergedCaseIds.includes(activeCaseId ?? ''))) ?? null
  const activeCaseIdResolved = activeCase?.case_id ?? ''
  const activeCaseTransactions = useMemo(() => transactions.filter(transaction => transaction.case_id === activeCaseIdResolved).sort((a, b) => a.timestamp.localeCompare(b.timestamp)), [transactions, activeCaseIdResolved])
  const activeEvidence = evidence.filter(item => item.case_id === activeCaseIdResolved)
  const topEvidence = activeEvidence.slice(0, 2)
  const currentTransaction = transactions.find(item => item.transaction_id === snapshot?.events.at(-1)?.id) ?? null
  const selectedTransaction = transactions.find(item => item.transaction_id === selectedTransactionId) ?? currentTransaction
  const currentProgress = snapshot?.total ? (snapshot.cursor / snapshot.total) * 100 : 0
  const highRiskCount = accounts.filter(account => account.risk_score != null && account.risk_score >= 80).length

  useEffect(() => {
    if (!snapshot) return
    if (snapshot.cursor === 0) {
      setActiveCaseId(null)
      setGraphLevel('overview')
      setView('network')
      setFocusedAccountId('')
      setFocusedTransactionId('')
      setSelectedTransactionId('')
      setSelectedSource(null)
      setHoldPreview(null)
      return
    }
    if (activeCaseId) {
      const resolved = snapshot.intelligence.cases.find(item => item.id === activeCaseId || item.mergedCaseIds.includes(activeCaseId))
      if (resolved && resolved.id !== activeCaseId) setActiveCaseId(resolved.id)
      else if (!resolved) setActiveCaseId(null)
    }
  }, [snapshot?.cursor, snapshot?.intelligence.cases, activeCaseId])

  useEffect(() => {
    setHoldPreview(null)
  }, [snapshot?.cursor])

  const graphBase = useMemo(() => {
    if (!data) return { nodes: [], links: [] } as { nodes: GraphNode[]; links: GraphLink[] }
    if (graphLevel === 'case' && activeCase) return data.graphForCase(activeCase.case_id)
    if (graphLevel === 'account' && focusedAccountId) return data.graphForAccount(focusedAccountId)
    return data.graphOverview
  }, [data, graphLevel, activeCase, focusedAccountId])
  const visibleGraph = useMemo(() => {
    const query = graphSearch.trim().toLowerCase()
    const matchesSearch = (node: GraphNode) => !query || `${node.name} ${node.kind} ${node.role ?? ''} ${node.typology ?? ''} ${node.caseId}`.toLowerCase().includes(query)
    const nodeById = new Map(graphBase.nodes.map(node => [node.id, node] as const))
    const neighbors = new Set<string>()
    if (graphType !== 'all' && graphType !== 'transfer') {
      for (const link of graphBase.links) {
        const source = nodeById.get(link.source)
        const target = nodeById.get(link.target)
        if (source?.kind === graphType) neighbors.add(link.target)
        if (target?.kind === graphType) neighbors.add(link.source)
      }
    }
    const matchesType = (node: GraphNode) => graphType === 'all' || (graphType === 'transfer' ? node.kind === 'account' : node.kind === graphType || neighbors.has(node.id))
    const matchesRisk = (node: GraphNode) => node.riskScore == null ? riskThreshold === 0 : node.riskScore >= riskThreshold
    const matchingTransactions = new Set(graphBase.links.filter(link => link.transaction && `${link.transaction.transaction_id} ${link.transaction.source_account} ${link.transaction.destination_account}`.toLowerCase().includes(query)).map(link => link.transaction!.transaction_id))
    const transactionEndpoints = new Set(graphBase.links.filter(link => link.transaction && matchingTransactions.has(link.transaction.transaction_id)).flatMap(link => [link.source, link.target]))
    const exactNodeMatches = new Set(graphBase.nodes.filter(matchesSearch).map(node => node.id))
    const searchNeighbors = new Set<string>()
    for (const link of graphBase.links) {
      if (exactNodeMatches.has(link.source)) searchNeighbors.add(link.target)
      if (exactNodeMatches.has(link.target)) searchNeighbors.add(link.source)
    }
    const nodes = graphBase.nodes.filter(node => (matchesSearch(node) || transactionEndpoints.has(node.id) || searchNeighbors.has(node.id)) && matchesType(node) && matchesRisk(node))
    const ids = new Set(nodes.map(node => node.id))
    const links = graphBase.links.filter(link => {
      if (!ids.has(link.source) || !ids.has(link.target)) return false
      if (graphType === 'transfer' && link.kind !== 'transaction') return false
      if (link.kind === 'transaction' && link.transaction) {
        const score = link.transaction.risk_score
        if (score == null ? riskThreshold > 0 : score < riskThreshold) return false
      }
      if (query && matchingTransactions.size > 0 && link.kind === 'transaction' && !matchingTransactions.has(link.transaction?.transaction_id ?? '')) return false
      return true
    })
    if (graphType === 'transfer') {
      const endpoints = new Set(links.flatMap(link => [link.source, link.target]))
      return { nodes: nodes.filter(node => endpoints.has(node.id)), links }
    }
    return { nodes, links }
  }, [graphBase, graphSearch, graphType, riskThreshold])
  const filteredCases = useMemo(() => {
    const query = caseSearch.trim().toLowerCase()
    return cases.filter(item => (item.risk_score == null ? riskThreshold === 0 : item.risk_score >= riskThreshold) &&
      (!query || `${item.case_id} ${item.typology} ${item.summary}`.toLowerCase().includes(query)))
      .sort((a, b) => sortDescending
        ? severityOrder[b.severity] - severityOrder[a.severity] || (b.risk_score ?? -1) - (a.risk_score ?? -1)
        : severityOrder[a.severity] - severityOrder[b.severity] || (a.risk_score ?? -1) - (b.risk_score ?? -1))
  }, [cases, caseSearch, riskThreshold, sortDescending])
  const focusedAccount = accounts.find(account => account.account_id === focusedAccountId) ?? null
  const visibleAccounts = useMemo(() => {
    const visibleIds = new Set(visibleGraph.nodes.filter(node => node.kind === 'account').map(node => node.name))
    return accounts.filter(account => visibleIds.has(account.account_id))
  }, [accounts, visibleGraph])
  const canControl = connected && snapshot?.status !== 'unavailable'

  const chooseDataset = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    try {
      const dataset = parseImportedFiles(await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() }))))
      if (!dataset.accounts.length) throw new Error('No account identifiers were found. Include an account_id, account, source_account, or nameOrig column.')
      setImportedDataset(dataset)
      setImportSession(session => session + 1)
      setImportError('')
    } catch (failure) {
      setImportError((failure as Error).message || 'This dataset could not be read as CSV.')
    }
  }, [])

  const datasetPicker = <input ref={importInput} className="sr-only" type="file" accept=".csv,text/csv" multiple onChange={event => void chooseDataset(event)} />
  const openDatasetPicker = () => importInput.current?.click()

  const send = useCallback(async (command: Parameters<typeof sendControl>[0]) => {
    setBusy(true)
    setError('')
    try { await sendControl(command) }
    catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }, [])

  const openSource = useCallback((ref: SourceRowRef) => {
    setSelectedSource(ref)
    setActiveTable(ref.file)
  }, [])

  const handleCase = useCallback((caseId: string) => {
    const found = cases.find(item => item.case_id === caseId || snapshot?.intelligence.cases.find(candidate => candidate.id === item.case_id)?.mergedCaseIds.includes(caseId))
    if (!found) return
    setActiveCaseId(found.case_id)
    setFocusedAccountId('')
    setFocusedTransactionId('')
    setGraphLevel('case')
    setView('network')
    const row = tables.find(item => item.name === 'cases.json')?.rows.find(item => item.id === found.case_id)
    if (row) openSource(sourceRef('cases.json', row))
  }, [cases, snapshot?.intelligence.cases, tables, openSource])

  const handleAccount = useCallback((account: AccountRecord | GraphNode) => {
    const id = 'account_id' in account ? account.account_id : account.name
    const found = accounts.find(item => item.account_id === id)
    if (!found) return
    const caseId = activeCaseIdResolved && found.case_ids.includes(activeCaseIdResolved) ? activeCaseIdResolved : found.case_ids[0] ?? ''
    setActiveCaseId(caseId || null)
    setFocusedAccountId(id)
    setFocusedTransactionId('')
    setGraphLevel('account')
    setView('network')
    const row = tables.find(item => item.name === 'accounts.json')?.rows.find(item => item.id === id)
    if (row) openSource(sourceRef('accounts.json', row))
  }, [accounts, activeCaseIdResolved, tables, openSource])

  const handleTransaction = useCallback((transaction: TransactionRecord | GraphLink) => {
    const record = 'transaction_id' in transaction ? transaction : transaction.transaction
    if (!record) return
    setSelectedTransactionId(record.transaction_id)
    setFocusedAccountId('')
    setFocusedTransactionId(record.transaction_id)
    setView(record.case_id ? 'flow' : 'network')
    setGraphLevel(record.case_id ? 'case' : 'overview')
    setActiveCaseId(record.case_id || null)
    const row = tables.find(item => item.name === 'events.json')?.rows.find(item => item.id === record.transaction_id)
    if (row) openSource(sourceRef('events.json', row))
  }, [tables, openSource])

  const handleContext = useCallback((node: GraphNode) => {
    const related = accounts.find(account => node.accountIds?.includes(account.account_id))
    if (related) handleAccount(related)
  }, [accounts, handleAccount])

  const selectObservedEvent = useCallback((transaction: TransactionRecord) => {
    setSelectedTransactionId(transaction.transaction_id)
    setFocusedTransactionId(transaction.transaction_id)
    setActiveCaseId(transaction.case_id || null)
    const row = tables.find(item => item.name === 'events.json')?.rows.find(item => item.id === transaction.transaction_id)
    if (row) openSource(sourceRef('events.json', row))
  }, [tables, openSource])

  const handleTableRow = useCallback((table: DataTable, row: TableRecord) => {
    openSource(sourceRef(table.name, row))
    if (table.name === 'accounts.json') {
      const account = accounts.find(item => item.account_id === row.id)
      if (account) handleAccount(account)
    } else if (table.name === 'events.json') {
      const transaction = transactions.find(item => item.transaction_id === row.id)
      if (transaction) handleTransaction(transaction)
    } else if (table.name === 'cases.json') handleCase(row.id)
    else if (table.name === 'findings.json') {
      const finding = evidence.find(item => item.evidence_id === row.id)
      if (finding) handleCase(finding.case_id)
    }
  }, [accounts, transactions, evidence, handleAccount, handleCase, handleTransaction, openSource])

  const handleSpeed = (event: ChangeEvent<HTMLSelectElement>) => {
    void send({ action: 'speed', speed: Number(event.target.value) as ReplaySpeed })
  }
  const handleReplay = () => {
    if (!snapshot) return
    void send({ action: snapshot.status === 'running' ? 'pause' : 'start' })
  }
  const navigateOverview = () => {
    setGraphLevel('overview')
    setView('network')
    setActiveCaseId(null)
    setFocusedAccountId('')
    setFocusedTransactionId('')
  }

  const latestEventId = currentTransaction?.transaction_id ?? ''

  if (importedDataset) return <>{datasetPicker}<ImportedDatasetWorkspace key={importSession} dataset={importedDataset} onExit={() => setImportedDataset(null)} onImport={openDatasetPicker} importError={importError} onDismissImportError={() => setImportError('')} /></>

  return (
    <div className="app-shell">
      {datasetPicker}
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><Shield size={18} strokeWidth={1.8} /><span /></div><div><b>TALON</b><small>NETWORK INTELLIGENCE</small></div></div>
        <div className="topbar-divider" />
        <div className="workspace-crumb"><span className="crumb-muted">INVESTIGATIONS</span><ChevronRight size={13} /><span>{activeCase?.case_id ?? 'Network overview'}</span></div>
        <div className="topbar-right"><button className="import-dataset-trigger" onClick={openDatasetPicker}><Upload size={13} /> Import dataset</button><div className={`stream-status ${connected ? '' : 'stream-offline'}`}><span className="live-dot" /> {connected ? 'TALON API CONNECTED' : 'CONNECTING TO TALON'}</div><button className="icon-button top-icon" title="Notifications"><Bell size={16} /><i /></button><div className="avatar">AD</div></div>
      </header>
      {importError && <div className="import-error-banner" role="alert"><span>{importError}</span><button onClick={() => setImportError('')} aria-label="Dismiss import error"><X size={13} /></button></div>}

      <main className="dashboard-grid">
        <aside className="case-sidebar">
          <div className="sidebar-intro"><div><span className="eyebrow">INVESTIGATION DESK</span><h1>Case network</h1></div><button className="icon-button tiny" title="Workspace help"><CircleHelp size={15} /></button></div>
          <div className="case-stat-row"><div className="stat-mini"><span>OPEN CASES</span><strong>{String(cases.length).padStart(2, '0')}</strong></div><div className="stat-mini"><span>HIGH RISK</span><strong className="coral-text">{String(highRiskCount).padStart(2, '0')}</strong></div><div className="stat-mini"><span>OBSERVED ACCTS</span><strong>{String(accounts.length).padStart(2, '0')}</strong></div></div>
          <div className="sidebar-section-head"><div><span className="eyebrow">ACTIVE QUEUE</span><span className="queue-count">{filteredCases.length} cases</span></div><button className="icon-button tiny" title="Sort by severity and risk" onClick={() => setSortDescending(value => !value)}><ArrowDownUp size={14} /></button></div>
          <label className="case-search"><Search size={14} /><input value={caseSearch} onChange={event => setCaseSearch(event.target.value)} placeholder="Search cases" /><kbd>⌘ F</kbd></label>
          <div className="case-list">
            {filteredCases.map((item, index) => <button key={item.case_id} className={`case-card ${activeCaseIdResolved === item.case_id ? 'case-card-active' : ''}`} onClick={() => handleCase(item.case_id)}>
              <div className="case-card-top"><span className={`severity-tag ${severityClass[item.severity]}`}>{item.severity}</span><span className="case-rank">#{String(index + 1).padStart(2, '0')}</span></div>
              <div className="case-card-title">{item.case_id}<RiskPill score={item.risk_score} compact /></div>
              <div className="case-card-typology"><span className="typology-icon"><Activity size={12} /></span>{item.typology}</div>
              <div className="case-card-foot"><span>{item.entity_count} accounts</span><span>{item.transaction_count} transfers</span><span>{formatTime(item.last_seen)}</span></div>
              <span className="card-active-line" />
            </button>)}
            {filteredCases.length === 0 && <div className="empty-state-small">{snapshot?.status === 'unavailable' ? 'Talon replay is unavailable.' : cases.length ? 'No cases match these filters.' : 'Cases appear as observed transactions form supported structures.'}</div>}
          </div>
          <div className="sidebar-filter-box"><div className="filter-title"><SlidersHorizontal size={14} /><span>Minimum risk</span><b>{riskThreshold}+</b></div><input aria-label="Minimum risk threshold" type="range" min="0" max="100" step="5" value={riskThreshold} onChange={event => setRiskThreshold(Number(event.target.value))} /><div className="range-labels"><span>All observed</span><span>High risk</span></div></div>
          <div className="sidebar-bottom"><div className="profile-mini"><div className="avatar avatar-small">AD</div><div><b>Investigator</b><small>VersionOne workspace</small></div><button className="icon-button tiny"><ChevronRight size={14} /></button></div><div className="workspace-label"><span className="workspace-indicator" /> Talon API <span>{snapshot?.intelligence.models.status ?? '—'}</span></div></div>
        </aside>

        <section className="main-workspace">
          <div className="workspace-heading">
            <div className="heading-left"><span className="eyebrow">LIVE NETWORK VIEW <span className="heading-slash">/</span> {activeCase?.case_id ?? 'OVERVIEW'}</span><h2>{view === 'network' ? 'Financial network' : 'Transaction pathway'}<span className="heading-badge">{view === 'network' ? '3D' : '2D'}</span></h2><p>{view === 'network' ? activeCase ? `${activeCase.typology} · ${activeCase.entity_count} accounts · ${activeCase.transaction_count} observed transfers` : 'Observed transfers, supported structures, and synthetic context links' : `${activeCase?.typology ?? 'Observed account activity'} · ${activeCaseTransactions.length} linked transfers`}</p></div>
          <div className="workspace-actions">{view === 'flow' ? <button className="button-quiet" onClick={() => setView('network')}><ArrowLeft size={14} /> Network</button> : graphLevel !== 'overview' && <button className="button-quiet" onClick={() => setView('flow')}>Flow view</button>}<button className="button-quiet investigation-open" disabled={!activeCase} onClick={() => setShowInvestigation(true)}><FileSearch size={13} /> Case details</button><button className="button-quiet feed-open" onClick={() => setShowFeed(true)}><Activity size={13} /> Live feed</button><button className="button-outline" disabled={!activeCase || !canControl} onClick={() => setShowWhatIf(true)}><GitCompareArrows size={14} /> Simulate hold</button><button className="icon-button data-toggle" onClick={() => setDataOpen(true)} title="Open data room"><Database size={15} /></button></div>
          </div>

          <div className="graph-toolbar graph-toolbar-live">
            <div className="graph-legend"><span><i className="legend-case" /> Case</span><span><i className="legend-account" /> Account</span><span><i className="legend-flow" /> Transfer</span><span><i className="legend-context" /> Context</span></div>
            <div className="graph-tools"><label className="graph-search"><Search size={12} /><input aria-label="Search graph" value={graphSearch} onChange={event => setGraphSearch(event.target.value)} placeholder="Search graph" /></label>
              <select aria-label="Filter graph entity type" value={graphType} onChange={event => setGraphType(event.target.value as GraphType)}><option value="all">All types</option><option value="case">Cases</option><option value="account">Accounts</option><option value="transfer">Transfers</option><option value="device">Devices</option><option value="network">Networks</option></select>
              <span className="filter-label"><SlidersHorizontal size={13} /> Risk <b>{riskThreshold}</b></span><input aria-label="Filter graph by minimum risk" className="graph-range" type="range" min="0" max="100" step="5" value={riskThreshold} onChange={event => setRiskThreshold(Number(event.target.value))} />
              <div className="graph-mode-toggle"><button className={!heatmap ? 'active' : ''} onClick={() => setHeatmap(false)}>Network</button><button className={heatmap ? 'active' : ''} onClick={() => setHeatmap(true)}>Heatmap</button></div>
              <span className="result-count">{visibleGraph.nodes.length} nodes</span>
            </div>
          </div>

          <div className={`graph-panel ${view === 'flow' ? 'flow-panel' : ''}`}>
            {view === 'network' ? <>
              <div className="graph-vignette" />
              <nav className="graph-breadcrumb" aria-label="Graph navigation"><button onClick={navigateOverview}>Network overview</button>{graphLevel !== 'overview' && activeCase && <><ChevronRight size={11} /><button onClick={() => { setGraphLevel('case'); setView('network'); setFocusedAccountId('') }}>{activeCase.case_id}</button></>}{graphLevel === 'account' && focusedAccount && <><ChevronRight size={11} /><span>{focusedAccount.account_id}</span></>}</nav>
              {webgl ? <Suspense fallback={<div className="graph-loading"><span className="loading-orbit" /><b>Preparing network renderer</b><small>Loading 3D topology</small></div>}>
                <NetworkGraph nodes={visibleGraph.nodes} links={visibleGraph.links} activeCaseId={activeCaseIdResolved} replayTransactionId={latestEventId} selectedTransactionId={selectedTransactionId} reducedMotion={reducedMotion} heatmap={heatmap} heldAccountIds={holdPreview?.heldAccountIds ?? emptyIds} interruptedTransferIds={holdPreview?.interruptedTransferIds ?? emptyIds} onCase={handleCase} onAccount={handleAccount} onContext={handleContext} onTransaction={handleTransaction} />
              </Suspense> : <KnowledgeGraph2D nodes={visibleGraph.nodes} links={visibleGraph.links} selectedTransactionId={selectedTransactionId} replayTransactionId={latestEventId} heldAccountIds={holdPreview?.heldAccountIds ?? emptyIds} interruptedTransferIds={holdPreview?.interruptedTransferIds ?? emptyIds} onCase={handleCase} onAccount={handleAccount} onContext={handleContext} onTransaction={handleTransaction} />}
              <div className="graph-hud"><span className="hud-pulse" /> {heatmap ? 'RISK HEATMAP' : 'NETWORK ACTIVE'} <span className="hud-separator">/</span> {visibleGraph.links.filter(link => link.kind === 'transaction').length} TRANSFERS</div>
              {activeCase && <div className="selected-case-float"><div className="selected-case-top"><span className={`severity-tag ${severityClass[activeCase.severity]}`}>{activeCase.severity}</span><span className="case-id-float">{activeCase.case_id}</span><RiskPill score={activeCase.risk_score} compact /></div><strong>{activeCase.typology}</strong><p>{activeCase.summary}</p><div className="float-evidence">{topEvidence.map(item => <span key={item.evidence_id}><Sparkles size={11} /> {item.value}</span>)}</div></div>}
              <div className="graph-instruction"><span className="mouse-glyph">⌖</span> Drag to orbit <b>·</b> Scroll to zoom <b>·</b> Select a case or account to explore</div>
              {snapshot && <GraphInspector activeCase={activeCase} account={focusedAccount} accounts={visibleAccounts} transactions={transactions} selectedTransaction={selectedTransaction} snapshot={snapshot} onSelectAccount={handleAccount} />}
            </> : <>
              <div className="flow-heading"><button className="flow-back" onClick={navigateOverview}><ArrowLeft size={14} /> Network</button><nav className="flow-breadcrumb" aria-label="Graph navigation"><button onClick={navigateOverview}>Overview</button>{activeCase && <><ChevronRight size={10} /><button onClick={() => { setView('network'); setGraphLevel('case'); setFocusedAccountId('') }}>{activeCase.case_id}</button></>}{focusedAccount && <><ChevronRight size={10} /><span>{focusedAccount.account_id}</span></>}</nav><span className="flow-count">{activeCaseTransactions.length} transfers <span>·</span> chronological</span></div>
              <FlowGraph caseId={graphLevel === 'case' ? activeCaseIdResolved : ''} accounts={accounts} transactions={transactions} focusedAccountId={focusedAccountId} focusedTransactionId={focusedTransactionId || selectedTransactionId} replayTransactionId={latestEventId} heldAccountIds={holdPreview?.heldAccountIds ?? emptyIds} interruptedTransferIds={holdPreview?.interruptedTransferIds ?? emptyIds} onAccount={handleAccount} onTransaction={handleTransaction} />
              {snapshot && <GraphInspector activeCase={activeCase} account={focusedAccount} accounts={visibleAccounts} transactions={transactions} selectedTransaction={selectedTransaction} snapshot={snapshot} onSelectAccount={handleAccount} />}
              <div className="flow-evidence-strip"><span className="evidence-label"><Sparkles size={13} /> WHY DETECTED</span>{focusedTransactionId && activeCaseTransactions.find(transaction => transaction.transaction_id === focusedTransactionId) ? <div className="transaction-reason"><b>{focusedTransactionId} · {activeCaseTransactions.find(transaction => transaction.transaction_id === focusedTransactionId)?.risk_score?.toFixed(1) ?? 'risk unavailable'}</b><span>{activeCaseTransactions.find(transaction => transaction.transaction_id === focusedTransactionId)?.reason}</span></div> : activeEvidence.slice(0, 3).map(item => <div key={item.evidence_id}><b>{item.signal}</b><span>{item.value}</span></div>)}</div>
              {focusedAccount && <div className="account-focus-chip"><span className="focus-pulse" /><span><b>{focusedAccount.display_name}</b><small>{focusedAccount.account_id} · {focusedAccount.role}</small></span><RiskPill score={focusedAccount.risk_score} compact /><button className="icon-button tiny" onClick={() => { setFocusedAccountId(''); setFocusedTransactionId('') }} aria-label="Clear account focus"><X size={13} /></button></div>}
            </>}
          </div>

          <section className="replay-panel">
            <div className="replay-top"><div className="replay-title"><span className="replay-icon"><Radio size={14} /></span><div><b>TALON STREAM REPLAY</b><small>{snapshot?.dataset ?? 'Connecting to Talon replay service'}</small></div></div>
              <div className="replay-event">{selectedTransaction ? <><span className="event-dot" /> <b>{selectedTransaction.transaction_id}</b><span>{selectedTransaction.source_account} → {selectedTransaction.destination_account}</span><time>{formatTime(selectedTransaction.timestamp)}</time></> : <><span className="event-dot muted" /><span>{snapshot?.status === 'unavailable' ? 'Replay data unavailable' : 'Start replay to observe transactions'}</span></>}</div>
              <div className="replay-buttons"><select aria-label="Replay speed" value={snapshot?.speed ?? 1} disabled={!canControl || busy} onChange={handleSpeed}><option value={1}>1 / sec</option><option value={5}>5 / sec</option><option value={20}>20 / sec</option></select><button className="icon-button tiny" disabled={!canControl || busy} onClick={() => void send({ action: 'reset' })} title="Reset Talon replay"><RotateCcw size={14} /></button><button className="play-button" disabled={!canControl || busy || snapshot?.status === 'completed'} onClick={handleReplay}>{snapshot?.status === 'running' ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}{snapshot?.status === 'running' ? 'Pause' : 'Play'}</button></div>
            </div>
            {(error || snapshot?.error || !connected) && <p role="alert" className="notice replay-notice">{error || snapshot?.error || 'Waiting for the Talon API connection. Replay controls will return when it reconnects.'}</p>}
            {snapshot?.intelligence.status === 'unavailable' && <p role="status" className="notice replay-notice">Intelligence unavailable: {snapshot.intelligence.error}. Observed transfers remain available.</p>}
            <div className="timeline-row"><div className="timeline-track"><div className="timeline-fill" style={{ width: `${currentProgress}%` }} /><div className="timeline-events">{transactions.map((item, index) => <button key={item.transaction_id} className={`timeline-event ${index < (snapshot?.cursor ?? 0) ? 'timeline-event-done' : ''} ${selectedTransaction?.transaction_id === item.transaction_id ? 'timeline-event-current' : ''}`} style={{ left: `${((index + 1) / Math.max(snapshot?.total ?? 1, 1)) * 100}%` }} title={`${item.transaction_id} · ${item.reason}`} onClick={() => selectObservedEvent(item)} />)}</div></div><div className="timeline-now"><Clock3 size={11} /> {snapshot?.cursor ?? 0} / {snapshot?.total ?? 0} · {formatTime(snapshot?.eventTime)}</div></div>
          </section>
        </section>

        <DataRail tables={tables} activeTable={activeTable} source={selectedSource} onTable={file => setActiveTable(file)} onRow={handleTableRow} open={dataOpen} onClose={() => setDataOpen(false)} dataset={snapshot?.dataset} cursor={snapshot?.cursor} total={snapshot?.total} />
      </main>

      <footer className="app-footer"><span><span className="tiny-status" /> {connected ? 'TALON API CONNECTED' : 'TALON API OFFLINE'}</span><span>{snapshot?.dataset ?? 'Waiting for backend snapshot'} <b>·</b> Scores prioritize investigation; they do not establish fraud</span><button onClick={() => setDataOpen(true)}><FileSearch size={12} /> Observed data</button><button onClick={() => setShowAnalytics(true)}><BarChart3 size={12} /> Models & evaluation</button><button onClick={() => setShowWhatIf(true)} disabled={!activeCase || !canControl}><TableProperties size={12} /> Route simulation</button><span className="footer-version">v1.0.0</span></footer>

      {showWhatIf && activeCase && snapshot && <WhatIfDialog caseRecord={activeCase} accounts={accounts} transactions={transactions} cursor={snapshot.cursor} replayStatus={snapshot.status} onPreview={setHoldPreview} onClose={() => { setShowWhatIf(false); setHoldPreview(null) }} />}
      {showInvestigation && snapshot && <FeatureModal title={activeCase ? `Case investigation · ${activeCase.case_id}` : 'Case investigations'} onClose={() => setShowInvestigation(false)}>
        <Investigation intelligence={snapshot.intelligence} events={snapshot.events} selectedTransaction={selectedTransactionId || null} onSelectTransaction={id => { setSelectedTransactionId(id); const record = transactions.find(item => item.transaction_id === id); if (record) selectObservedEvent(record) }} replayStatus={snapshot.status} initialCaseId={activeCaseIdResolved || null} />
      </FeatureModal>}
      {showFeed && snapshot && <FeatureModal title={`Live event feed · ${snapshot.cursor} / ${snapshot.total}`} onClose={() => setShowFeed(false)}>
        <div className="live-feed-list">{[...snapshot.events].slice(-50).reverse().map(event => {
          const record = transactions.find(item => item.transaction_id === event.id)
          return <button className={`live-feed-row ${selectedTransactionId === event.id ? 'selected' : ''}`} key={event.id} onClick={() => { if (record) selectObservedEvent(record) }}>
            <span className="event-top"><strong>{event.id}</strong><time>{formatTime(event.timestamp)}</time></span>
            <span className="live-feed-route">{event.fromBank}:{event.fromAccount} <b>→</b> {event.toBank}:{event.toAccount}</span>
            <span className="muted">{event.amountPaid} {event.paymentCurrency} · {event.paymentFormat} · source row {event.sourceRow}</span>
          </button>
        })}{snapshot.events.length === 0 && <p className="empty-state-small">Start replay to populate the observed event feed.</p>}</div>
      </FeatureModal>}
      {showAnalytics && snapshot && <FeatureModal title="Models, evaluation & context" onClose={() => setShowAnalytics(false)}>
        <div className="analytics-stack"><Models models={snapshot.intelligence.models} /><CaseEvaluation /><EnrichmentControls context={snapshot.intelligence.enrichment} /></div>
      </FeatureModal>}
      {holdPreview && <span className="sr-only" aria-live="polite">Hold preview applied to {holdPreview.heldAccountIds.length} accounts and {holdPreview.interruptedTransferIds.length} transfers.</span>}
      <button className="mobile-data-fab" onClick={() => setDataOpen(true)} aria-label="Open data room"><Database size={17} /><span>Data room</span></button>
    </div>
  )
}
