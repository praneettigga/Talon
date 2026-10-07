export type ReplayStatus = 'paused' | 'running' | 'completed' | 'unavailable'
export type ReplaySpeed = 1 | 5 | 20

export interface ReplayEvent {
  id: string
  sourceRow: number
  timestamp: string
  fromBank: string
  fromAccount: string
  toBank: string
  toAccount: string
  amountReceived: string
  receivingCurrency: string
  amountPaid: string
  paymentCurrency: string
  paymentFormat: string
}

export interface DecisionRisk {
  status: 'scored' | 'historical warmup' | 'unavailable'
  reason: string
  transactionId: string
  asOf: string
  riskScore: number | null
  behaviourScore: number | null
  ginScore: number | null
  behaviourByAccount: Record<string, number | null>
  contributions: { feature: string; value: number }[]
  rawMargin: number | null
  baseMargin: number | null
  inputs: Record<string, number>
  ruleScores: Record<string, number>
  modelVersion: string | null
}

export interface AccountFeatures {
  accountId: string
  currency: string
  asOf: string
  historyCount: number
  historyStatus: string
  incomingCount: number
  outgoingCount: number
  incomingTotal: string
  outgoingTotal: string
  fanInDegree: number
  fanOutDegree: number
  fiveMinuteVelocity: number
  oneHourVelocity: number
  amountMean: string | null
  amountDeviation: string | null
  amountZScore: number | null
  forwardingRatio: number | null
  incomingOutgoingRatio: number | null
  newCounterparty: boolean
  newCounterpartyRate: number
  accountAge: null
}

export interface Finding {
  id: string
  typology: string
  strength: number
  anchors: string[]
  accountIds: string[]
  roles: Record<string, string>
  transactionIds: string[]
  window: { first: string; last: string; limit: string }
  firstSeen: string
  observedAt: string
  facts: string[]
  corroborated: boolean
}

export interface InvestigationCase {
  id: string
  firstSeen: string
  lastSeen: string
  findingIds: string[]
  transactionIds: string[]
  typologies: string[]
  mergedCaseIds: string[]
  entities: { id: string; roles: string[]; suspect: boolean }[]
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  severityInputs: {
    corroboratedSignals: number
    structuralFindings: number
    affectedEntities: number
    typologies: string[]
    highestEntityRisk: number | null
    signalTypes: string[]
    reviewThreshold: number | null
    asOf: string
  }
  severityReason: string
  evidence: Finding[]
  connections: { findingId: string; priorFindingId: string; via: string; sharedIds: string[]; observedAt: string }[]
  timeline: { timestamp: string; findingId: string; stage: string; severity: string; linkedTransactions: number; facts: string[]; highestEntityRisk?: number | null }[]
}

export interface EntityRisk extends DecisionRisk {
  id: string
  transactionRiskScore: number | null
  riskSourceTransactionId: string | null
  aggregation: string
  riskAsOf: string
}

export interface DetectionMetrics {
  rows: number
  positives: number
  threshold: number
  precision: number | null
  recall: number | null
  prAuc: number | null
  falsePositiveRate: number | null
  brierScore: number
  confusion: { tn: number; fp: number; fn: number; tp: number }
}

export interface EvaluationReport {
  modelVersion: string
  test: DetectionMetrics
  testReviewGate: DetectionMetrics
  limitations: string[]
  split: Record<string, { rows: number; positives: number; endExclusive: string }>
  thresholdSelection: { reviewThreshold: number; targetFalsePositiveRate: number; metrics: DetectionMetrics }
}

export interface ModelStatus {
  status: 'ready' | 'unavailable'
  error: string | null
  version: string | null
  graphModel: string
  availableFrom: string | null
  reviewThreshold: number | null
  evaluation: EvaluationReport | null
}

export interface DeviceContext {
  accountId: string
  deviceId: string
  ipCluster: string
  location: string
  firstSeen: string
  scenario: 'individual context' | 'shared-network control' | 'shared-device demonstration'
}

export interface InfrastructureLink {
  id: string
  kind: 'device' | 'network'
  value: string
  accountIds: string[]
  firstSeen: string
  observedAt: string
  supportingFindingIds: string[]
  supportsStructure: boolean
  scenarios: string[]
  facts: string[]
}

export interface EnrichmentSnapshot {
  status: 'ready' | 'unavailable'
  error: string | null
  label: string
  asOf: string | null
  usedInRiskModel: false
  affectsSeverity: false
  accounts: Record<string, DeviceContext>
  links: InfrastructureLink[]
}

export interface IntelligenceSnapshot {
  status: 'ready' | 'unavailable'
  error: string | null
  enabledTypologies: string[]
  ruleWindow: string
  featureWindow: string
  cases: InvestigationCase[]
  entities: Record<string, AccountFeatures>
  decisions: { transactionId: string; timestamp: string; features: AccountFeatures[]; risk: DecisionRisk; context: unknown }[]
  entityRisks: Record<string, EntityRisk>
  models: ModelStatus
  enrichment: EnrichmentSnapshot
}

export interface Snapshot {
  status: ReplayStatus
  speed: ReplaySpeed
  cursor: number
  total: number
  eventTime: string | null
  dataset: string
  error: string | null
  events: ReplayEvent[]
  intelligence: IntelligenceSnapshot
}

export type Control =
  | { action: 'start' | 'pause' | 'reset' }
  | { action: 'speed'; speed: ReplaySpeed }

export interface SimulationScenario {
  name: 'initial' | 'comparison'
  heldAccountIds: string[]
  interruptedTransferIds: string[]
  interruptedTransferCount: number
  remainingTransferIds: string[]
  remainingTransferCount: number
  noLongerReachableAccountIds: string[]
  reachableAccountIds: string[]
  directlyTouchedAccountIds: string[]
  touchedCounterpartyIds: string[]
  remainingRouteCount: number
  remainingAlternateRouteCount: number
  routesTruncated: boolean
  remainingRoutes: { destination: string; accountIds: string[]; transactionIds: string[]; alternateToInterruptedBaseline: boolean }[]
}

export interface SimulationResult {
  status: 'ready'
  caseId: string
  snapshotCursor: number
  observedAt: string
  label: string
  sourceAccountIds: string[]
  sourcePolicy: string
  baseline: { transferCount: number; accountCount: number; reachableAccountIds: string[] }
  scenarios: SimulationScenario[]
  comparison: { additionalInterruptedTransferIds: string[]; additionalUnreachableAccountIds: string[] } | null
  method: string
}

export async function sendControl(control: Control): Promise<void> {
  const response = await fetch('/v1/replay/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(control),
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Replay control failed (${response.status})`)
}

export async function simulateHolds(input: {
  caseId: string
  heldAccountIds: string[]
  compareHeldAccountIds: string[]
  sourceAccountIds?: string[]
  expectedCursor: number
}): Promise<SimulationResult> {
  const response = await fetch('/v1/interventions/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => ({})) as SimulationResult & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Hold simulation failed (${response.status})`)
  return body
}
