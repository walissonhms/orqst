// UI-independent owned Terminal component. The observer composition never imports this entry.
import { createPublicKey, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { TerminalAuthority } from './authority.js';
import { interactiveCliAdapter } from './interactive-adapters.js';
import { ManagedTerminalPair } from './managed-pair.js';
import { inspectManagedTerminalFiles } from './managed-files.js';
import { desktopAgentsAdmission } from '../managed-codex/desktop-admission.js';
import { terminalPairRPCSchema } from './rpc.js';

process.umask(0o077);
if (!process.send || process.argv.length !== 5 || !/^v24\./.test(process.version))
  throw new Error('Private Node Core only');
const files: string[] = JSON.parse(process.argv[2]!);
const selection = inspectManagedTerminalFiles(files);
if (selection.some((slot) => slot.blocker)) throw new Error('Terminal profile blocked');
const publicKey = createPublicKey({
  key: Buffer.from(process.argv[3]!, 'base64url'),
  type: 'spki',
  format: 'der',
});
const authority = new TerminalAuthority(new Map([['desktop-managed', publicKey]]), Date.now);
const admission = desktopAgentsAdmission(process.argv[4]!, files);
const stores: Store[] = [];
const adapter = interactiveCliAdapter('codex', 'separate-login');
const pair = new ManagedTerminalPair(
  authority,
  selection.map(({ config }, slot) => {
    const store = new Store(join(config.state, 'terminal.sqlite'));
    stores.push(store);
    return {
      profiles: adapter.profiles(config),
      backend: adapter.backend(files[slot]!, join(__dirname, 'managed-terminal-host.cjs')),
      journal: store.terminalJournal(authority.epoch, { recover: false }),
    };
  }),
  admission,
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
  pair.close();
  for (const store of stores) store.close();
  if (process.connected) process.disconnect();
}
process.on('disconnect', shutdown);
process.on('message', (raw: unknown) => {
  if (closed) return;
  const parsed = terminalPairRPCSchema.safeParse(raw);
  if (!parsed.success) return shutdown();
  const request = parsed.data;
  const id = request.kind === 'terminal' ? request.request.id : request.id;
  try {
    let value: unknown;
    switch (request.kind) {
      case 'terminal':
        value = pair.dispatch(request.slot, request.request);
        break;
      case 'closeSlot':
        pair.closeSlot(request.slot);
        break;
      case 'prepareRetire':
        value = pair.prepareRetire();
        break;
      case 'retire':
        pair.retire(request.proof);
        break;
    }
    send({ id, ok: true, value: value ?? null });
  } catch {
    send({ id, ok: false });
  }
});
send({
  type: 'ready',
  epoch: authority.epoch,
  identities: selection.map((_config, slot) => ({
    slot,
    terminalId: randomUUID(),
    provider: 'codex',
  })),
});
