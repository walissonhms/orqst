// Disposable synthetic provisioning only. Node is hashed, never executed as a provider.
import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  prepareTerminalCreation as prepareProductionCreation,
  type TerminalCreationInput,
} from '../apps/desktop/src/terminal-creation.js';
import { inspectManagedTerminalFiles } from '../packages/core/src/terminal/managed-files.js';
import { TerminalSelection } from '../apps/desktop/src/terminal-selection.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';

// Pin substitution exists only in this disposable test bundle. Production rejects Node as CLI.
const bundle = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-creation-bundle-')));
after(() => rmSync(bundle, { recursive: true, force: true }));
await build({
  entryPoints: ['apps/desktop/src/terminal-creation.ts'],
  outfile: join(bundle, 'creation.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  logLevel: 'silent',
});
const { prepareTerminalCreation } = (await import(
  pathToFileURL(join(bundle, 'creation.mjs')).href
)) as typeof import('../apps/desktop/src/terminal-creation.js');

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-create-')));
  chmodSync(root, 0o700);
  const project = join(root, 'project');
  const parent = join(root, 'profile');
  const home = join(root, 'native');
  const codexHome = join(home, '.codex');
  for (const path of [project, parent, home, codexHome]) mkdirSync(path, { mode: 0o700 });
  const marker = join(parent, 'active-pair.json');
  writeFileSync(marker, 'SYNTHETIC-UNKNOWN-RESERVATION', { mode: 0o600 });
  const executable = join(root, 'synthetic-cli');
  writeFileSync(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]), { mode: 0o700 });
  const cliEvidence = (['tui', 'mcp'] as const).map((mode) => ({
    executable,
    version: '0.162.1',
    sha256: terminalExecutableSha256(executable),
    binding: {
      version: 2 as const,
      provider: 'codex' as const,
      mode,
      teamId: '2DC432GLL2',
      identifier: 'codex',
      contractRevision: `codex-${mode}-0.162.1`,
      authorizationEpoch: '1c24dd25-839b-401b-9726-cee7fa38f356',
      policyRevision: 1,
    },
  }));
  const input: TerminalCreationInput = {
    cliEvidence,
    provider: 'codex',
    executable,
    node: realpathSync(process.execPath),
    project,
    parent,
    home,
    environment: { CODEX_HOME: codexHome, SYNTHETIC_EXCLUDED: 'not-forwarded' },
    mcp: true,
  };
  return { root, input, marker, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('creation plans without writes, publishes complete private A/B and reuses native selectors', async () => {
  const f = fixture();
  try {
    // Ordinary trusted directories may be searchable; only the new state is private.
    for (const path of [f.input.project, f.input.home, f.input.parent]) chmodSync(path, 0o755);
    const before = readdirSync(f.root, { recursive: true });
    const plan = prepareTerminalCreation(f.input);
    assert.deepEqual(readdirSync(f.root, { recursive: true }), before);
    assert.ok(plan.detail.length <= 4096);
    const review = JSON.parse(plan.detail);
    const configs = review.terminals;
    assert.equal(configs.length, 2);
    assert.notEqual(configs[0].state, configs[1].state);
    assert.equal(configs[0].authentication.home, f.input.home);
    assert.ok(review.toolPath.includes('/usr/bin'));
    assert.ok(review.toolPath.split(':').every((path: string) => path.startsWith('/')));
    assert.equal('toolPath' in configs[0], false);
    assert.equal(configs[0].authentication.codexHome, f.input.environment.CODEX_HOME);
    assert.doesNotMatch(plan.detail, /SYNTHETIC_EXCLUDED|not-forwarded/);
    const files = plan.provision(() => true);
    const inspected = inspectManagedTerminalFiles(files);
    assert.ok(inspected.every(({ blocker }) => !blocker));
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-UNKNOWN-RESERVATION');
    assert.deepEqual(readdirSync(f.input.home), ['.codex']);
    assert.deepEqual(readdirSync(f.input.project), []);
    for (const file of files) {
      assert.equal(lstatSync(file).mode & 0o777, 0o600);
      const persisted = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(persisted.cliAuthorization.version, 2);
      assert.deepEqual(Object.keys(persisted.executable), ['path']);
    }
    for (const { config } of inspected) {
      assert.equal(config.toolPath, review.toolPath);
      assert.equal(lstatSync(config.state).mode & 0o777, 0o700);
      assert.deepEqual(readdirSync(config.state).sort(), ['codex', 'home', 'terminal.json', 'tmp']);
    }
    const selection = new TerminalSelection();
    assert.equal(
      await selection.review({
        current: () => true,
        choose: async () => files,
        confirm: async () => true,
      }),
      'reviewed',
    );
    assert.deepEqual(selection.take(), files);
    assert.throws(() => plan.provision(() => true), /unavailable/);
  } finally {
    f.close();
  }
});

test('host binary drift after review refuses before provisioning without executing it', () => {
  const f = fixture();
  try {
    const node = join(f.root, 'SYNTHETIC-NEVER-EXECUTED-HOST');
    const bytes = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from('SYNTHETIC')]);
    writeFileSync(node, bytes, { mode: 0o700 });
    const plan = prepareTerminalCreation({ ...f.input, node });
    writeFileSync(node, Buffer.concat([bytes, Buffer.from('CHANGED')]));
    assert.throws(() => plan.provision(() => true), /executable changed/);
    assert.deepEqual(readdirSync(f.input.parent), ['active-pair.json']);
  } finally {
    f.close();
  }
});

test('reviewed tool directory replacement refuses before provisioning and without changing native identity', () => {
  const f = fixture();
  try {
    const tools = join(f.root, 'synthetic-tools');
    mkdirSync(tools, { mode: 0o700 });
    f.input.environment.PATH = tools;
    const plan = prepareTerminalCreation(f.input);
    renameSync(tools, tools + '.old');
    mkdirSync(tools, { mode: 0o700 });
    assert.throws(() => plan.provision(() => true), /Tool PATH directory identity changed/);
    assert.deepEqual(readdirSync(f.input.parent), ['active-pair.json']);
    assert.deepEqual(readdirSync(f.input.home), ['.codex']);
  } finally {
    f.close();
  }
});

test('an unrepresentable explicitly selected host directory blocks creation without writing state', () => {
  const f = fixture();
  try {
    const directory = join(f.root, 'selected:tools');
    mkdirSync(directory, { mode: 0o700 });
    const node = join(directory, 'synthetic-node');
    writeFileSync(node, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]), { mode: 0o700 });
    assert.throws(
      () => prepareTerminalCreation({ ...f.input, node }),
      /Selected CLI tool directory is unavailable or unsafe/,
    );
    assert.deepEqual(readdirSync(f.input.parent), ['active-pair.json']);
    assert.deepEqual(readdirSync(f.input.home), ['.codex']);
  } finally {
    f.close();
  }
});

test('absent focus/expiry and changed project or directory identity refuse before writes', () => {
  const f = fixture();
  try {
    const plan = prepareTerminalCreation(f.input);
    assert.throws(() => plan.provision(() => false), /unavailable/);
    assert.deepEqual(readdirSync(f.input.parent), ['active-pair.json']);
    writeFileSync(join(f.input.project, 'SYNTHETIC'), 'new file');
    assert.throws(() => plan.provision(() => true), /empty/);
    assert.throws(() => prepareTerminalCreation(f.input), /empty/);
    rmSync(join(f.input.project, 'SYNTHETIC'));
    renameSync(f.input.project, f.input.project + '.old');
    mkdirSync(f.input.project, { mode: 0o700 });
    assert.throws(() => plan.provision(() => true), /changed/);
    assert.deepEqual(readdirSync(f.input.parent), ['active-pair.json']);
  } finally {
    f.close();
  }
});

test('canonical selectors, private ancestry and exact provider pins are enforced before writes', () => {
  const f = fixture();
  try {
    assert.throws(
      () => prepareProductionCreation({ ...f.input, cliEvidence: [] }),
      /authorization evidence/,
    );
    assert.throws(
      () => prepareTerminalCreation({ ...f.input, openCodeStartupAuthorized: true }),
      /provider-specific/,
    );
    const alias = join(f.root, 'node-alias');
    symlinkSync(f.input.node, alias);
    assert.throws(() => prepareTerminalCreation({ ...f.input, node: alias }), /Noncanonical/);
    assert.throws(
      () => prepareTerminalCreation({ ...f.input, provider: 'claude' }),
      /authorization evidence/,
    );
    assert.throws(() => prepareTerminalCreation({ ...f.input, provider: 'opencode' }));
    assert.throws(() =>
      prepareTerminalCreation({ ...f.input, environment: { CODEX_HOME: 'relative' } }),
    );
    assert.throws(() => prepareTerminalCreation({ ...f.input, parent: f.input.project }));
    assert.throws(() =>
      prepareTerminalCreation({ ...f.input, parent: f.input.environment.CODEX_HOME! }),
    );
    chmodSync(f.input.parent, 0o777);
    assert.throws(() => prepareTerminalCreation(f.input), /Untrusted/);
    chmodSync(f.input.parent, 0o700);
    assert.deepEqual(readdirSync(f.input.parent), ['active-pair.json']);
  } finally {
    f.close();
  }
});

test('destination collision preserves unknown directory and leaves no admissible half pair', () => {
  const f = fixture();
  try {
    const plan = prepareTerminalCreation(f.input);
    mkdirSync(plan.root, { mode: 0o700 });
    writeFileSync(join(plan.root, 'SYNTHETIC-UNKNOWN'), 'preserve');
    assert.throws(() => plan.provision(() => true), /already exists/);
    assert.equal(readFileSync(join(plan.root, 'SYNTHETIC-UNKNOWN'), 'utf8'), 'preserve');
    for (const slot of ['A', 'B'])
      assert.throws(() =>
        inspectManagedTerminalFiles([join(plan.root + '.pending', slot, 'terminal.json')]),
      );
    assert.throws(() => plan.provision(() => true), /unavailable/);
  } finally {
    f.close();
  }
});

test('invalidation after skeleton creation retains inert staging without publishing or retrying', () => {
  const f = fixture();
  try {
    const plan = prepareTerminalCreation(f.input);
    let checks = 0;
    assert.throws(() => plan.provision(() => ++checks < 3), /publication/);
    assert.equal(readdirSync(f.input.parent).includes(plan.root.split('/').pop()!), false);
    const staging = plan.root + '.pending';
    assert.deepEqual(readdirSync(staging).sort(), ['A', 'B']);
    for (const slot of ['A', 'B']) {
      assert.throws(() => inspectManagedTerminalFiles([join(staging, slot, 'terminal.json')]));
      assert.equal(readdirSync(join(staging, slot)).includes('terminal.sqlite'), false);
    }
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-UNKNOWN-RESERVATION');
    assert.throws(() => plan.provision(() => true), /unavailable/);
  } finally {
    f.close();
  }
});

for (const count of [1, 3, 6, 8])
  test(`native preparation persists ${count} identities and isolated states with complete review`, async () => {
    const f = fixture();
    try {
      const input = { ...f.input, count, limit: 8, mcp: false };
      const plan = prepareTerminalCreation(input);
      assert.ok(plan.pages.every((page) => page.length <= 4096));
      const reviewed = plan.pages.flatMap((page) => JSON.parse(page).terminals);
      assert.equal(reviewed.length, count);
      const files = plan.provision(() => true);
      const selection = inspectManagedTerminalFiles(files, 8);
      assert.equal(selection.length, count);
      const identities = selection.map(({ config }) => config.identity!.terminalId);
      assert.equal(new Set(identities).size, count);
      assert.equal(new Set(selection.map(({ config }) => config.state)).size, count);
      assert.deepEqual(
        selection.map(({ config }) => config.identity!.terminalId),
        reviewed.map((config) => config.identity.terminalId),
      );
      const native = new TerminalSelection(Date.now, 8);
      let pages = 0;
      assert.equal(
        await native.review({
          current: () => true,
          choose: async () => files,
          confirm: async (page) => {
            pages++;
            assert.ok(page.length <= 4096);
            return true;
          },
        }),
        'reviewed',
      );
      assert.ok(pages >= 1);
      assert.deepEqual(native.take(), files);
      if (count > 2) assert.throws(() => inspectManagedTerminalFiles(files), /capacity/);
      assert.deepEqual(
        selection.map(({ config }) => config.identity!.terminalId),
        identities,
      );
    } finally {
      f.close();
    }
  });

test('count/limit errors, N-member MCP and duplicate identities fail before Core or provisioning', () => {
  const f = fixture();
  try {
    const before = readdirSync(f.input.parent);
    for (const count of [0, -1, 2.5, 9, NaN])
      assert.throws(() => prepareTerminalCreation({ ...f.input, count, limit: 8, mcp: false }));
    assert.throws(
      () => prepareTerminalCreation({ ...f.input, count: 3, limit: 2, mcp: false }),
      /capacity/,
    );
    assert.throws(() => prepareTerminalCreation({ ...f.input, count: 3, limit: 8 }), /MCP/);
    assert.deepEqual(readdirSync(f.input.parent), before);
    const files = prepareTerminalCreation({ ...f.input, count: 3, limit: 8, mcp: false }).provision(
      () => true,
    );
    const first = JSON.parse(readFileSync(files[0]!, 'utf8'));
    const other = JSON.parse(readFileSync(files[2]!, 'utf8'));
    other.identity = first.identity;
    writeFileSync(files[2]!, JSON.stringify(other));
    assert.throws(() => inspectManagedTerminalFiles(files, 8), /Duplicate terminal identity/);
  } finally {
    f.close();
  }
});
