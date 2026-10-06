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
    if (ids.has(event.id) || rows.has(event.sourceRow) || event.id !== `hi-small:${event.sourceRow}` ||
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
  z.object({ action: z.literal('speed'), speed: z.union([z.literal(1), z.literal(5), z.literal(20)]) }).strict(),
]);
export type ReplayEvent = z.infer<typeof eventSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Control = z.infer<typeof controlSchema>;
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
    typologies: string[]; highestEntityRisk: number | null };
  severityReason: string; evidence: Finding[];
  connections: { findingId: string; priorFindingId: string; via: string; sharedIds: string[]; observedAt: string }[];
  timeline: { timestamp: string; findingId: string; stage: string; severity: string;
    linkedTransactions: number; facts: string[] }[];
}
export interface IntelligenceSnapshot {
  status: 'ready' | 'unavailable'; error: string | null;
  enabledTypologies: string[]; ruleWindow: string; featureWindow: string;
  cases: InvestigationCase[]; entities: Record<string, AccountFeatures>;
  decisions: { transactionId: string; timestamp: string; features: AccountFeatures[] }[];
}
