import express from 'express';
import { controlSchema } from './contracts.js';
import { Replay } from './replay.js';

export function createApp(replay: Replay) {
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.get('/v1/health', (_request, response) => {
    response.json({ status: 'ok', milestone: 2, replay: replay.snapshot().status });
  });
  app.get('/v1/events', (_request, response) => response.json(replay.snapshot()));
  app.post('/v1/replay/control', (request, response) => {
    const parsed = controlSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Expected action start, pause, reset, or speed with speed 1, 5, or 20.' });
      return;
    }
    try { response.json(replay.control(parsed.data)); }
    catch (error) {
      response.status(replay.snapshot().status === 'unavailable' ? 503 : 409)
        .json({ error: (error as Error).message });
    }
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
