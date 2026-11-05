// Disposable synthetic files only; no CLI is executed.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { prepareTauriTerminals } from '../../apps/desktop/src/tauri-terminal-preparation.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-catalog-contract-')));
try {
  chmodSync(root, 0o700);
  const home = join(root, 'home');
  const parent = join(root, 'profiles');
  const project = join(root, 'project');
  const preferencesDirectory = join(root, 'preferences');
  const bin = join(root, 'bin');
  for (const directory of [home, parent, project, preferencesDirectory, bin])
    mkdirSync(directory, { mode: 0o700 });
  const observerDatabase = join(root, 'observer.sqlite');
  const store = new Store(observerDatabase);
  const workspaceId = store.workspace(project, 'Synthetic contract');
  store.close();
  const request = { action: 'catalog', workspaceId, featureId: null };
  const context = {
    home,
    parent,
    node: realpathSync(process.execPath),
    environment: { HOME: home, PATH: bin },
  };
  const ports = {
    current: () => true,
    choose: async () => undefined,
    confirm: async () => false,
    commit: async () => false,
  };
  const trusted = { observerDatabase, preferencesDirectory };
  const empty = await prepareTauriTerminals(request, context, ports, Date.now, trusted);
  const owner = randomUUID();
  const epoch = randomUUID();
  writeFileSync(
    join(preferencesDirectory, `pending-pair-${owner}.json`),
    JSON.stringify({ owner, epoch }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(preferencesDirectory, `exit-pending-${owner}.json`),
    JSON.stringify({
      version: 1,
      status: 'leader_exited_retirement_pending',
      owner,
      evidence: {
        epoch,
        attempts: [
          { slot: 0, instanceId: randomUUID(), epoch, state: 'exited', exit: { exitCode: 0 } },
        ],
      },
    }),
    { mode: 0o600 },
  );
  const populated = await prepareTauriTerminals(request, context, ports, Date.now, trusted);
  process.stdout.write(JSON.stringify({ request, empty, populated }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
