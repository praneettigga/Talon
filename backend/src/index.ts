import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadReplayInput, Replay } from './replay.js';
import { PythonWorker, unavailable } from './worker.js';
import { loadCaseEvaluation } from './evaluation.js';

const path = process.env.TALON_REPLAY_FILE ?? fileURLToPath(new URL('../../data/replay/replay.json', import.meta.url));
let replay: Replay;
try {
  const { artifact, sha256 } = await loadReplayInput(path);
  const worker = new PythonWorker();
  try { replay = new Replay(artifact, null, worker, await worker.initialize(artifact.sourceSha256, undefined, { replaySha256: sha256 })); }
  catch (error) { worker.close(); replay = new Replay(artifact, null, undefined, unavailable((error as Error).message)); }
}
catch {
  const message = 'Replay data missing or invalid. Run npm run data:replay, then restart the API.';
  console.error(message);
  replay = new Replay(null, message);
}
const app = createApp(replay, await loadCaseEvaluation());
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, '127.0.0.1');
server.once('listening', () => {
  console.log(`Talon API: http://127.0.0.1:${port}`);
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Talon API port ${port} is already occupied. Stop the other backend terminal (Ctrl+C), then restart this one. Run only one API: root npm run dev already starts it.`
    : `Talon API failed to listen: ${error.message}`);
  replay.dispose();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { replay.dispose(); server.close(); server.closeAllConnections(); });
}
