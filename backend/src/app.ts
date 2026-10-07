import express from 'express';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { controlSchema, simulationSchema } from './contracts.js';
import { Replay } from './replay.js';
import { missingCaseEvaluation, type CaseEvaluation } from './evaluation.js';
import { PythonWorker } from './worker.js';

const uploadRoot = fileURLToPath(new URL('../../data/uploads/current', import.meta.url));
const permittedUploadFiles = new Set(['HI-Small_Trans.csv', 'HI-Small_accounts.csv', 'HI-Small_Patterns.txt', 'HI-Medium_Trans.csv', 'HI-Medium_accounts.csv', 'HI-Medium_Patterns.txt']);

async function prepareUploadedReplay() {
  const python = process.env.TALON_PYTHON ?? (existsSync(fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)))
    ? fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)) : 'python3');
  return await new Promise<{ schemaVersion: 1; dataset: string; sourceSha256: string; events: unknown[]; enabledTypologies: string[]; modelsDirectory: string }>((resolve, reject) => {
    const child = spawn(python, ['-m', 'backend.python.import_dataset', uploadRoot], { cwd: fileURLToPath(new URL('../../', import.meta.url)) });
    let output = ''; let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) { reject(new Error(errors.trim() || 'Could not prepare the uploaded dataset.')); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Dataset preparation returned invalid data.')); }
    });
  });
}

export function createApp(replay: Replay, caseEvaluation: CaseEvaluation = missingCaseEvaluation) {
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.post('/v1/datasets/reset-upload', async (_request, response) => {
    try { await rm(uploadRoot, { recursive: true, force: true }); response.status(204).end(); }
    catch (error) { response.status(500).json({ error: `Could not clear prior upload: ${(error as Error).message}` }); }
  });
  app.put('/v1/datasets/files/:name', async (request, response) => {
    const name = request.params.name;
    if (!permittedUploadFiles.has(name)) { response.status(400).json({ error: 'Choose AMLWorld HI-Small or HI-Medium CSV/TXT source files.' }); return; }
    const announced = Number(request.header('content-length') ?? 0);
    if (!Number.isFinite(announced) || announced < 1 || announced > 4_000_000_000) { response.status(413).json({ error: 'The uploaded file is empty or exceeds the 4 GB per-file limit.' }); return; }
    await mkdir(uploadRoot, { recursive: true });
    const staged = `${uploadRoot}/.${name}.upload`;
    try {
      await pipeline(request, createWriteStream(staged, { flags: 'w' }));
      await rename(staged, `${uploadRoot}/${name}`);
      response.status(201).json({ name, bytes: announced });
    } catch (error) { await rm(staged, { force: true }); response.status(500).json({ error: `Could not save ${name}: ${(error as Error).message}` }); }
  });
  app.post('/v1/datasets/prepare', async (_request, response) => {
    try {
      const prepared = await prepareUploadedReplay();
      const artifact = { schemaVersion: prepared.schemaVersion, dataset: prepared.dataset, sourceSha256: prepared.sourceSha256, events: prepared.events };
      // Parse through the normal runtime schema before replacing the shared replay.
      const { artifactSchema } = await import('./contracts.js');
      const validArtifact = artifactSchema.parse(artifact);
      const worker = new PythonWorker();
      try {
        const intelligence = await worker.initialize(validArtifact.sourceSha256, prepared.modelsDirectory, { manifest: null, enabledTypologies: prepared.enabledTypologies });
        if (intelligence.models.status !== 'ready') throw new Error(intelligence.models.error ?? 'Uploaded dataset model could not be loaded');
        caseEvaluation = { status: 'unavailable', error: 'Case reconstruction evaluation has not been prepared for this uploaded run.' };
        response.json(await replay.replace(validArtifact, worker, intelligence));
      } catch (error) { worker.close(); throw error; }
    } catch (error) { response.status(400).json({ error: (error as Error).message }); }
  });
  app.get('/v1/health', (_request, response) => {
    const snapshot = replay.snapshot();
    response.json({ status: 'ok', milestone: 6, caseEvaluation: caseEvaluation.status, replay: snapshot.status, intelligence: snapshot.intelligence.status,
      models: snapshot.intelligence.models.status, enrichment: snapshot.intelligence.enrichment.status });
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
      response.status(400).json({ error: 'Expected action start, pause, reset, or speed with speed 1, 5, 20, or 30.' });
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
    response.json({ ...intelligence.entityRisks[request.params.id], modelStatus: intelligence.models.status, features,
      evidence: intelligence.cases.flatMap(item => item.evidence).filter(finding => finding.accountIds.includes(request.params.id)),
      explanation: 'Entity risk is a time-decayed transaction-score maximum. Roles do not establish suspicion.' });
  });
  app.get('/v1/evaluation', (_request, response) => {
    const models = replay.snapshot().intelligence.models;
    if (models.status !== 'ready') { response.status(503).json({ status: 'unavailable', error: models.error }); return; }
    response.json(models.evaluation);
  });
  app.get('/v1/evaluation/cases', (_request, response) => {
    response.status(caseEvaluation.status === 'ready' ? 200 : 503).json(caseEvaluation);
  });
  app.post('/v1/interventions/simulate', async (request, response) => {
    const parsed = simulationSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Expected caseId and unique heldAccountIds; optional comparison must include the initial holds, with observed sourceAccountIds and expectedCursor.' }); return; }
    try { response.json(await replay.simulate(parsed.data)); }
    catch (error) {
      const failure = error as Error & { status?: number };
      response.status(failure.status ?? 503).json({ error: failure.message });
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
