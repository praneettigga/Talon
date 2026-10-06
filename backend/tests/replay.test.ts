import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { artifactSchema, type Artifact } from '../src/contracts.js';
import { Replay } from '../src/replay.js';
import { createApp } from '../src/app.js';

const artifact: Artifact = { schemaVersion: 1, dataset: 'Test fixture', sourceSha256: 'a'.repeat(64),
  events: [1, 2, 3].map(sourceRow => ({ id: `hi-small:${sourceRow}`, sourceRow,
    timestamp: '2022-09-01T00:00:00', fromBank: '01', fromAccount: 'A', toBank: '02', toAccount: 'B',
    amountPaid: '10.00', amountReceived: '10.00', paymentCurrency: 'USD', receivingCurrency: 'USD', paymentFormat: 'ACH' })) };

test('start is idempotent, pause freezes time, speed takes effect, reset repeats identical events', context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const replay = new Replay(artifact);
  context.after(() => replay.dispose());
  const initial = replay.snapshot();
  replay.control({ action: 'start' }); replay.control({ action: 'start' });
  context.mock.timers.tick(1000);
  assert.equal(replay.snapshot().cursor, 1);
  replay.control({ action: 'pause' });
  context.mock.timers.tick(10000);
  assert.equal(replay.snapshot().cursor, 1);
  replay.control({ action: 'speed', speed: 20 }); replay.control({ action: 'start' });
  context.mock.timers.tick(50);
  assert.equal(replay.snapshot().cursor, 2);
  context.mock.timers.tick(50);
  const completed = replay.snapshot();
  assert.equal(completed.status, 'completed');
  assert.throws(() => replay.control({ action: 'start' }), /Reset/);
  replay.control({ action: 'reset' });
  assert.deepEqual(replay.snapshot(), initial);
  replay.control({ action: 'start' });
  replay.advance(); replay.advance(); replay.advance();
  assert.deepEqual(replay.snapshot().events, completed.events);
});

test('new subscribers get only the current prefix; reset clears observers', () => {
  const replay = new Replay(artifact);
  replay.control({ action: 'start' }); replay.advance(); replay.control({ action: 'pause' });
  const frames: number[] = [];
  const off = replay.subscribe(snapshot => frames.push(snapshot.events.length));
  replay.control({ action: 'reset' }); off(); replay.control({ action: 'start' }); replay.advance();
  assert.deepEqual(frames, [1, 0]);
  replay.dispose();
});

test('runtime contract rejects labels, duplicate IDs, and unordered rows', () => {
  assert.equal(artifactSchema.safeParse(artifact).success, true);
  for (const events of [
    [{ ...artifact.events[0], laundering: 1 }],
    [artifact.events[0], artifact.events[0]], [...artifact.events].reverse(),
  ]) assert.equal(artifactSchema.safeParse({ ...artifact, events }).success, false);
});

test('HTTP controls, SSE reconnect and invalid/unavailable states', async context => {
  const replay = new Replay(artifact);
  const server = createApp(replay).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { replay.dispose(); server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const command = (body: unknown) => fetch(`${base}/v1/replay/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await command({ action: 'speed', speed: 0 })).status, 400);
  assert.equal((await command({ action: 'start', speed: 20 })).status, 400);
  assert.equal((await command({ action: 'start' })).status, 200);
  replay.advance();
  await command({ action: 'pause' });
  const current = await (await fetch(`${base}/v1/events`)).json();
  assert.equal(current.events.length, 1);
  const controller = new AbortController();
  const stream = await fetch(`${base}/v1/events/stream`, { signal: controller.signal });
  assert.match(stream.headers.get('content-type')!, /text\/event-stream/);
  const reader = stream.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: snapshot/); assert.match(first, /"cursor":1/);
  await command({ action: 'reset' });
  const reset = new TextDecoder().decode((await reader.read()).value);
  assert.match(reset, /"events":\[\]/);
  controller.abort();
  const missing = new Replay(null, 'Prepare data');
  assert.equal(missing.snapshot().status, 'unavailable');
  assert.throws(() => missing.control({ action: 'start' }), /Prepare data/);
});
