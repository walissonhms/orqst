// SYNTHETIC test parent for `orqst-terminal-core`: a real Node IPC parent with
// `serialization: 'json'`, exactly like managed-terminal-core.ts. It prints one JSON line per
// observation to stdout. Never touches a provider CLI or user data.
// argv: <binary> <requestsJson> <core args...>
import { spawn } from 'node:child_process';

const [binary, requestsJson, ...args] = process.argv.slice(2);
const requests = JSON.parse(requestsJson);
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const child = spawn(binary, args, {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  serialization: 'json',
});
let next = 0;
const sendNext = () => {
  if (next < requests.length) child.send(requests[next++]);
  else if (child.connected) child.disconnect();
};
child.on('message', (message) => {
  out({ event: 'message', message });
  sendNext();
});
child.on('disconnect', () => out({ event: 'disconnect' }));
child.on('exit', (code, signal) => out({ event: 'exit', code, signal }));
setTimeout(() => {
  out({ event: 'timeout' });
  child.kill('SIGKILL');
}, 20000).unref();
