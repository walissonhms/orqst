import { spawn } from 'node:child_process';
const children = [
  spawn('pnpm', ['exec', 'tsx', 'watch', 'apps/bridge/src/main.ts'], {
    stdio: 'inherit',
    env: { ...process.env, ORQST_DEV: '1' },
  }),
  spawn('pnpm', ['--filter', '@orqst/dashboard', 'dev'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  process.exitCode = code;
}
children.forEach((child) => {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 0));
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
