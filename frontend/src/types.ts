export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface CaseRecord {
  case_id: string
  typology: string
  severity: Severity
  risk_score: number | null
  first_seen: string
  last_seen: string
  summary: string
  entity_count: number
  transaction_count: number
}

export interface AccountRecord {
  account_id: string
  display_name: string
  role: string
  risk_score: number | null
  case_id: string
  case_ids: string[]
}

export interface TransactionRecord {
  transaction_id: string
  case_id: string
  source_account: string
  destination_account: string
  amount: string
  currency: string
  received_amount: string
  receiving_currency: string
  timestamp: string
  risk_score: number | null
  reason: string
  source_row: number
  payment_format: string
}

export interface EvidenceRecord {
  evidence_id: string
  case_id: string
  entity_id: string
  signal: string
  value: string
  explanation: string
  observed_at: string
}

export interface SourceRowRef {
  file: string
  id: string
  sourceRow?: number
  key: string
  value: string
}

export interface GraphNode {
  id: string
  name: string
  kind: 'case' | 'account' | 'device' | 'network'
  caseId: string
  caseIds: string[]
  riskScore: number | null
  severity?: Severity
  typology?: string
  role?: string
  accountIds?: string[]
}

export interface GraphLink {
  source: string
  target: string
  kind: 'involves' | 'transaction' | 'context'
  transaction?: TransactionRecord
  contextLabel?: string
}

export interface TableRecord {
  id: string
  sourceRow?: number
  values: Record<string, string>
}

export interface DataTable {
  name: string
  label: string
  columns: string[]
  rows: TableRecord[]
}
