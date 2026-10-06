import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadReplayInput, Replay } from '../src/replay.js';
import { PythonWorker, unavailable, type IntelligenceWorker } from '../src/worker.js';
import type { Artifact, IntelligenceSnapshot, InvestigationCase, SimulationResult } from '../src/contracts.js';

const event = (n: number, from: string, to: string) => ({ id: `hi-small:${n}`, sourceRow: n,
  timestamp: `2022-09-01T00:0${n}:00`, fromBank: '001', fromAccount: from, toBank: '001', toAccount: to,
  amountPaid: '10.00', amountReceived: '10.00', paymentCurrency: 'USD', receivingCurrency: 'USD', paymentFormat: 'ACH' });
const empty: IntelligenceSnapshot = { ...unavailable(''), status: 'ready', error: null };

test('real worker HTTP comparison is deterministic, alias-aware, and never mutates the observed snapshot', async context => {
  const manifest = JSON.parse(await readFile(new URL('../../docs/data/hi-small-manifest.json', import.meta.url), 'utf8'));
  const worker = new PythonWorker(); context.after(() => worker.close());
  const initial = await worker.initialize(manifest.files['HI-Small_Trans.csv'].sha256);
  const artifact: Artifact = { schemaVersion: 1, dataset: 'Explicit artificial parallel-route fixture',
    sourceSha256: manifest.files['HI-Small_Trans.csv'].sha256,
    events: [event(1, 'A', 'M1'), event(2, 'A', 'M2'), event(3, 'M1', 'X'), event(4, 'M2', 'X')] };
  const replay = new Replay(artifact, null, worker, initial); context.after(() => replay.dispose());
  replay.control({ action: 'start' });
  for (const _event of artifact.events) await replay.advance();
  const before = structuredClone(replay.snapshot());
  const investigation = before.intelligence.cases.find(item => item.typologies.includes('SCATTER-GATHER'))!;
  assert.ok(investigation); assert.ok(investigation.mergedCaseIds.length);
  const server = createApp(replay).listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const command = { caseId: investigation.id, heldAccountIds: ['001/M1'], compareHeldAccountIds: ['001/M1', '001/M2'], expectedCursor: 4 };
  const post = (body: unknown) => fetch(`${base}/v1/interventions/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post(command); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.snapshotCursor, 4);
  assert.equal(result.scenarios[0].remainingAlternateRouteCount, 1);
  assert.deepEqual(result.scenarios[1].noLongerReachableAccountIds, ['001/X']);
  assert.deepEqual(replay.snapshot(), before);
  assert.deepEqual(await (await post({ ...command, caseId: investigation.mergedCaseIds[0] })).json(), result);
  for (const bad of [
    { ...command, heldAccountIds: [] }, { ...command, heldAccountIds: ['001/M1', '001/M1'] },
    { ...command, compareHeldAccountIds: ['001/M2'] }, { ...command, execute: true },
  ]) assert.equal((await post(bad)).status, 400);
  assert.equal((await post({ ...command, heldAccountIds: ['001/Unobserved'], compareHeldAccountIds: undefined })).status, 400);
  assert.equal((await post({ ...command, sourceAccountIds: ['001/Unobserved'] })).status, 400);
  assert.equal((await post({ ...command, caseId: 'FutureCase' })).status, 404);
  assert.equal((await post({ ...command, expectedCursor: 3 })).status, 409);
  const selected = await (await post({ ...command, sourceAccountIds: ['001/M1'] })).json();
  assert.deepEqual(selected.sourceAccountIds, ['001/M1']);
  await replay.control({ action: 'reset' });
  assert.equal((await post({ ...command, expectedCursor: undefined })).status, 404);
  replay.control({ action: 'start' });
  for (const _event of artifact.events) await replay.advance();
  assert.deepEqual(await (await post(command)).json(), result);
  worker.close();
  assert.equal((await post(command)).status, 503);
});

test('a comparison completed after reset is rejected instead of returning stale results', async () => {
  const investigation: InvestigationCase = { id: 'case-fixture', firstSeen: '2022-09-01T00:02:00', lastSeen: '2022-09-01T00:02:00',
    findingIds: [], transactionIds: ['hi-small:1', 'hi-small:2'], typologies: ['FAN-OUT'], mergedCaseIds: [],
    entities: ['A', 'B', 'C'].map(id => ({ id: `001/${id}`, roles: ['counterparty'], suspect: false })),
    severity: 'LOW', severityInputs: { corroboratedSignals: 0, structuralFindings: 1, affectedEntities: 3, typologies: ['FAN-OUT'],
      highestEntityRisk: null, signalTypes: [], reviewThreshold: null, asOf: '2022-09-01T00:02:00' },
    severityReason: 'Explicit race-control fixture', evidence: [], connections: [], timeline: [] };
  let finish!: (result: SimulationResult) => void;
  let eventsSeen = 0;
  const worker: IntelligenceWorker = { event: async () => ++eventsSeen === 2 ? { ...empty, cases: [investigation] } : empty,
    reset: async () => empty, close: () => {}, simulate: async snapshot => {
      assert.equal(snapshot.snapshotCursor, 2); assert.equal(snapshot.events.length, 2);
      return new Promise(resolve => { finish = resolve; });
    } };
  const replay = new Replay({ schemaVersion: 1, dataset: 'Fixture', sourceSha256: 'a'.repeat(64),
    events: [event(1, 'A', 'B'), event(2, 'A', 'C')] }, null, worker, empty);
  replay.control({ action: 'start' }); await replay.advance(); await replay.advance();
  const pending = replay.simulate({ caseId: investigation.id, heldAccountIds: ['001/A'] });
  const rejected = assert.rejects(pending, /reset during comparison/);
  await replay.control({ action: 'reset' });
  finish({} as SimulationResult); await rejected;
  assert.equal(replay.snapshot().cursor, 0); assert.deepEqual(replay.snapshot().intelligence.cases, []);
  replay.dispose();
});

test('simulation is unavailable when the intelligence worker is absent', async () => {
  const replay = new Replay({ schemaVersion: 1, dataset: 'Fixture', sourceSha256: 'a'.repeat(64), events: [event(1, 'A', 'B')] });
  await assert.rejects(replay.simulate({ caseId: 'unknown', heldAccountIds: ['001/A'] }), /worker unavailable/);
  replay.dispose();
});

test('real replay binding exposes observed synthetic context only and preserves model decisions', async context => {
  let input;
  try {
    input = await loadReplayInput(new URL('../../data/replay/replay.json', import.meta.url).pathname);
    await readFile(new URL('../../data/replay/talon_device_context.csv', import.meta.url));
  } catch { context.skip('Run models:replay or enrichment:prepare for real-data acceptance'); return; }
  const enriched = new PythonWorker(), plain = new PythonWorker();
  context.after(() => { enriched.close(); plain.close(); });
  const initial = await enriched.initialize(input.artifact.sourceSha256, undefined, { replaySha256: input.sha256 });
  assert.equal(initial.enrichment.status, 'ready'); assert.deepEqual(initial.enrichment.accounts, {});
  const noContext = await plain.initialize(input.artifact.sourceSha256);
  assert.equal(noContext.enrichment.status, 'unavailable');
  let prior: IntelligenceSnapshot | null = null;
  let latest = initial;
  for (const event of input.artifact.events) {
    const withContext = await enriched.event(event);
    const without = await plain.event(event);
    assert.deepEqual(withContext.decisions.at(-1)!.risk, without.decisions.at(-1)!.risk);
    assert.deepEqual(withContext.cases, without.cases);
    if (prior) assert.deepEqual(withContext.decisions.slice(0, prior.decisions.length), prior.decisions);
    assert.ok(Object.values(withContext.enrichment.accounts).every(row => row.firstSeen <= event.timestamp && withContext.entities[row.accountId]));
    assert.equal(withContext.enrichment.usedInRiskModel, false); assert.equal(withContext.enrichment.affectsSeverity, false);
    prior = withContext; latest = withContext;
  }
  assert.ok(latest.enrichment.links.some(link => link.kind === 'network' && link.scenarios.includes('shared-network control') && !link.supportsStructure));
  assert.ok(latest.enrichment.links.some(link => link.kind === 'device' && link.supportsStructure));
  const prefixDecision = latest.decisions[0];
  await enriched.reset();
  const again = await enriched.event(input.artifact.events[0]);
  assert.deepEqual(again.decisions[0], prefixDecision);
  const stale = new PythonWorker(); context.after(() => stale.close());
  const mismatched = await stale.initialize(input.artifact.sourceSha256, undefined, { replaySha256: '0'.repeat(64) });
  assert.equal(mismatched.status, 'ready'); assert.equal(mismatched.enrichment.status, 'unavailable');
  assert.match(mismatched.enrichment.error!, /hash mismatch/);
});
