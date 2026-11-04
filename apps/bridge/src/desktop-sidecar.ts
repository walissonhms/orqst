import { lstat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createBridge } from './app.js';
import { loadConfig } from './config.js';

/** Private native-host entry. Reuses the Bridge; it exposes no execution endpoint. */
const config = loadConfig();
const dashboardDir = process.argv[2];
if (!dashboardDir || !process.env.ORQST_DATA_DIR) {
  throw new Error('The Desktop Core requires explicit resources and private state');
}
const app = createBridge({
  ...config,
  // Native Desktop supplies a stable origin for browser preferences. Disposable
  // process acceptance can omit the port and let the OS select an unused one.
  port: process.env.ORQST_PORT === undefined ? 0 : config.port,
  dev: false,
  dashboardDir: resolve(dashboardDir),
});
let stopping: Promise<void> | undefined;
function shutdown(failed = false): void {
  if (failed) process.exitCode = 1;
  stopping ??= app.stop().catch(() => {
    process.exitCode = 1;
    console.error('ORQST Desktop Core shutdown failed.');
  });
  void stopping.finally(() => process.stdin.destroy());
}

// The pipe is also the parent-liveness signal. No PID adoption or automatic respawn.
process.stdin.on('end', () => shutdown());
process.stdin.on('error', () => shutdown(true));
let commandBytes = 0;
process.stdin.on('data', (chunk: Buffer) => {
  commandBytes += chunk.byteLength;
  // The native host only closes this channel or writes the fixed shutdown command.
  if (commandBytes > 32 || chunk.includes(10)) shutdown();
});
process.stdin.resume();
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
app.core.onFailure(() => shutdown(true));

try {
  // READY promises a usable packaged dashboard, not only an open socket.
  const root = await realpath(resolve(dashboardDir));
  const index = join(root, 'index.html');
  if (!(await lstat(index)).isFile() || !(await realpath(index)).startsWith(root + sep)) {
    throw new Error('Invalid Desktop dashboard');
  }
  const port = await app.start();
  if (!stopping) process.stdout.write(`ORQST_CORE_READY ${port}\n`);
} catch {
  console.error('ORQST Desktop Core startup failed.');
  shutdown(true);
}
