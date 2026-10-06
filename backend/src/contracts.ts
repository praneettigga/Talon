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
}
