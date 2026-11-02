import { join } from 'node:path';
import { Store } from '@orqst/database';
import { CodexObserver } from '@orqst/adapter-codex';
import { loadConfig } from './config.js';
import { createLocalServer } from './server.js';

process.umask(0o077);
const config = loadConfig();
const store = new Store(join(config.dataDir, 'orqst.db'), config.retentionDays);
const observer = new CodexObserver({
  root: config.sessionsDir,
  store,
  pollMs: config.pollMs,
  onEvent: (event, live) => api.broadcast(event, live),
});
const api = createLocalServer(store, config, observer);
try {
  const port = await api.listen();
  console.log(`ORQST 0.1.0 · http://127.0.0.1:${port} · local only`);
} catch {
  store.close();
  console.error('ORQST could not bind the local port. Check ORQST_PORT.');
  process.exit(1);
}
store.retain();
void observer.start();
const retention = setInterval(() => {
  store.retain();
}, 3600000);
let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(retention);
  await observer.stop();
  await api.close();
  store.close();
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
