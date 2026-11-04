// Disposable manifests and metadata only. /usr/bin/true is hashed, never launched.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import type { TerminalEnrollmentInput } from '@orqst/protocol';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  terminalEnrollmentFile,
  inspectTerminalEnrollment,
} from '../packages/core/src/terminal/enrollment-files.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import { resolveTerminalPreparationContext } from '../packages/core/src/terminal/preparation-context.js';
import { terminalPairRPCSchema } from '../packages/core/src/terminal/rpc.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-enrollment-files-')));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const codexHome = join(home, '.codex');
  const preferencesDirectory = join(root, 'preferences');
  for (const path of [project, home, codexHome, preferencesDirectory])
    mkdirSync(path, { mode: 0o700 });
  const observerDatabase = join(root, 'observer.sqlite');
  const observer = new Store(observerDatabase);
  const workspaceId = observer.workspace(project, 'Synthetic workspace');
  observer.close();
  const features = featureConfigurationDatabase(preferencesDirectory, workspaceId);
  const feature = features.create({ name: 'Synthetic Feature' });
  features.saveView({ featureId: feature.featureId, expectedRevision: 0 });
  const trusted = { observerDatabase, preferencesDirectory };
  const context = resolveTerminalPreparationContext(trusted, workspaceId, feature.featureId);
  const modelFile = join(home, 'synthetic-model.json');
  writeFileSync(modelFile, '{"model":"synthetic-selected"}', { mode: 0o600 });
  const executable = realpathSync('/usr/bin/true');
  const node = realpathSync(process.execPath);
  const configs: ManagedCodexConfig[] = [];
  const files = [0, 1].map((slot) => {
    const state = join(root, `state-${slot}`);
    mkdirSync(state, { mode: 0o700 });
    for (const dir of ['home', 'codex', 'tmp']) mkdirSync(join(state, dir), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      identity: { terminalId: randomUUID() },
      executable: { path: executable, sha256: terminalExecutableSha256(executable) },
      node: { path: node, sha256: terminalExecutableSha256(node) },
      executableVersion: 'SYNTHETIC-NO-PROVIDER',
      project,
      state,
      authentication: { mode: 'reuse-existing', home, codexHome, sharedNativeConfiguration: true },
      interactive: { sharedNativeSessions: true },
      model: {
        value: 'synthetic-selected',
        source: 'native-config',
        files: [{ path: modelFile, sha256: terminalDigest(readFileSync(modelFile)) }],
      },
      preparation: { ...trusted, workspaceId, featureId: feature.featureId, fence: context.fence },
    };
    configs.push(config);
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(root, `manifest-${slot}.json`);
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return file;
  });
  const existing = [terminalEnrollmentFile(files[0]!, configs[0]!)];
  // Existing journals are intentionally not re-inspected as empty candidate states.
  const prior = new Store(join(configs[0]!.state, 'terminal.sqlite'));
  prior.close();
  const input: TerminalEnrollmentInput = {
    version: 1,
    epoch: randomUUID(),
    opId: randomUUID(),
    expectedRevision: 0,
    workspaceId,
    featureId: feature.featureId,
  };
  return {
    root,
    files,
    configs,
    existing,
    input,
    features,
    modelFile,
    observerDatabase,
    rewrite: () => writeFileSync(files[1]!, JSON.stringify(configs[1]), { mode: 0o600 }),
    inspect: () => inspectTerminalEnrollment(files[1]!, input, existing),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('candidate enrollment preserves original profile/journal and resolves observer workspace read-only', () => {
  const f = fixture();
  try {
    const database = readFileSync(f.observerDatabase);
    const original = readFileSync(f.files[0]!);
    const candidate = f.inspect();
    assert.equal(candidate.member.terminalId, f.configs[1]!.identity!.terminalId);
    assert.equal(candidate.member.requestedModel, 'synthetic-selected');
    assert.equal(candidate.member.featureId, f.input.featureId);
    assert.doesNotThrow(candidate.validate);
    assert.deepEqual(readFileSync(f.observerDatabase), database);
    assert.deepEqual(readFileSync(f.files[0]!), original);
  } finally {
    f.close();
  }
});

for (const target of ['manifest', 'model'] as const)
  test(`same-content ${target} inode replacement is refused before commit/start`, () => {
    const f = fixture();
    try {
      const candidate = f.inspect();
      const path = target === 'manifest' ? f.files[1]! : f.modelFile;
      const bytes = readFileSync(path);
      renameSync(path, `${path}.preserved`);
      writeFileSync(path, bytes, { mode: 0o600 });
      assert.throws(candidate.validate, /source identity changed/);
    } finally {
      f.close();
    }
  });

test('changed profile/model/context, duplicate UUID and a different workspace are rejected', () => {
  const f = fixture();
  try {
    const candidate = f.inspect();
    f.configs[1]!.identity!.terminalId = f.configs[0]!.identity!.terminalId;
    f.rewrite();
    assert.throws(f.inspect, /Duplicate terminal identity/);
    assert.throws(candidate.validate, /source identity changed/);
    f.configs[1]!.identity!.terminalId = randomUUID();
    f.rewrite();
    assert.throws(
      () =>
        inspectTerminalEnrollment(
          f.files[1]!,
          { ...f.input, workspaceId: '0'.repeat(64) },
          f.existing,
        ),
      /workspace or Feature/,
    );
    const next = f.features.create({ name: 'Other synthetic Feature' });
    f.features.saveView({ expectedRevision: 1, featureId: next.featureId });
    assert.throws(candidate.validate, /Feature changed/);
    assert.throws(f.inspect, /Feature changed/);
  } finally {
    f.close();
  }
});

test('unprepared/default metadata cannot enroll and private RPC rejects renderer authority fields', () => {
  const f = fixture();
  try {
    delete f.configs[1]!.model;
    f.rewrite();
    assert.throws(f.inspect, /prepared independent/);
    const request = { kind: 'enroll', id: randomUUID(), input: f.input, manifestFile: f.files[1] };
    assert.equal(terminalPairRPCSchema.safeParse(request).success, true);
    for (const field of ['proof', 'executable', 'argv', 'slot', 'provider', 'model'])
      assert.equal(
        terminalPairRPCSchema.safeParse({ ...request, [field]: 'synthetic-untrusted' }).success,
        false,
      );
    assert.equal(
      terminalPairRPCSchema.safeParse({
        kind: 'enrollmentInspect',
        id: randomUUID(),
        opId: f.input.opId,
      }).success,
      true,
    );
    assert.equal(
      terminalPairRPCSchema.safeParse({ ...request, input: { ...f.input, epoch: 1 } }).success,
      false,
    );
  } finally {
    f.close();
  }
});
