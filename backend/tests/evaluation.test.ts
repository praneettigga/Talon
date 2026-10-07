import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { caseReportSchema, loadCaseEvaluation } from '../src/evaluation.js';
import { Replay } from '../src/replay.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const metrics = { detectedCases: 1, groundTruthAttempts: 1, matched: 1, unmatchedDetected: 0, missedAttempts: 0,
  precision: 1, recall: 1, meanMatchedJaccard: .5,
  matches: [{ caseId: 'case', attemptId: 'attempt', typology: 'FAN-OUT', overlap: 1, caseTransactions: 2, attemptTransactions: 1, jaccard: .5 }],
  unmatchedCaseIds: [], missedAttemptIds: [] };

async function fixture(root: string) {
  const sourceHash = 'a'.repeat(64);
  const frozen = { dataset: { rows: 3 }, test: { rows: 2 }, split: { test: { endExclusive: '2022-09-11T00:00:00' } },
    thresholdSelection: { windowEndExclusive: '2022-09-09T00:00:00' } };
  const sourceFiles = Object.fromEntries(['HI-Small_Trans.csv', 'HI-Small_accounts.csv', 'HI-Small_Patterns.txt'].map(n => [n, sourceHash]));
  const codeHashes = Object.fromEntries(['engine.py', 'signals.py', 'evaluate_cases.py'].map(n => [`backend/python/${n}`, sha(`fixture ${n}`)]));
  const report = { schemaVersion: 1, status: 'ready', dataset: 'Artificial evaluation test fixture', sourceSha256: sourceHash,
    sourceFiles, codeHashes, datasetSha256: sourceHash, transactionEvaluationSha256: sha(JSON.stringify(frozen)), enabledTypologies: ['FAN-OUT'],
    window: { start: frozen.thresholdSelection.windowEndExclusive, endExclusive: frozen.split.test.endExclusive }, warmupEvents: 1, replayedEvents: 3,
    scope: 'Artificial fixture', matching: 'One-to-one overlap', projection: 'Test transfers', limitations: ['Artificial fixture'],
    overall: structuredClone(metrics), byTypology: { 'FAN-OUT': structuredClone(metrics) },
    population: { testTransactions: 2, metricTransactions: 2, excludedTransactions: 0, eligibleAttempts: 1, excludedAttempts: [] } };
  const files: Record<string, string> = {
    'docs/data/hi-small-manifest.json': JSON.stringify({ dataset: report.dataset, enabled_typologies: report.enabledTypologies,
      files: Object.fromEntries(Object.entries(sourceFiles).map(([n, hash]) => [n, { sha256: hash }])) }),
    'docs/data/milestone4-evaluation.json': JSON.stringify(frozen),
    'docs/data/milestone6-evaluation.json': JSON.stringify(report),
    ...Object.fromEntries(Object.keys(codeHashes).map(n => [n, `fixture ${n.split('/').at(-1)}`])),
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content);
  }
  return report;
}

test('case evaluation validates provenance and fails explicitly on stale code, counts, and missing report', async context => {
  const root = await mkdtemp(join(tmpdir(), 'talon-evaluation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const report = await fixture(root);
  const ready = await loadCaseEvaluation(root);
  assert.equal(ready.status, 'ready');
  report.overall.precision = .99;
  assert.equal(caseReportSchema.safeParse(report).success, false);
  await writeFile(join(root, 'backend/python/engine.py'), 'changed');
  const stale = await loadCaseEvaluation(root); assert.equal(stale.status, 'unavailable');
  if (stale.status === 'unavailable') assert.match(stale.error, /code changed/);
  await fixture(root);
  const inputDirectory = join(root, 'data/models/dataset');
  await mkdir(inputDirectory, { recursive: true });
  await writeFile(join(inputDirectory, 'events.json'), 'changed evaluation input');
  const changedInput = await loadCaseEvaluation(root); assert.equal(changedInput.status, 'unavailable');
  if (changedInput.status === 'unavailable') assert.match(changedInput.error, /input changed/);
  await rm(join(inputDirectory, 'events.json'));
  const frozenPath = join(root, 'docs/data/milestone4-evaluation.json');
  await writeFile(frozenPath, (await readFile(frozenPath, 'utf8')) + '\n');
  assert.equal((await loadCaseEvaluation(root)).status, 'unavailable');
  await rm(join(root, 'docs/data/milestone6-evaluation.json'));
  assert.equal((await loadCaseEvaluation(root)).status, 'unavailable');
});

test('case metrics are served independently of learned models and replay, with explicit unavailable response', async context => {
  const root = await mkdtemp(join(tmpdir(), 'talon-evaluation-api-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const report = await fixture(root);
  const replay = new Replay(null, 'Artificial missing replay fixture'); context.after(() => replay.dispose());
  const state = await loadCaseEvaluation(root);
  for (const evaluation of [state, undefined]) {
    const server = createApp(replay, evaluation).listen(0, '127.0.0.1'); await once(server, 'listening');
    context.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/v1/evaluation/cases`);
    assert.equal(response.status, evaluation ? 200 : 503);
    const body = await response.json();
    if (evaluation) assert.deepEqual(body.report, report); else assert.equal(body.status, 'unavailable');
    const health = await (await fetch(`${base}/v1/health`)).json(); assert.equal(health.milestone, 6);
    assert.equal((await fetch(`${base}/v1/evaluation`)).status, 503);
    server.closeAllConnections(); server.close();
  }
});

test('checked-in case reconstruction report is valid and matches the frozen transaction split', async () => {
  const state = await loadCaseEvaluation();
  assert.equal(state.status, 'ready', state.status === 'unavailable' ? state.error : undefined);
  if (state.status !== 'ready') return;
  const frozen = JSON.parse(await readFile(new URL('../../docs/data/milestone4-evaluation.json', import.meta.url), 'utf8'));
  assert.equal(state.report.window.start, frozen.thresholdSelection.windowEndExclusive);
  assert.equal(state.report.population.testTransactions, frozen.test.rows);
  assert.equal(state.report.overall.groundTruthAttempts, state.report.population.eligibleAttempts);
});
