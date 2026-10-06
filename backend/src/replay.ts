import { readFile } from 'node:fs/promises';
import { artifactSchema, type Artifact, type Control, type Snapshot } from './contracts.js';

export async function loadArtifact(path: string): Promise<Artifact> {
  return artifactSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export class Replay {
  private cursor = 0;
  private speed = 1;
  private status: Snapshot['status'];
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  constructor(private artifact: Artifact | null, private error: string | null = null) {
    this.status = artifact ? 'paused' : 'unavailable';
  }
  snapshot(): Snapshot {
    return {
      status: this.status, speed: this.speed, cursor: this.cursor,
      total: this.artifact?.events.length ?? 0,
      eventTime: this.artifact?.events[this.cursor - 1]?.timestamp ?? null,
      dataset: this.artifact?.dataset ?? 'IBM AMLWorld HI-Small synthetic AML benchmark',
      error: this.error, events: this.artifact?.events.slice(0, this.cursor) ?? [],
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
    this.timer = setInterval(() => this.advance(), 1000 / this.speed);
  }
  advance() {
    if (this.status !== 'running' || !this.artifact) return;
    this.cursor += 1;
    if (this.cursor === this.artifact.events.length) {
      this.status = 'completed';
      this.stopTimer();
    }
    this.publish();
  }
  control(command: Control) {
    if (!this.artifact) throw new Error(this.error ?? 'Replay data unavailable');
    switch (command.action) {
      case 'start':
        if (this.status === 'completed') throw new Error('Replay completed. Reset to replay again.');
        if (this.status !== 'running') { this.status = 'running'; this.startTimer(); }
        break;
      case 'pause':
        this.stopTimer();
        if (this.status !== 'completed') this.status = 'paused';
        break;
      case 'reset':
        this.stopTimer(); this.cursor = 0; this.speed = 1; this.status = 'paused';
        break;
      case 'speed':
        this.speed = command.speed;
        if (this.status === 'running') this.startTimer();
        break;
    }
    this.publish();
    return this.snapshot();
  }
  dispose() { this.stopTimer(); this.listeners.clear(); }
}
