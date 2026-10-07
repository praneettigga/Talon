import { z } from 'zod';

const text = z.string().min(1);
const amount = z.string().regex(/^\d+(\.\d+)?$/);
export const eventSchema = z.object({
  id: text, sourceRow: z.number().int().positive(),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/),
  fromBank: text, fromAccount: text, toBank: text, toAccount: text,
  amountReceived: amount, receivingCurrency: text,
  amountPaid: amount, paymentCurrency: text, paymentFormat: text,
}).strict();
export const artifactSchema = z.object({
  schemaVersion: z.literal(1), dataset: text, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  events: z.array(eventSchema).min(1).max(1000),
}).strict().superRefine(({ events }, context) => {
  const ids = new Set<string>();
  const rows = new Set<number>();
  events.forEach((event, index) => {
    const previous = events[index - 1];
    if (ids.has(event.id) || rows.has(event.sourceRow) ||
        (previous && (previous.timestamp > event.timestamp ||
          (previous.timestamp === event.timestamp && previous.sourceRow > event.sourceRow)))) {
      context.addIssue({ code: 'custom', message: 'Events must have unique source IDs and event-time/source-row order' });
    }
    ids.add(event.id); rows.add(event.sourceRow);
  });
});
export const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('reset') }).strict(),
  z.object({ action: z.literal('speed'), speed: z.union([z.literal(1), z.literal(5), z.literal(20), z.literal(30)]) }).strict(),
]);
export type ReplayEvent = z.infer<typeof eventSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Control = z.infer<typeof controlSchema>;
const accounts = z.array(text.max(200)).min(1).max(32).refine(ids => new Set(ids).size === ids.length, 'Account IDs must be unique');
export const simulationSchema = z.object({
  caseId: text.max(100), heldAccountIds: accounts, compareHeldAccountIds: accounts.optional(),
  sourceAccountIds: accounts.optional(), expectedCursor: z.number().int().min(0).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.compareHeldAccountIds && !value.heldAccountIds.every(id => value.compareHeldAccountIds!.includes(id))) {
    context.addIssue({ code: 'custom', message: 'Comparison hold set must include the initial hold set' });
  }
});
export type SimulationCommand = z.infer<typeof simulationSchema>;
export type FrozenSimulation = SimulationCommand & {
  case: InvestigationCase; events: ReplayEvent[]; observedAt: string; snapshotCursor: number;
};
export interface Snapshot {
  status: 'paused' | 'running' | 'completed' | 'unavailable';
  speed: number;
  cursor: number;
  total: number;
  eventTime: string | null;
  dataset: string;
  error: string | null;
  events: ReplayEvent[];
  intelligence: IntelligenceSnapshot;
}
export interface AccountFeatures {
  accountId: string; currency: string; asOf: string; historyCount: number; historyStatus: string;
  incomingCount: number; outgoingCount: number; incomingTotal: string; outgoingTotal: string;
  fanInDegree: number; fanOutDegree: number; fiveMinuteVelocity: number; oneHourVelocity: number;
  amountMean: string | null; amountDeviation: string | null; amountZScore: number | null;
  forwardingRatio: number | null; incomingOutgoingRatio: number | null;
  newCounterparty: boolean; newCounterpartyRate: number; accountAge: null;
}
export interface Finding {
  id: string; typology: string; strength: number; anchors: string[]; accountIds: string[];
  roles: Record<string, string>; transactionIds: string[];
  window: { first: string; last: string; limit: string }; firstSeen: string;
  observedAt: string; facts: string[]; corroborated: boolean;
}
export interface InvestigationCase {
  id: string; firstSeen: string; lastSeen: string; findingIds: string[]; transactionIds: string[];
  typologies: string[]; mergedCaseIds: string[];
  entities: { id: string; roles: string[]; suspect: boolean }[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  severityInputs: { corroboratedSignals: number; structuralFindings: number; affectedEntities: number;
    typologies: string[]; highestEntityRisk: number | null; signalTypes: string[];
    reviewThreshold: number | null; asOf: string };
  severityReason: string; evidence: Finding[];
  connections: { findingId: string; priorFindingId: string; via: string; sharedIds: string[]; observedAt: string }[];
  timeline: { timestamp: string; findingId: string; stage: string; severity: string;
    linkedTransactions: number; facts: string[]; highestEntityRisk?: number | null }[];
}
export interface IntelligenceSnapshot {
  status: 'ready' | 'unavailable'; error: string | null;
  enabledTypologies: string[]; ruleWindow: string; featureWindow: string;
  cases: InvestigationCase[]; entities: Record<string, AccountFeatures>;
  decisions: { transactionId: string; timestamp: string; features: AccountFeatures[]; risk: DecisionRisk; context: DecisionContext }[];
  entityRisks: Record<string, EntityRisk>; models: ModelStatus;
  enrichment: EnrichmentSnapshot;
}
export interface DecisionRisk {
  status: 'scored' | 'historical warmup' | 'unavailable'; reason: string;
  transactionId: string; asOf: string; riskScore: number | null; behaviourScore: number | null;
  ginScore: number | null; behaviourByAccount: Record<string, number | null>;
  contributions: { feature: string; value: number }[]; rawMargin: number | null; baseMargin: number | null;
  inputs: Record<string, number>; ruleScores: Record<string, number>; modelVersion: string | null;
}
export interface EntityRisk extends DecisionRisk {
  id: string; transactionRiskScore: number | null; riskSourceTransactionId: string | null; aggregation: string; riskAsOf: string;
}
export interface DetectionMetrics {
  rows: number; positives: number; threshold: number; precision: number | null; recall: number | null;
  prAuc: number | null; falsePositiveRate: number | null; brierScore: number;
  confusion: { tn: number; fp: number; fn: number; tp: number };
}
export interface EvaluationReport {
  modelVersion: string; test: DetectionMetrics; testReviewGate: DetectionMetrics; limitations: string[];
  split: Record<string, { rows: number; positives: number; endExclusive: string }>;
  thresholdSelection: { reviewThreshold: number; targetFalsePositiveRate: number; metrics: DetectionMetrics };
}
export interface ModelStatus {
  status: 'ready' | 'unavailable'; error: string | null; version: string | null; graphModel: string;
  availableFrom: string | null; reviewThreshold: number | null; evaluation: EvaluationReport | null;
}
export interface DeviceContext {
  accountId: string; deviceId: string; ipCluster: string; location: string; firstSeen: string;
  scenario: 'individual context' | 'shared-network control' | 'shared-device demonstration';
}
export interface InfrastructureLink {
  id: string; kind: 'device' | 'network'; value: string; accountIds: string[]; firstSeen: string;
  observedAt: string; supportingFindingIds: string[]; supportsStructure: boolean; scenarios: string[]; facts: string[];
}
export interface EnrichmentSnapshot {
  status: 'ready' | 'unavailable'; error: string | null; label: string; asOf: string | null;
  usedInRiskModel: false; affectsSeverity: false; accounts: Record<string, DeviceContext>; links: InfrastructureLink[];
}
export interface DecisionContext {
  status: 'ready' | 'unavailable'; label: string; asOf: string; accounts: DeviceContext[]; links: InfrastructureLink[];
}
export interface SimulationScenario {
  name: 'initial' | 'comparison'; heldAccountIds: string[]; interruptedTransferIds: string[]; interruptedTransferCount: number;
  remainingTransferIds: string[]; remainingTransferCount: number; noLongerReachableAccountIds: string[];
  reachableAccountIds: string[]; directlyTouchedAccountIds: string[]; touchedCounterpartyIds: string[];
  remainingRouteCount: number; remainingAlternateRouteCount: number; routesTruncated: boolean;
  remainingRoutes: { destination: string; accountIds: string[]; transactionIds: string[]; alternateToInterruptedBaseline: boolean }[];
}
export interface SimulationResult {
  status: 'ready'; caseId: string; snapshotCursor: number; observedAt: string; label: string;
  sourceAccountIds: string[]; sourcePolicy: string;
  baseline: { transferCount: number; accountCount: number; reachableAccountIds: string[] };
  scenarios: SimulationScenario[];
  comparison: { additionalInterruptedTransferIds: string[]; additionalUnreachableAccountIds: string[] } | null;
  method: string;
}
