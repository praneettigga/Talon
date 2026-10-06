import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadArtifact, Replay } from './replay.js';

const path = process.env.TALON_REPLAY_FILE ?? fileURLToPath(new URL('../../data/replay/replay.json', import.meta.url));
let replay: Replay;
try { replay = new Replay(await loadArtifact(path)); }
catch {
  const message = 'Replay data missing or invalid. Run npm run data:replay, then restart the API.';
  console.error(message);
  replay = new Replay(null, message);
}
const app = createApp(replay);
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Talon API: http://127.0.0.1:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { replay.dispose(); server.close(); server.closeAllConnections(); });
}
