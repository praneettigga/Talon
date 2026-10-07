import type { Snapshot } from './api'
import type { AccountRecord, CaseRecord, DataTable, EvidenceRecord, GraphLink, GraphNode, TableRecord, TransactionRecord } from './types'

export interface DashboardData {
  cases: CaseRecord[]
  accounts: AccountRecord[]
  transactions: TransactionRecord[]
  evidence: EvidenceRecord[]
  tables: DataTable[]
  graphOverview: { nodes: GraphNode[]; links: GraphLink[] }
  graphForCase: (caseId: string) => { nodes: GraphNode[]; links: GraphLink[] }
  graphForAccount: (accountId: string) => { nodes: GraphNode[]; links: GraphLink[] }
}

const accountNodeId = (id: string) => `account:${id}`
const caseNodeId = (id: string) => `case:${id}`

function table(name: string, label: string, columns: string[], rows: TableRecord[]): DataTable {
  return { name, label, columns, rows }
}

export function buildDashboardData(snapshot: Snapshot): DashboardData {
  const intelligence = snapshot.intelligence
  const observedCaseByTransaction = new Map<string, string>()
  const caseRecords: CaseRecord[] = intelligence.cases.map(item => {
    for (const transactionId of item.transactionIds) {
      if (!observedCaseByTransaction.has(transactionId)) observedCaseByTransaction.set(transactionId, item.id)
    }
    return {
      case_id: item.id,
      typology: item.typologies.join(' · ') || 'Structural finding',
      severity: item.severity,
      risk_score: item.severityInputs.highestEntityRisk,
      first_seen: item.firstSeen,
      last_seen: item.lastSeen,
      summary: item.evidence.flatMap(finding => finding.facts).slice(0, 2).join(' · ') || item.severityReason,
      entity_count: item.entities.length,
      transaction_count: item.transactionIds.length,
    }
  })

  const decisionByTransaction = new Map(intelligence.decisions.map(decision => [decision.transactionId, decision] as const))
  const transactionRecords: TransactionRecord[] = snapshot.events.map(event => {
    const decision = decisionByTransaction.get(event.id)
    return {
      transaction_id: event.id,
      case_id: observedCaseByTransaction.get(event.id) ?? '',
      source_account: `${event.fromBank}/${event.fromAccount}`,
      destination_account: `${event.toBank}/${event.toAccount}`,
      amount: event.amountPaid,
      currency: event.paymentCurrency,
      received_amount: event.amountReceived,
      receiving_currency: event.receivingCurrency,
      timestamp: event.timestamp,
      risk_score: decision?.risk.riskScore ?? null,
      reason: decision?.risk.reason ?? 'No transaction decision is available.',
      source_row: event.sourceRow,
      payment_format: event.paymentFormat,
    }
  })

  const roleByAccount = new Map<string, { caseIds: string[]; roles: Set<string> }>()
  for (const investigation of intelligence.cases) {
    for (const entity of investigation.entities) {
      const record = roleByAccount.get(entity.id) ?? { caseIds: [], roles: new Set<string>() }
      if (!record.caseIds.includes(investigation.id)) record.caseIds.push(investigation.id)
      entity.roles.forEach(role => record.roles.add(role))
      roleByAccount.set(entity.id, record)
    }
  }
  const observedAccounts = new Set(transactionRecords.flatMap(event => [event.source_account, event.destination_account]))
  const accounts: AccountRecord[] = [...observedAccounts].sort().map(id => {
    const role = roleByAccount.get(id)
    return {
      account_id: id,
      display_name: id,
      role: [...(role?.roles ?? [])].join(', ') || 'counterparty',
      risk_score: intelligence.entityRisks[id]?.riskScore ?? null,
      case_id: role?.caseIds[0] ?? '',
      case_ids: role?.caseIds ?? [],
    }
  })

  const evidenceRecords: EvidenceRecord[] = intelligence.cases.flatMap(investigation => investigation.evidence.map(finding => ({
    evidence_id: finding.id,
    case_id: investigation.id,
    entity_id: finding.anchors[0] ?? finding.accountIds[0] ?? '',
    signal: finding.typology,
    value: finding.facts[0] ?? `${finding.transactionIds.length} supporting transfers`,
    explanation: finding.facts.join(' · '),
    observed_at: finding.observedAt,
  })))

  const accountById = new Map(accounts.map(account => [account.account_id, account] as const))
  const caseById = new Map(caseRecords.map(item => [item.case_id, item] as const))
  const makeCaseNode = (item: CaseRecord): GraphNode => ({
    id: caseNodeId(item.case_id), name: item.case_id, kind: 'case', caseId: item.case_id,
    caseIds: [item.case_id], riskScore: item.risk_score, severity: item.severity, typology: item.typology,
  })
  const makeAccountNode = (account: AccountRecord): GraphNode => ({
    id: accountNodeId(account.account_id), name: account.display_name, kind: 'account', caseId: account.case_id,
    caseIds: account.case_ids, riskScore: account.risk_score, role: account.role,
  })
  const makeTransferLink = (transaction: TransactionRecord): GraphLink => ({
    source: accountNodeId(transaction.source_account), target: accountNodeId(transaction.destination_account),
    kind: 'transaction', transaction,
  })
  const contextForAccounts = (allowed: Set<string>) => {
    const nodes: GraphNode[] = []
    const links: GraphLink[] = []
    for (const context of intelligence.enrichment.links) {
      const members = context.accountIds.filter(id => allowed.has(id))
      if (members.length < 2) continue
      const id = `context:${context.kind}:${context.id}`
      nodes.push({
        id, name: context.value, kind: context.kind, caseId: '', caseIds: [], riskScore: null, accountIds: members,
      })
      for (const member of members) links.push({
        source: accountNodeId(member), target: id, kind: 'context', contextLabel: context.kind,
      })
    }
    return { nodes, links }
  }

  const graphOverview = (() => {
    const nodes: GraphNode[] = caseRecords.map(makeCaseNode)
    nodes.push(...accounts.map(makeAccountNode))
    const links: GraphLink[] = []
    for (const investigation of intelligence.cases) {
      for (const entity of investigation.entities) {
        if (accountById.has(entity.id)) links.push({ source: caseNodeId(investigation.id), target: accountNodeId(entity.id), kind: 'involves' })
      }
    }
    links.push(...transactionRecords.filter(item => accountById.has(item.source_account) && accountById.has(item.destination_account)).map(makeTransferLink))
    const context = contextForAccounts(new Set(accounts.map(account => account.account_id)))
    return { nodes: [...nodes, ...context.nodes], links: [...links, ...context.links] }
  })()

  const graphForCase = (caseId: string) => {
    const investigation = intelligence.cases.find(item => item.id === caseId || item.mergedCaseIds.includes(caseId))
    if (!investigation) return { nodes: [], links: [] }
    const members = new Set(investigation.entities.map(entity => entity.id).filter(id => accountById.has(id)))
    const caseAccounts = accounts.filter(account => members.has(account.account_id))
    const transactions = transactionRecords.filter(item => investigation.transactionIds.includes(item.transaction_id))
    const context = contextForAccounts(members)
    return {
      nodes: [makeCaseNode(caseById.get(investigation.id)!), ...caseAccounts.map(makeAccountNode), ...context.nodes],
      links: [
        ...caseAccounts.map(account => ({ source: caseNodeId(investigation.id), target: accountNodeId(account.account_id), kind: 'involves' as const })),
        ...transactions.filter(item => members.has(item.source_account) && members.has(item.destination_account)).map(makeTransferLink),
        ...context.links,
      ],
    }
  }

  const graphForAccount = (accountId: string) => {
    const focus = accountById.get(accountId)
    if (!focus) return { nodes: [], links: [] }
    const transactions = transactionRecords.filter(item => item.source_account === accountId || item.destination_account === accountId)
    const members = new Set([accountId, ...transactions.flatMap(item => [item.source_account, item.destination_account])])
    const caseIds = new Set(accounts.filter(item => members.has(item.account_id)).flatMap(item => item.case_ids))
    const relatedCases = intelligence.cases.filter(item => caseIds.has(item.id))
    const relatedCaseRecords = relatedCases.map(item => caseById.get(item.id)).filter((item): item is CaseRecord => Boolean(item))
    const context = contextForAccounts(members)
    return {
      nodes: [...relatedCaseRecords.map(makeCaseNode), ...accounts.filter(item => members.has(item.account_id)).map(makeAccountNode), ...context.nodes],
      links: [
        ...relatedCases.flatMap(item => item.entities.filter(entity => members.has(entity.id)).map(entity => ({
          source: caseNodeId(item.id), target: accountNodeId(entity.id), kind: 'involves' as const,
        }))),
        ...transactions.map(makeTransferLink),
        ...context.links,
      ],
    }
  }

  const accountColumns = ['account_id', 'role', 'risk_score', 'case_ids']
  const transactionColumns = ['transaction_id', 'timestamp', 'source_account', 'destination_account', 'amount', 'currency', 'received_amount', 'receiving_currency', 'risk_score', 'payment_format', 'source_row']
  const caseColumns = ['case_id', 'typology', 'severity', 'risk_score', 'first_seen', 'last_seen', 'entity_count', 'transaction_count', 'summary']
  const evidenceColumns = ['evidence_id', 'case_id', 'entity_id', 'signal', 'value', 'explanation', 'observed_at']
  const makeRows = <T extends { [key: string]: unknown }>(items: T[], idKey: keyof T, columns: string[]): TableRecord[] => items.map(item => ({
    id: String(item[idKey]),
    sourceRow: typeof item.source_row === 'number' ? item.source_row : undefined,
    values: Object.fromEntries(columns.map(column => [column, String(item[column] ?? '')])),
  }))
  const tables: DataTable[] = [
    table('cases.json', 'Cases', caseColumns, makeRows(caseRecords as unknown as Record<string, unknown>[], 'case_id', caseColumns)),
    table('accounts.json', 'Accounts', accountColumns, makeRows(accounts as unknown as Record<string, unknown>[], 'account_id', accountColumns)),
    table('events.json', 'Transfers', transactionColumns, makeRows(transactionRecords as unknown as Record<string, unknown>[], 'transaction_id', transactionColumns)),
    table('findings.json', 'Findings', evidenceColumns, makeRows(evidenceRecords as unknown as Record<string, unknown>[], 'evidence_id', evidenceColumns)),
  ]

  return { cases: caseRecords, accounts, transactions: transactionRecords, evidence: evidenceRecords, tables, graphOverview, graphForCase, graphForAccount }
}
