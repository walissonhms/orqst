import { loadConfig } from './config.js';
import { createBridge } from './app.js';

const app = createBridge(loadConfig());
app.core.onFailure(() => {
  process.exitCode = 1;
  console.error('ORQST observation failed. The local service is stopping.');
});

function shutdown(): void {
  void app.stop().catch(() => {
    process.exitCode = 1;
    console.error('ORQST could not finish local service shutdown.');
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  const port = await app.start();
  console.log(`ORQST 0.1.0 · http://127.0.0.1:${port} · local only`);
} catch {
  process.exitCode = 1;
  console.error('ORQST could not start the local service. Check its configuration and port.');
}
