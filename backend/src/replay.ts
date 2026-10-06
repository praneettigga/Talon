import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { artifactSchema, type Artifact, type Control, type Snapshot } from './contracts.js';
import { unavailable, type IntelligenceWorker } from './worker.js';
import type { IntelligenceSnapshot } from './contracts.js';
import type { SimulationCommand } from './contracts.js';

export async function loadArtifact(path: string): Promise<Artifact> {
  return (await loadReplayInput(path)).artifact;
}
export async function loadReplayInput(path: string) {
  const bytes = await readFile(path);
  return { artifact: artifactSchema.parse(JSON.parse(bytes.toString('utf8'))),
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

export class Replay {
  private cursor = 0;
  private speed = 1;
  private status: Snapshot['status'];
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private intelligence: IntelligenceSnapshot;
  private busy = false;
  private generation = 0;
  private resetting = false;
  private pausing = false;
  constructor(private artifact: Artifact | null, private error: string | null = null,
    private worker?: IntelligenceWorker, initial?: IntelligenceSnapshot) {
    this.status = artifact ? 'paused' : 'unavailable';
    this.intelligence = initial ?? unavailable('Intelligence worker not configured');
  }
  snapshot(): Snapshot {
    return {
      status: this.status, speed: this.speed, cursor: this.cursor,
      total: this.artifact?.events.length ?? 0,
      eventTime: this.artifact?.events[this.cursor - 1]?.timestamp ?? null,
      dataset: this.artifact?.dataset ?? 'IBM AMLWorld HI-Small synthetic AML benchmark',
      error: this.error, events: this.artifact?.events.slice(0, this.cursor) ?? [],
      intelligence: this.intelligence,
    };
  }
  subscribe(listener: (snapshot: Snapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  private publish() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => { void this.advance(); }, 1000 / this.speed);
  }
  async advance() {
    if (this.status !== 'running' || !this.artifact || this.busy) return;
    const generation = this.generation;
    this.busy = true;
    if (this.worker) {
      try {
        const result = await this.worker.event(this.artifact.events[this.cursor]);
        if (generation !== this.generation || this.status !== 'running') { this.busy = false; return; }
        this.intelligence = result;
      } catch (error) {
        if (generation === this.generation) {
          this.stopTimer(); this.status = 'paused';
          this.intelligence = unavailable((error as Error).message); this.publish();
        }
        this.busy = false; return;
      }
    }
    this.cursor += 1;
    this.busy = false;
    if (this.cursor === this.artifact.events.length) {
      this.status = 'completed';
      this.stopTimer();
    }
    this.publish();
  }
  control(command: Control) {
    if (!this.artifact) throw new Error(this.error ?? 'Replay data unavailable');
    if (this.resetting) throw new Error('Reset in progress. Wait for the worker to finish.');
    if (this.pausing) throw new Error('Pause in progress. Wait for the current event to finish.');
    switch (command.action) {
      case 'start':
        if (this.status === 'completed') throw new Error('Replay completed. Reset to replay again.');
        if (this.status !== 'running') { this.status = 'running'; this.startTimer(); }
        break;
      case 'pause':
        this.stopTimer();
        // An in-flight event is committed before pause completes.
        if (this.busy) { this.pausing = true; return this.waitThenPause(); }
        if (this.status !== 'completed') this.status = 'paused';
        break;
      case 'reset':
        this.generation += 1;
        this.stopTimer(); this.cursor = 0; this.speed = 1; this.status = 'paused';
        if (this.worker) { this.resetting = true; return this.resetIntelligence(); }
        break;
      case 'speed':
        this.speed = command.speed;
        if (this.status === 'running') this.startTimer();
        break;
    }
    this.publish();
    return this.snapshot();
  }
  private async waitThenPause() {
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 5));
    this.pausing = false;
    if (this.status !== 'completed') this.status = 'paused';
    this.publish(); return this.snapshot();
  }
  private async resetIntelligence() {
    try { this.intelligence = await this.worker!.reset(); }
    catch (error) { this.intelligence = unavailable((error as Error).message); }
    this.busy = false; this.resetting = false; this.publish(); return this.snapshot();
  }
  async simulate(command: SimulationCommand) {
    const failed = (status: number, message: string) => Object.assign(new Error(message), { status });
    const snapshot = this.snapshot();
    if (this.resetting) throw failed(409, 'Reset in progress. Compare after reset completes.');
    if (snapshot.intelligence.status !== 'ready' || !this.worker?.simulate) throw failed(503, 'Simulation worker unavailable');
    if (command.expectedCursor !== undefined && command.expectedCursor !== snapshot.cursor) throw failed(409, 'Replay changed. Refresh the comparison.');
    const investigation = snapshot.intelligence.cases.find(item => item.id === command.caseId || item.mergedCaseIds.includes(command.caseId));
    if (!investigation) throw failed(404, 'Case not found in observed replay');
    const members = new Set(investigation.entities.map(entity => entity.id));
    if ([...command.heldAccountIds, ...(command.compareHeldAccountIds ?? []), ...(command.sourceAccountIds ?? [])].some(id => !members.has(id))) {
      throw failed(400, 'Hold/source accounts must belong to the observed case');
    }
    const generation = this.generation;
    const result = await this.worker.simulate({ ...command, case: investigation,
      events: snapshot.events.filter(event => investigation.transactionIds.includes(event.id)),
      observedAt: snapshot.eventTime!, snapshotCursor: snapshot.cursor });
    if (generation !== this.generation) throw failed(409, 'Replay reset during comparison. Run the comparison again.');
    return result;
  }
  dispose() { this.generation += 1; this.stopTimer(); this.worker?.close(); this.listeners.clear(); }
}
