import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const fraction = z.number().min(0).max(1).nullable();
const metric = z.object({
  detectedCases: count, groundTruthAttempts: count, matched: count, unmatchedDetected: count, missedAttempts: count,
  precision: fraction, recall: fraction, meanMatchedJaccard: fraction,
  matches: z.array(z.object({ caseId: z.string(), attemptId: z.string(), typology: z.string(), overlap: count,
    caseTransactions: count, attemptTransactions: count, jaccard: z.number().min(0).max(1) })),
  unmatchedCaseIds: z.array(z.string()), missedAttemptIds: z.array(z.string()),
}).superRefine((m, ctx) => {
  const equal = (a: number | null, b: number | null) => a === b || (a != null && b != null && Math.abs(a - b) < 1e-10);
  if (m.matched > Math.min(m.detectedCases, m.groundTruthAttempts) ||
      m.unmatchedDetected !== m.detectedCases - m.matched || m.missedAttempts !== m.groundTruthAttempts - m.matched ||
      m.matches.length !== m.matched || new Set(m.matches.map(p => p.caseId)).size !== m.matched ||
      new Set(m.matches.map(p => p.attemptId)).size !== m.matched ||
      new Set([...m.matches.map(p => p.caseId), ...m.unmatchedCaseIds]).size !== m.detectedCases ||
      new Set([...m.matches.map(p => p.attemptId), ...m.missedAttemptIds]).size !== m.groundTruthAttempts ||
      m.unmatchedCaseIds.length !== m.unmatchedDetected || m.missedAttemptIds.length !== m.missedAttempts ||
      !equal(m.precision, m.detectedCases ? m.matched / m.detectedCases : null) ||
      !equal(m.recall, m.groundTruthAttempts ? m.matched / m.groundTruthAttempts : null) ||
      !equal(m.meanMatchedJaccard, m.matched ? m.matches.reduce((sum, p) => sum + p.jaccard, 0) / m.matched : null) ||
      m.matches.some(p => p.overlap === 0 || p.overlap > Math.min(p.caseTransactions, p.attemptTransactions) ||
        !equal(p.jaccard, p.overlap / (p.caseTransactions + p.attemptTransactions - p.overlap)))) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent case evaluation counts or matching' });
  }
});
export const caseReportSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal('ready'), dataset: z.string(), sourceSha256: hash,
  sourceFiles: z.record(z.string(), hash), datasetSha256: hash, codeHashes: z.record(z.string(), hash),
  transactionEvaluationSha256: hash, enabledTypologies: z.array(z.string()),
  window: z.object({ start: z.string(), endExclusive: z.string() }), warmupEvents: count, replayedEvents: count,
  scope: z.string(), matching: z.string(), projection: z.string(), limitations: z.array(z.string()),
  overall: metric, byTypology: z.record(z.string(), metric),
  population: z.object({ testTransactions: count, metricTransactions: count, excludedTransactions: count,
    eligibleAttempts: count, excludedAttempts: z.array(z.object({ id: z.string(), typology: z.string(), reason: z.string() })) }),
});
export type CaseReport = z.infer<typeof caseReportSchema>;
export type CaseEvaluation = { status: 'ready'; report: CaseReport } | { status: 'unavailable'; error: string };
export const missingCaseEvaluation = { status: 'unavailable' as const, error: 'Case evaluation not prepared. Run npm run evaluation:cases, then restart the API.' };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function loadCaseEvaluation(root = fileURLToPath(new URL('../../', import.meta.url)), reportPath = `${root}/docs/data/milestone6-evaluation.json`): Promise<CaseEvaluation> {
  try {
    const report = caseReportSchema.parse(JSON.parse(await readFile(reportPath, 'utf8')));
    const manifest = JSON.parse(await readFile(`${root}/docs/data/hi-small-manifest.json`, 'utf8'));
    const frozenBytes = await readFile(`${root}/docs/data/milestone4-evaluation.json`);
    const frozen = JSON.parse(frozenBytes.toString());
    const codeFiles = ['backend/python/engine.py', 'backend/python/signals.py', 'backend/python/evaluate_cases.py'];
    const sourceFiles = ['HI-Small_Trans.csv', 'HI-Small_accounts.csv', 'HI-Small_Patterns.txt'];
    if (report.dataset !== manifest.dataset || report.sourceSha256 !== manifest.files[sourceFiles[0]].sha256 ||
        sourceFiles.some(name => report.sourceFiles[name] !== manifest.files[name].sha256) ||
        JSON.stringify(report.enabledTypologies) !== JSON.stringify(manifest.enabled_typologies) ||
        JSON.stringify(Object.keys(report.byTypology).sort()) !== JSON.stringify([...report.enabledTypologies].sort()) ||
        report.window.start !== frozen.thresholdSelection.windowEndExclusive || report.window.endExclusive !== frozen.split.test.endExclusive ||
        report.transactionEvaluationSha256 !== sha256(frozenBytes) || report.replayedEvents !== frozen.dataset.rows ||
        report.population.testTransactions !== frozen.test.rows || report.warmupEvents + report.population.testTransactions !== report.replayedEvents ||
        report.population.metricTransactions + report.population.excludedTransactions !== report.population.testTransactions ||
        report.population.eligibleAttempts !== report.overall.groundTruthAttempts || Object.keys(report.codeHashes).length !== codeFiles.length) {
      throw new Error('Case evaluation source, split, or population mismatch');
    }
    for (const name of codeFiles) {
      if (report.codeHashes[name] !== sha256(await readFile(`${root}/${name}`))) throw new Error('Case evaluation code changed; regenerate report');
    }
    try {
      const input = await readFile(`${root}/data/models/dataset/events.json`);
      if (report.datasetSha256 !== sha256(input)) throw new Error('Case evaluation input changed; regenerate report');
    } catch (error) {
      // A checked-in historical report remains usable without the local derived dataset.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return { status: 'ready', report };
  } catch (error) {
    return { status: 'unavailable', error: `${missingCaseEvaluation.error} ${(error as Error).message}` };
  }
}
