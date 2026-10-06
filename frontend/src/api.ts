export type ReplayStatus = 'paused' | 'running' | 'completed' | 'unavailable';
export type ReplaySpeed = 1 | 5 | 20;

export interface ReplayEvent {
  id: string;
  sourceRow: number;
  timestamp: string;
  fromBank: string;
  fromAccount: string;
  toBank: string;
  toAccount: string;
  amountReceived: string;
  receivingCurrency: string;
  amountPaid: string;
  paymentCurrency: string;
  paymentFormat: string;
}

export interface Snapshot {
  status: ReplayStatus;
  speed: ReplaySpeed;
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

export type Control =
  | { action: 'start' | 'pause' | 'reset' }
  | { action: 'speed'; speed: ReplaySpeed };
