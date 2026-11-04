import { DesktopMonitor, desktopNotificationFrame } from '@orqst/core';
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
let monitorTimer: ReturnType<typeof setInterval> | undefined;
function shutdown(failed = false): void {
  if (failed) process.exitCode = 1;
  clearInterval(monitorTimer);
  stopping ??= app.stop().catch(() => {
    process.exitCode = 1;
    console.error('ORQST Desktop Core shutdown failed.');
  });
  void stopping.finally(() => process.stdin.destroy());
}

// The pipe is also the parent-liveness signal. No PID adoption or automatic respawn.
process.stdout.on('error', () => shutdown(true));
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
  if (!stopping) {
    process.stdout.write(`ORQST_CORE_READY ${port}\n`);
    if (process.env.ORQST_NATIVE_MONITOR === '1') {
      const monitor = new DesktopMonitor();
      let lastPoll = 0;
      const poll = () => {
        if (stopping) return;
        // Never queue a growing alert backlog if the native parent stops reading.
        if (process.stdout.writableLength > 64 * 1024) {
          monitor.disconnect();
          return;
        }
        const now = Date.now();
        if (now - lastPoll > 10_000) monitor.disconnect();
        lastPoll = now;
        let frame: object;
        try {
          const store = app.core.store;
          const result = monitor.accept({
            cursor: store.cursor(),
            sessions: store.sessions(),
            events: store.recentEvents(150),
            notifications: store.notifications(),
            preferences: store.preferences(),
          });
          // Only source-gated navigation identities enter this private pipe, never OS text.
          frame = desktopNotificationFrame(result);
        } catch {
          monitor.disconnect();
          frame = { connected: false };
        }
        process.stdout.write(`ORQST_DESKTOP_STATE ${JSON.stringify(frame)}\n`);
      };
      poll();
      monitorTimer = setInterval(poll, 2000);
    }
  }
} catch {
  console.error('ORQST Desktop Core startup failed.');
  shutdown(true);
}
