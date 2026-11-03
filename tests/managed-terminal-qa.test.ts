// QA-only synthetic guards for the integrated multi-window Terminal slice.
// No Electron process, no provider, no credentials and no real session data.
// These invariants must survive the planned refactor: one IPC router routed by
// senderFrame, per-document busy/generation/broker, shared sticky pair admission,
// duplicate-manifest rejection before any core/PTY is created.
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import test from 'node:test';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Session } from 'electron';
import { terminalNativeReplySchema } from '@orqst/protocol';
import { Store } from '@orqst/database';
import { bindTerminalRuntime } from '../apps/desktop/src/terminal-runtime.js';
import { terminalDocumentURL } from '../apps/desktop/src/terminal-sender.js';
import { inspectManagedTerminalFiles } from '../packages/core/src/terminal/managed-files.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { ManagedTerminalPair } from '../packages/core/src/terminal/managed-pair.js';
import {
  managedCodexConfigSchema,
  managedCodexProfiles,
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
} from '../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../packages/core/src/terminal/native-broker.js';
import { TerminalSupervisor } from '../packages/core/src/terminal/supervisor.js';

const secret = 'SYNTHETIC-SECRET-NEVER-READ';
const client = 'desktop-managed';

function harness(options: { hangConfirm?: boolean } = {}) {
  const window = new EventEmitter();
  const contents = new EventEmitter();
  const session = {} as Session;
  const frame = { detached: false, isDestroyed: () => false, url: terminalDocumentURL };
  Object.assign(contents, {
    session,
    mainFrame: frame,
    isDestroyed: () => false,
    isFocused: () => true,
    getURL: () => frame.url,
  });
  Object.assign(window, { webContents: contents, isDestroyed: () => false, isFocused: () => true });
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  let handler: ((event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>) | undefined;
  const ipc = {
    handle: (_name: string, value: typeof handler) => {
      handler = value;
    },
    removeHandler: () => {
      handler = undefined;
    },
  } as unknown as IpcMain;
  let starts = 0;
  let confirmRelease: (() => void) | undefined;
  const dispose = bindTerminalRuntime(
    ipc,
    window as unknown as BrowserWindow,
    session,
    (document, current) => {
      const keys = generateKeyPairSync('ed25519');
      const authority = new TerminalAuthority(new Map([['runtime', keys.publicKey]]));
      const supervisor = new TerminalSupervisor(
        authority,
        {
          validate: () => true,
          start: (_profile, handlers) => {
            starts++;
            handlers.started();
            return {
              write: () => {},
              resize: () => {},
              signal: () => {},
              dispose: () => {},
            };
          },
        },
        [
          {
            id: 'synthetic',
            projectId: 'disposable',
            executable: '/synthetic/node',
            executableSha256: terminalDigest(secret),
            executableVersion: 'synthetic',
            argv: [],
            cwd: '/synthetic',
            environmentProfile: 'no-secrets',
            permissions: 'synthetic only',
          },
        ],
      );
      return new TerminalNativeBroker(authority, supervisor, 'runtime', keys.privateKey, document, {
        current: (_document, focus) => current(focus),
        confirm: async () => {
          if (!options.hangConfirm) return true;
          return new Promise<boolean>((done) => {
            confirmRelease = () => done(true);
          });
        },
      });
    },
  );
  return {
    window,
    contents,
    frame,
    event,
    loaded: () => contents.emit('did-finish-load'),
    starts: () => starts,
    closed: () => 0,
    confirmRelease: () => confirmRelease,
    bindEnded: dispose,
    send: async (request: unknown, sender = event) =>
      terminalNativeReplySchema.parse(await handler!(sender, request)),
  };
}

test('pty profiles reject reuse-existing while the manifest schema still accepts it', () => {
  const config: ManagedCodexConfig = {
    version: 1,
    trust: 'native-same-user',
    executable: { path: '/synthetic/x', sha256: 'a'.repeat(64) },
    executableVersion: 'synthetic',
    node: { path: '/synthetic/node', sha256: 'b'.repeat(64) },
    project: '/synthetic/project',
    state: '/synthetic/state',
    authentication: {
      mode: 'reuse-existing',
      home: '/synthetic/home',
      codexHome: '/synthetic/codex',
      sharedNativeConfiguration: true,
    },
  };
  assert.equal(managedCodexConfigSchema.safeParse(config).success, true);
  assert.throws(() => managedCodexProfiles(config), /structured runtime/);
});

test('one terminal state cannot be owned by two runtimes', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-terminal-qa-owner-'));
  try {
    const store = new Store(join(root, 'terminal.sqlite'));
    const first = store.terminalJournal(randomUUID(), { recover: false });
    assert.throws(() => store.terminalJournal(randomUUID(), { recover: false }), /owned/);
    first.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('terminal IPC from a foreign frame or sender is denied without starting anything', async () => {
  const f = harness();
  f.loaded();
  const foreignFrame = { detached: false, isDestroyed: () => false, url: terminalDocumentURL };
  const foreign = {
    sender: foreignFrame,
    senderFrame: foreignFrame,
  } as unknown as IpcMainInvokeEvent;
  const status = (await f.send({ version: 1, action: 'start', profileId: 'synthetic' }, foreign))
    .status;
  assert.equal(status, 'denied');
  assert.equal(f.starts(), 0);
});

test('navigation revokes the document binding and every later request', async () => {
  const f = harness();
  f.loaded();
  f.contents.emit('did-start-navigation', {}, '', false, true);
  const status = (await f.send({ version: 1, action: 'start', profileId: 'synthetic' })).status;
  assert.equal(status, 'denied');
  assert.equal(f.starts(), 0);
});

test('a mutating request in flight serializes later requests as busy', async () => {
  const f = harness({ hangConfirm: true });
  f.loaded();
  const first = f.send({ version: 1, action: 'start', profileId: 'synthetic' });
  await new Promise((done) => setImmediate(done));
  const second = await f.send({ version: 1, action: 'start', profileId: 'synthetic' });
  assert.equal(second.status, 'busy');
  assert.equal(f.starts(), 0);
  const release = f.confirmRelease();
  assert.ok(release);
  release();
  const result = await first;
  assert.equal(result.status, 'ok');
  assert.equal(f.starts(), 1);
  f.bindEnded();
});

function manifestHarness() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-terminal-qa-files-')));
  const executable = realpathSync('/usr/bin/true');
  const node = realpathSync(process.execPath);
  const write = (slot: string, state: string, reuse: boolean) => {
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    for (const directory of [state, join(state, 'home'), join(state, 'codex'), join(state, 'tmp')])
      mkdirSync(directory, { mode: 0o700 });
    const home = join(root, `home-${slot}`);
    const codexHome = join(root, `codex-${slot}`);
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(codexHome, { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: { path: executable, sha256: terminalExecutableSha256(executable) },
      executableVersion: 'SYNTHETIC-NOT-CODEX',
      node: { path: node, sha256: terminalExecutableSha256(node) },
      project,
      state,
      ...(reuse
        ? {
            authentication: {
              mode: 'reuse-existing' as const,
              home,
              codexHome,
              sharedNativeConfiguration: true as const,
            },
          }
        : {}),
    };
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(root, `terminal-${slot}.json`);
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return file;
  };
  return { root, write };
}

test('terminal file inspection rejects duplicates and overlap and flags reuse before any core', () => {
  const h = manifestHarness();
  try {
    const separateA = h.write('a', join(h.root, 'state-a'), false);
    const separateB = h.write('b', join(h.root, 'state-b'), false);
    assert.deepEqual(
      inspectManagedTerminalFiles([separateA, separateB]).map((entry) => entry.blocker),
      [undefined, undefined],
    );
    assert.throws(() => inspectManagedTerminalFiles([separateA, separateA]), /Duplicate/);
    const reuse = h.write('c', join(h.root, 'state-c'), true);
    assert.deepEqual(
      inspectManagedTerminalFiles([reuse]).map((entry) => entry.blocker),
      ['reuse_unavailable'],
    );
    const nested = h.write('d', join(h.root, 'state-a', 'nested'), false);
    assert.throws(() => inspectManagedTerminalFiles([separateA, nested]), /Overlapping/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

function pairHarness() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-terminal-qa-pair-')));
  const admissionDirectory = join(root, 'admission');
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([[client, keys.publicKey]]));
  const exits: Array<(code: number) => void> = [];
  const backend = {
    validate: () => true,
    start: (
      _profile: unknown,
      events: { started(): void; exit(code: number): void },
      identity?: {
        instanceId: string;
        epoch: string;
        manifestDigest: string;
      },
    ) => {
      assert.ok(identity, 'Owned terminal identity required');
      exits.push((code) => events.exit(code));
      events.started();
      return { write: () => {}, resize: () => {}, signal: () => {}, dispose: () => {} };
    },
  };
  const profiles = [
    {
      id: 'codex-terminal-v1' as const,
      projectId: terminalDigest('/synthetic/project'),
      executable: '/synthetic/x',
      executableSha256: terminalDigest('/synthetic/x'),
      executableVersion: 'synthetic',
      argv: [] as string[],
      cwd: '/synthetic',
      environmentProfile: 'no-secrets',
      permissions: 'synthetic only',
    },
  ];
  const stores = [0, 1].map((slot) => new Store(join(root, `slot-${slot}.sqlite`)));
  const journals = stores.map((store) =>
    store.terminalJournal(authority.epoch, { recover: false }),
  );
  const admission = desktopAgentsAdmission(admissionDirectory, [
    '/synthetic/a.json',
    '/synthetic/b.json',
  ]);
  const pair = new ManagedTerminalPair(
    authority,
    journals.map((journal) => ({ profiles, backend, journal })),
    admission,
  );
  const dispatch = (slot: number, operation: string, args: unknown[]) =>
    pair.dispatch(slot, { id: randomUUID(), operation, args }) as Record<string, unknown>;
  const proof = (challenge: { challengeId: string }) => {
    const signed = JSON.parse(
      JSON.stringify({
        challengeId: challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(challenge as never), keys.privateKey).toString(
          'base64url',
        ),
      }),
    );
    return signed;
  };
  return {
    root,
    admissionDirectory,
    pair,
    dispatch,
    proof,
    exits,
    prepare: (slot: number) =>
      dispatch(slot, 'prepare', [client, 'codex-terminal-v1']) as {
        attemptId: string;
        challenge: { challengeId: string };
      },
    marker: () => existsSync(join(admissionDirectory, 'active-pair.json')),
    close: () => {
      pair.close();
      for (const store of stores) store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('an unclaimed pair cannot retire and a reserved one blocks without exits', () => {
  const f = pairHarness();
  try {
    assert.throws(() => f.pair.prepareRetire(), /No retirable terminal reservation/);
    assert.equal(f.marker(), false);
    const prepared = f.prepare(0);
    const challenge = prepared.challenge;
    f.dispatch(0, 'launch', [prepared.attemptId, f.proof(challenge)]);
    assert.equal(f.marker(), true, 'claim happens after the native grant is consumed');
    assert.throws(() => f.pair.prepareRetire(), /owned exit/);
    f.exits[0]!(0);
    const retirement = f.pair.prepareRetire();
    f.pair.retire(f.proof(retirement.challenge));
    assert.equal(f.marker(), false, 'shared capacity released only after confirmed exits');
    assert.throws(() => f.dispatch(0, 'snapshot', [prepared.attemptId]), /fenced/);
  } finally {
    f.close();
  }
});

test('a capacity-rejected attempt stays prepared and does not block retirement', () => {
  const f = pairHarness();
  try {
    const first = f.prepare(0);
    f.dispatch(0, 'launch', [first.attemptId, f.proof(first.challenge)]);
    const second = f.prepare(0);
    assert.throws(
      () => f.dispatch(0, 'launch', [second.attemptId, f.proof(second.challenge)]),
      /admission limit/,
    );
    f.exits[0]!(0);
    const retirement = f.pair.prepareRetire();
    f.pair.retire(f.proof(retirement.challenge));
    assert.equal(f.marker(), false);
  } finally {
    f.close();
  }
});
