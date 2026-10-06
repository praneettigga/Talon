import express from 'express';
import { controlSchema } from './contracts.js';
import { Replay } from './replay.js';

export function createApp(replay: Replay) {
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.get('/v1/health', (_request, response) => {
    response.json({ status: 'ok', milestone: 3, replay: replay.snapshot().status, intelligence: replay.snapshot().intelligence.status });
  });
  app.get('/v1/events', (_request, response) => response.json(replay.snapshot()));
  app.get('/v1/events/:id/features', (request, response) => {
    const intelligence = replay.snapshot().intelligence;
    if (intelligence.status !== 'ready') { response.status(503).json({ error: intelligence.error }); return; }
    const decision = intelligence.decisions.find(item => item.transactionId === request.params.id);
    if (!decision) { response.status(404).json({ error: 'Transaction not yet observed' }); return; }
    response.json(decision);
  });
  app.post('/v1/replay/control', async (request, response) => {
    const parsed = controlSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Expected action start, pause, reset, or speed with speed 1, 5, or 20.' });
      return;
    }
    try { response.json(await replay.control(parsed.data)); }
    catch (error) {
      response.status(replay.snapshot().status === 'unavailable' ? 503 : 409)
        .json({ error: (error as Error).message });
    }
  });
  app.get('/v1/cases', (_request, response) => {
    const intelligence = replay.snapshot().intelligence;
    response.status(intelligence.status === 'ready' ? 200 : 503).json({
      status: intelligence.status, error: intelligence.error, cases: intelligence.cases,
      enabledTypologies: intelligence.enabledTypologies,
    });
  });
  app.get('/v1/cases/:id', (request, response) => {
    const snapshot = replay.snapshot();
    if (snapshot.intelligence.status !== 'ready') { response.status(503).json({ error: snapshot.intelligence.error }); return; }
    const found = snapshot.intelligence.cases.find(item => item.id === request.params.id || item.mergedCaseIds.includes(request.params.id));
    if (!found) { response.status(404).json({ error: 'Case not found in observed replay' }); return; }
    response.json({ ...found, transactions: snapshot.events.filter(event => found.transactionIds.includes(event.id)) });
  });
  app.get('/v1/entities/:id/risk', (request, response) => {
    const intelligence = replay.snapshot().intelligence;
    if (intelligence.status !== 'ready') { response.status(503).json({ error: intelligence.error }); return; }
    const features = intelligence.entities[request.params.id];
    if (!features) { response.status(404).json({ error: 'Entity not observed' }); return; }
    response.json({ id: request.params.id, riskScore: null, modelStatus: 'not trained', features,
      evidence: intelligence.cases.flatMap(item => item.evidence).filter(finding => finding.accountIds.includes(request.params.id)),
      explanation: 'Structural evidence only; risk models are pending milestone 4.' });
  });
  app.get('/v1/events/stream', (request, response) => {
    response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    // Every frame is an authoritative snapshot, including on reconnect/reset.
    // Disconnect slow clients instead of accumulating an unbounded write queue.
    const unsubscribe = replay.subscribe(snapshot => {
      if (response.writableLength > 1_000_000) { response.end(); return; }
      response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
    response.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
  app.use((error: { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid JSON request body.' });
  });
  return app;
}
