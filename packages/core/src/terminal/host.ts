// UI-independent owned Terminal component. The observer composition never imports this entry.
import { createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { TerminalAuthority } from './authority.js';
import { managedCodexProfiles, readManagedCodexConfig } from './codex-profile.js';
import { managedTerminalBackend } from './pty-backend.js';
import { TerminalSupervisor } from './supervisor.js';
import { terminalRPCSchema } from './rpc.js';

process.umask(0o077);
if (!process.send || process.argv.length !== 4 || !/^v24\./.test(process.version))
  throw new Error('Private Node Core only');
const file = process.argv[2]!;
const config = readManagedCodexConfig(file);
const publicKey = createPublicKey({
  key: Buffer.from(process.argv[3]!, 'base64url'),
  type: 'spki',
  format: 'der',
});
const authority = new TerminalAuthority(new Map([['desktop-managed', publicKey]]), Date.now);
const store = new Store(join(config.state, 'terminal.sqlite'));
const supervisor = new TerminalSupervisor(
  authority,
  managedTerminalBackend(file, join(__dirname, 'managed-terminal-host.cjs')),
  managedCodexProfiles(config),
  store.terminalJournal(authority.epoch, { recover: true }),
);
const send = (value: object) => {
  if (process.connected)
    process.send!(value, (error) => {
      if (error) shutdown();
    });
};
let closed = false;
function shutdown() {
  if (closed) return;
  closed = true;
  authority.revoke('desktop-managed');
  supervisor.shutdown();
  store.close();
  if (process.connected) process.disconnect();
}
process.on('disconnect', shutdown);
process.on('message', (raw: unknown) => {
  if (closed) return;
  const parsed = terminalRPCSchema.safeParse(raw);
  if (!parsed.success) return shutdown();
  const request = parsed.data;
  try {
    let value: unknown;
    // The discriminated union preserves exact tuple types; never dispatch an arbitrary method.
    switch (request.operation) {
      case 'prepare':
        value = supervisor.prepare(...request.args);
        break;
      case 'launch':
        value = supervisor.launch(...request.args);
        break;
      case 'snapshot':
        value = supervisor.snapshot(...request.args);
        break;
      case 'requestAttach':
        value = supervisor.requestAttach(...request.args);
        break;
      case 'attach':
        value = supervisor.attach(...request.args);
        break;
      case 'requestInput':
        value = supervisor.requestInput(...request.args);
        break;
      case 'enableInput':
        value = supervisor.enableInput(...request.args);
        break;
      case 'requestPaste':
        value = supervisor.requestPaste(...request.args);
        break;
      case 'paste':
        value = supervisor.paste(...request.args);
        break;
      case 'requestStop':
        value = supervisor.requestStop(...request.args);
        break;
      case 'stop':
        value = supervisor.stop(...request.args);
        break;
      case 'write':
        value = supervisor.write(...request.args);
        break;
      case 'resize':
        value = supervisor.resize(...request.args);
        break;
      case 'read': {
        const output = supervisor.read(...request.args);
        value = { ...output, bytes: Array.from(output.bytes) };
        break;
      }
      case 'detach':
        value = supervisor.detach(...request.args);
        break;
      case 'revokeInput':
        value = supervisor.revokeInput(...request.args);
        break;
    }
    send({ id: request.id, ok: true, value: value ?? null });
  } catch {
    send({ id: request.id, ok: false });
  }
});
send({ type: 'ready' });
