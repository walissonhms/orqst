// Synthetic shared ownership, manifest and admission QA; no Electron or provider process.
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Store } from '@orqst/database';
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

const client = 'desktop-managed';

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
