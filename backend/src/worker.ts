import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { FrozenSimulation, IntelligenceSnapshot, ReplayEvent, SimulationResult } from './contracts.js';

export interface IntelligenceWorker {
  event(event: ReplayEvent): Promise<IntelligenceSnapshot>;
  reset(): Promise<IntelligenceSnapshot>;
  simulate?(snapshot: FrozenSimulation): Promise<SimulationResult>;
  close(): void;
}

export const unavailable = (error: string): IntelligenceSnapshot => ({
  status: 'unavailable', error, cases: [], entities: {}, decisions: [], enabledTypologies: [],
  ruleWindow: '7 days', featureWindow: '1 hour',
  entityRisks: {}, models: { status: 'unavailable', error, version: null, graphModel: 'IBM Multi-GNN GIN',
    availableFrom: null, reviewThreshold: null, evaluation: null },
  enrichment: { status: 'unavailable', error, label: 'Synthetic Talon enrichment; not supplied by IBM AMLWorld',
    asOf: null, usedInRiskModel: false, affectsSeverity: false, accounts: {}, links: [] },
});

export class PythonWorker implements IntelligenceWorker {
  private process: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private dead = false;
  private pending = new Map<number, { resolve: (data: unknown) => void;
    reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; simulation: boolean }>();
  constructor() {
    const localPython = fileURLToPath(new URL('../../.venv/bin/python', import.meta.url));
    this.process = spawn(process.env.TALON_PYTHON ?? (existsSync(localPython) ? localPython : 'python'), ['-u', '-m', 'backend.python.worker'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'pipe',
    });
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', line => {
      try {
        const reply = JSON.parse(line);
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(reply.id);
        if (reply.error) { pending.reject(new Error(reply.error)); return; }
        const result = reply.result;
        const valid = pending.simulation
          ? result?.status === 'ready' && typeof result.caseId === 'string' && Number.isInteger(result.snapshotCursor) && Array.isArray(result.scenarios)
          : result?.status === 'ready' && result.models && result.entityRisks && result.enrichment && Array.isArray(result.cases) && Array.isArray(result.decisions) &&
            Array.isArray(result.enabledTypologies) && result.entities;
        if (!valid) {
          pending.reject(new Error('Invalid intelligence worker response')); return;
        }
        pending.resolve(result);
      } catch { this.fail(new Error('Invalid worker protocol')); }
    });
    this.process.stderr.on('data', () => { /* Protocol errors are reported through requests. */ });
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', () => { lines.close(); this.fail(new Error('Python intelligence worker exited')); });
    this.process.stdin.on('error', error => this.fail(error));
  }
  private fail(error: Error) {
    this.dead = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  private request<T = IntelligenceSnapshot>(command: Record<string, unknown>): Promise<T> {
    if (this.dead) return Promise.reject(new Error('Intelligence worker unavailable'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('Intelligence worker timed out')); this.process.kill();
      }, 10000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, simulation: command.command === 'simulate' });
      this.process.stdin.write(JSON.stringify({ id, ...command }) + '\n');
    });
  }
  initialize(sourceSha256: string, modelsDirectory?: string, context: { replaySha256?: string; enrichmentPath?: string } = {}) {
    return this.request({ command: 'init', sourceSha256,
      modelsDirectory: modelsDirectory ?? process.env.TALON_MODELS_DIR ?? fileURLToPath(new URL('../../data/models/current', import.meta.url)),
      replaySha256: context.replaySha256,
      enrichmentPath: context.enrichmentPath ?? process.env.TALON_ENRICHMENT_FILE ?? fileURLToPath(new URL('../../data/replay/talon_device_context.csv', import.meta.url)),
      manifest: fileURLToPath(new URL('../../docs/data/hi-small-manifest.json', import.meta.url)) });
  }
  event(event: ReplayEvent) { return this.request({ command: 'event', event }); }
  reset() { return this.request({ command: 'reset' }); }
  simulate(snapshot: FrozenSimulation) { return this.request<SimulationResult>({ command: 'simulate', snapshot }); }
  close() { this.fail(new Error('Worker stopped')); this.process.kill(); }
}
