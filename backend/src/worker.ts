import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { IntelligenceSnapshot, ReplayEvent } from './contracts.js';

export interface IntelligenceWorker {
  event(event: ReplayEvent): Promise<IntelligenceSnapshot>;
  reset(): Promise<IntelligenceSnapshot>;
  close(): void;
}

export const unavailable = (error: string): IntelligenceSnapshot => ({
  status: 'unavailable', error, cases: [], entities: {}, decisions: [], enabledTypologies: [],
  ruleWindow: '7 days', featureWindow: '1 hour',
});

export class PythonWorker implements IntelligenceWorker {
  private process: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private dead = false;
  private pending = new Map<number, { resolve: (data: IntelligenceSnapshot) => void;
    reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor() {
    this.process = spawn(process.env.TALON_PYTHON ?? 'python', ['-u', '-m', 'backend.python.worker'], {
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
        if (result?.status !== 'ready' || !Array.isArray(result.cases) || !Array.isArray(result.decisions) ||
            !Array.isArray(result.enabledTypologies) || !result.entities) {
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
  private request(command: Record<string, unknown>): Promise<IntelligenceSnapshot> {
    if (this.dead) return Promise.reject(new Error('Intelligence worker unavailable'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('Intelligence worker timed out')); this.process.kill();
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, ...command }) + '\n');
    });
  }
  initialize(sourceSha256: string) {
    return this.request({ command: 'init', sourceSha256,
      manifest: fileURLToPath(new URL('../../docs/data/hi-small-manifest.json', import.meta.url)) });
  }
  event(event: ReplayEvent) { return this.request({ command: 'event', event }); }
  reset() { return this.request({ command: 'reset' }); }
  close() { this.fail(new Error('Worker stopped')); this.process.kill(); }
}
