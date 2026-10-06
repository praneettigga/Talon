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
}

export type Control =
  | { action: 'start' | 'pause' | 'reset' }
  | { action: 'speed'; speed: ReplaySpeed };
