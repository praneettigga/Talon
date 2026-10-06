import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { PythonWorker, unavailable, type IntelligenceWorker } from '../src/worker.js';
import { Replay } from '../src/replay.js';
import { createApp } from '../src/app.js';
import type { Artifact, IntelligenceSnapshot } from '../src/contracts.js';

const event = (n: number, target = 'B') => ({ id: `hi-small:${n}`, sourceRow: n, timestamp: `2022-09-01T00:0${n}:00`,
  fromBank: '001', fromAccount: 'A', toBank: '001', toAccount: target, amountPaid: '10.00', amountReceived: '10.00',
  paymentCurrency: 'USD', receivingCurrency: 'USD', paymentFormat: 'ACH' });
const empty: IntelligenceSnapshot = { ...unavailable(''), status: 'ready', error: null };

test('real Python worker produces evidence, preserves feature prefixes, and resets identical cases', async context => {
  const manifest = JSON.parse(await readFile(new URL('../../docs/data/hi-small-manifest.json', import.meta.url), 'utf8'));
  const worker = new PythonWorker();
  context.after(() => worker.close());
  const initial = await worker.initialize(manifest.files['HI-Small_Trans.csv'].sha256);
  const artifact: Artifact = { schemaVersion: 1, dataset: 'Fixture', sourceSha256: manifest.files['HI-Small_Trans.csv'].sha256,
    events: [event(1), event(2, 'C'), event(3, 'D')] };
  const replay = new Replay(artifact, null, worker, initial);
  context.after(() => replay.dispose());
  replay.control({ action: 'start' });
  await replay.advance();
  const prefix = replay.snapshot().intelligence.decisions[0];
  await replay.advance(); await replay.advance();
  const completed = replay.snapshot();
  assert.equal(completed.intelligence.status, 'ready');
  assert.equal(completed.intelligence.cases.length, 1);
  assert.equal(completed.intelligence.cases[0].severity, 'LOW');
  assert.deepEqual(completed.intelligence.decisions[0], prefix);
  await replay.control({ action: 'reset' });
  assert.equal(replay.snapshot().intelligence.cases.length, 0);
  replay.control({ action: 'start' });
  await replay.advance(); await replay.advance(); await replay.advance();
  assert.deepEqual(replay.snapshot(), completed);
  const server = createApp(replay).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const caseId = completed.intelligence.cases[0].id;
  assert.equal((await fetch(`${base}/v1/cases/${caseId}`)).status, 200);
  assert.equal((await fetch(`${base}/v1/cases/unknown`)).status, 404);
  const risk = await (await fetch(`${base}/v1/entities/${encodeURIComponent('001/A')}/risk`)).json();
  assert.equal(risk.riskScore, null);
  assert.ok(['historical warmup', 'unavailable'].includes(risk.status));
  assert.deepEqual(await (await fetch(`${base}/v1/events/hi-small:1/features`)).json(), prefix);
  assert.equal((await fetch(`${base}/v1/events/hi-small:99/features`)).status, 404);
});

test('worker errors pause replay and expose unavailable intelligence without committing the event', async () => {
  const worker: IntelligenceWorker = { event: async () => { throw new Error('Worker failed'); }, reset: async () => empty, close: () => {} };
  const replay = new Replay({ schemaVersion: 1, dataset: 'Fixture', sourceSha256: 'a'.repeat(64), events: [event(1)] }, null, worker, empty);
  replay.control({ action: 'start' }); await replay.advance();
  assert.equal(replay.snapshot().cursor, 0);
  assert.equal(replay.snapshot().status, 'paused');
  assert.equal(replay.snapshot().intelligence.status, 'unavailable');
  assert.match(replay.snapshot().intelligence.error!, /Worker failed/);
  replay.dispose();
});

test('reset during an in-flight worker response never publishes the discarded event', async () => {
  let complete!: (result: IntelligenceSnapshot) => void;
  let finishReset!: (result: IntelligenceSnapshot) => void;
  const worker: IntelligenceWorker = {
    event: () => new Promise(resolve => { complete = resolve; }),
    reset: () => new Promise(resolve => { finishReset = resolve; }), close: () => {},
  };
  const replay = new Replay({ schemaVersion: 1, dataset: 'Fixture', sourceSha256: 'a'.repeat(64), events: [event(1)] }, null, worker, empty);
  replay.control({ action: 'start' }); const pending = replay.advance();
  const resetting = replay.control({ action: 'reset' });
  assert.throws(() => replay.control({ action: 'start' }), /Reset in progress/);
  complete(empty); await pending; finishReset(empty); await resetting;
  assert.equal(replay.snapshot().cursor, 0); assert.equal(replay.snapshot().status, 'paused');
  replay.dispose();
});

test('manifest hash mismatch fails initialization explicitly', async context => {
  const worker = new PythonWorker(); context.after(() => worker.close());
  await assert.rejects(worker.initialize('0'.repeat(64)), /source hash/);
});

test('pause waits for the in-flight event and does not permit conflicting controls', async () => {
  let complete!: (result: IntelligenceSnapshot) => void;
  const worker: IntelligenceWorker = { event: () => new Promise(resolve => { complete = resolve; }),
    reset: async () => empty, close: () => {} };
  const replay = new Replay({ schemaVersion: 1, dataset: 'Fixture', sourceSha256: 'a'.repeat(64), events: [event(1), event(2)] }, null, worker, empty);
  replay.control({ action: 'start' }); const pending = replay.advance();
  const paused = replay.control({ action: 'pause' });
  assert.throws(() => replay.control({ action: 'reset' }), /Pause in progress/);
  complete(empty); await pending; await paused;
  assert.equal(replay.snapshot().cursor, 1);
  assert.equal(replay.snapshot().status, 'paused');
  replay.dispose();
});

test('missing model artifacts preserve structures but expose explicit unavailable risk and evaluation', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'talon-missing-models-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(new URL('../../docs/data/hi-small-manifest.json', import.meta.url), 'utf8'));
  const worker = new PythonWorker(); context.after(() => worker.close());
  const initial = await worker.initialize(manifest.files['HI-Small_Trans.csv'].sha256, directory);
  assert.equal(initial.status, 'ready'); assert.equal(initial.models.status, 'unavailable');
  assert.ok(initial.models.error);
  const artifact: Artifact = { schemaVersion: 1, dataset: 'Fixture', sourceSha256: manifest.files['HI-Small_Trans.csv'].sha256,
    events: [event(1), event(2, 'C')] };
  const replay = new Replay(artifact, null, worker, initial); context.after(() => replay.dispose());
  replay.control({ action: 'start' }); await replay.advance(); await replay.advance();
  assert.equal(replay.snapshot().intelligence.cases[0].severity, 'LOW');
  assert.equal(replay.snapshot().intelligence.decisions[0].risk.riskScore, null);
  const server = createApp(replay).listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/v1/evaluation`)).status, 503);
});

test('trained artifacts reach risk and frozen evaluation endpoints', async context => {
  let metadata;
  try { metadata = JSON.parse(await readFile(new URL('../../data/models/current/metadata.json', import.meta.url), 'utf8')); }
  catch { context.skip('Run models:train for artifact integration'); return; }
  const worker = new PythonWorker(); context.after(() => worker.close());
  const initial = await worker.initialize(metadata.sourceSha256);
  assert.equal(initial.models.status, 'ready');
  const events = [event(1), event(2, 'C')].map((e, index) => ({ ...e,
    timestamp: metadata.availableFrom.slice(0, 11) + `00:0${index}:00` }));
  const replay = new Replay({ schemaVersion: 1, dataset: 'Fixture', sourceSha256: metadata.sourceSha256, events }, null, worker, initial);
  context.after(() => replay.dispose());
  replay.control({ action: 'start' }); await replay.advance(); await replay.advance();
  const server = createApp(replay).listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const risk = await (await fetch(`${base}/v1/entities/${encodeURIComponent('001/A')}/risk`)).json();
  assert.equal(risk.status, 'scored'); assert.equal(risk.modelStatus, 'ready');
  assert.equal(typeof risk.riskScore, 'number'); assert.equal(typeof risk.ginScore, 'number');
  assert.ok(risk.contributions.length > 0); assert.equal(risk.behaviourScore, null);
  assert.deepEqual(await (await fetch(`${base}/v1/evaluation`)).json(), metadata.evaluation);
});
