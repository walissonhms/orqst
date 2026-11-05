// Disposable synthetic provisioning. Pin substitution exists only in this test bundle.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  prepareTauriTerminals as productionPreparation,
  tauriPreparationSchema,
  tauriPreparationFailure,
  TauriPreparationError,
  type TauriPreparationPorts,
} from '../apps/desktop/src/tauri-terminal-preparation.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { cliProviderIdentities } from '../packages/core/src/terminal/cli-signature.js';
import { findCliContract } from '../packages/core/src/terminal/cli-contract.js';

const bundle = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-tauri-preparation-')));
const nativePreparationSupported =
  process.platform === 'darwin' && process.arch === 'arm64' && process.getuid?.() !== 0;
after(() => rmSync(bundle, { recursive: true, force: true }));
await build({
  entryPoints: {
    preparation: 'apps/desktop/src/tauri-terminal-preparation.ts',
    host: 'apps/desktop/src/tauri-terminal-preparation-host.ts',
    inspection: 'packages/core/src/terminal/managed-files.ts',
  },
  outdir: bundle,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  logLevel: 'silent',
  plugins: [
    {
      name: 'synthetic-provisioning-pins-only',
      setup(builder) {
        builder.onResolve({ filter: /cli-authorization-flow\.js$/ }, () => ({
          path: 'synthetic-flow',
          namespace: 'synthetic-flow',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'synthetic-flow' }, () => ({
          contents: `import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; export async function prepareCliCandidate(input) { const hash = createHash('sha256').update(readFileSync(input.executable)).digest('hex'); return { existing: { status: 'allowed', profile: input.profile('0.162.1', hash), epoch: 'synthetic', binding: { version: 2, provider: 'codex', mode: 'tui', teamId: '2DC432GLL2', identifier: 'codex', contractRevision: 'codex-tui-0.162.1', authorizationEpoch: '1c24dd25-839b-401b-9726-cee7fa38f356', policyRevision: 1 } } }; } export async function authorizePreparedGroup(candidates, review, current) { if (!(await current())) return candidates.map(() => ({status:'blocked'})); return candidates.map((entry) => entry.existing); }`,
          loader: 'js',
        }));
      },
    },
  ],
});
const { prepareTauriTerminals } = (await import(
  pathToFileURL(join(bundle, 'preparation.cjs')).href
)) as typeof import('../apps/desktop/src/tauri-terminal-preparation.js');
const { inspectManagedTerminalFiles } = (await import(
  pathToFileURL(join(bundle, 'inspection.cjs')).href
)) as typeof import('../packages/core/src/terminal/managed-files.js');

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-tauri-create-')));
  chmodSync(root, 0o700);
  const home = join(root, 'native');
  const parent = join(root, 'profile');
  const project = join(root, 'project');
  for (const path of [home, join(home, '.codex'), parent, project])
    mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(parent, 'unknown-reservation'), 'SYNTHETIC-PRESERVE', { mode: 0o600 });
  const context = {
    parent,
    home,
    node: realpathSync(process.execPath),
    environment: { HOME: home, PATH: '/usr/bin:/bin' },
  };
  const executable = join(root, 'synthetic-cli');
  writeFileSync(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]), { mode: 0o700 });
  const confirmations: string[] = [];
  const ports: TauriPreparationPorts = {
    current: () => true,
    choose: async (directory) => (directory ? project : executable),
    confirm: async (key, detail) => {
      confirmations.push(key);
      assert.ok(detail.length <= 4096);
      return true;
    },
    authorizeCli: async (candidate: {
      provider: 'codex' | 'claude' | 'opencode';
      mode: 'tui' | 'mcp';
      executable: string;
    }) => ({
      status: 'allowed' as const,
      version:
        candidate.provider === 'codex'
          ? '0.162.1'
          : candidate.provider === 'opencode'
            ? '2.2.5'
            : candidate.mode === 'mcp'
              ? '2.1.178'
              : '2.1.318',
      sha256: terminalExecutableSha256(candidate.executable),
      binding: {
        version: 2 as const,
        provider: candidate.provider,
        mode: candidate.mode,
        ...cliProviderIdentities[candidate.provider],
        contractRevision: findCliContract(
          candidate.provider,
          candidate.mode,
          candidate.provider === 'codex'
            ? '0.162.1'
            : candidate.provider === 'opencode'
              ? '2.2.5'
              : candidate.mode === 'mcp'
                ? '2.1.178'
                : '2.1.318',
        )!.revision,
        authorizationEpoch: '1c24dd25-839b-401b-9726-cee7fa38f356',
        policyRevision: 1,
      },
    }),
    commit: async () => true,
  };
  const close = () => rmSync(root, { recursive: true, force: true });
  return { root, context, project, executable, ports, confirmations, close };
}

for (const provider of ['codex', 'claude']) {
  for (const count of [1, 4, 8]) {
    test(`Tauri native preparation reuses complete ${count}-member ${provider} provisioning/selection`, async () => {
      const f = fixture();
      try {
        const result = await prepareTauriTerminals(
          { action: 'create', provider, count },
          f.context,
          f.ports,
        );
        assert.equal(result.status, 'open');
        for (const file of result.files) {
          const manifest = JSON.parse(readFileSync(file, 'utf8'));
          assert.equal(manifest.cliAuthorization.version, 2);
          assert.equal(manifest.cliAuthorization.policyRevision, 1);
          assert.deepEqual(Object.keys(manifest.executable), ['path']);
        }
        const members = inspectManagedTerminalFiles(result.files, 8);
        assert.equal(members.length, count);
        assert.equal(new Set(members.map(({ config }) => config.identity!.terminalId)).size, count);
        assert.ok(members.every(({ config, blocker }) => !blocker && !config.interactive?.mcp));
        assert.ok(members.every(({ config }) => config.node.path === f.context.node));
        assert.equal(f.confirmations[0], 'create');
        assert.ok(f.confirmations.indexOf('acknowledge') < f.confirmations.indexOf('open'));
        assert.deepEqual(readdirSync(f.project), []);
        assert.deepEqual(readdirSync(f.context.home), ['.codex']);
        assert.equal(
          readFileSync(join(f.context.parent, 'unknown-reservation'), 'utf8'),
          'SYNTHETIC-PRESERVE',
        );
        for (const { config } of members)
          assert.equal(readdirSync(config.state).includes('terminal.sqlite'), false);
      } finally {
        f.close();
      }
    });
  }
}

for (const step of ['pick', 'create', 'acknowledge', 'commit'] as const) {
  test(`cancelling ${step} leaves no new state or admission`, async () => {
    const f = fixture();
    try {
      if (step === 'pick') f.ports.choose = async () => undefined;
      else if (step === 'commit') f.ports.commit = async () => false;
      else f.ports.confirm = async (key) => key !== step;
      const result = await prepareTauriTerminals(
        { action: 'create', provider: 'codex', count: 4 },
        f.context,
        f.ports,
      );
      assert.equal(result.status, 'cancelled');
      assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
    } finally {
      f.close();
    }
  });
}

test('cancelled opening retains complete files and a new native review can open the same identities', async () => {
  const f = fixture();
  try {
    f.ports.confirm = async (key) => key !== 'open';
    const result = await prepareTauriTerminals(
      { action: 'create', provider: 'codex', count: 4 },
      f.context,
      f.ports,
    );
    assert.equal(result.status, 'prepared');
    const identities = inspectManagedTerminalFiles(result.files, 8).map(
      ({ config }) => config.identity,
    );
    f.ports.choose = async () => {
      throw new Error('Review must not pick files or create anything');
    };
    f.ports.commit = async () => {
      throw new Error('Review must not provision');
    };
    f.ports.confirm = async () => true;
    const reviewed = await prepareTauriTerminals(
      { action: 'review', files: result.files },
      f.context,
      f.ports,
    );
    assert.equal(reviewed.status, 'open');
    assert.deepEqual(
      inspectManagedTerminalFiles(reviewed.files, 8).map(({ config }) => config.identity),
      identities,
    );
  } finally {
    f.close();
  }
});

for (const stage of ['pick', 'create', 'acknowledge', 'open'] as const) {
  test(`switching native surfaces during ${stage} cannot revive the old preparation on return`, async () => {
    const f = fixture();
    let generation = 0;
    const originalGeneration = generation;
    f.ports.current = () => generation === originalGeneration;
    const choose = f.ports.choose;
    f.ports.choose = async (directory) => {
      const selected = await choose(directory);
      if (stage === 'pick') generation++;
      return selected;
    };
    f.ports.confirm = async (key) => {
      if (key === stage) generation++;
      // Returning to the original dashboard never restores its old generation.
      return true;
    };
    try {
      const result = await prepareTauriTerminals(
        { action: 'create', provider: 'codex', count: 4 },
        f.context,
        f.ports,
      );
      assert.equal(result.status, stage === 'open' ? 'prepared' : 'cancelled');
      if (stage === 'open') {
        const members = inspectManagedTerminalFiles(result.files, 8);
        assert.equal(members.length, 4);
        assert.ok(
          members.every(({ config }) => !readdirSync(config.state).includes('terminal.sqlite')),
        );
      } else {
        assert.deepEqual(result.files, []);
        assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
      }
      assert.equal(
        readFileSync(join(f.context.parent, 'unknown-reservation'), 'utf8'),
        'SYNTHETIC-PRESERVE',
      );
    } finally {
      f.close();
    }
  });
}

test('expiry and directory drift after native review prevent publication', async () => {
  const f = fixture();
  try {
    let now = 0;
    f.ports.confirm = async () => {
      now += 60_000;
      return true;
    };
    assert.equal(
      (
        await prepareTauriTerminals(
          { action: 'create', provider: 'codex', count: 1 },
          f.context,
          f.ports,
          () => now,
        )
      ).status,
      'cancelled',
    );
    assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
    f.ports.confirm = async () => true;
    f.ports.commit = async () => {
      writeFileSync(join(f.project, 'SYNTHETIC-DRIFT'), 'changed');
      return true;
    };
    await assert.rejects(
      prepareTauriTerminals({ action: 'create', provider: 'codex', count: 1 }, f.context, f.ports),
      (error: unknown) => {
        assert.deepEqual(Reflect.get(error as object, 'failure'), {
          stage: 'provision',
          code: 'failed',
          effects: 'possible',
        });
        return true;
      },
    );
    assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
  } finally {
    f.close();
  }
});

test('a manifest changed during opening review is never returned as open', async () => {
  const f = fixture();
  try {
    f.ports.confirm = async (key, detail) => {
      if (key === 'open') {
        const slots = JSON.parse(detail) as Array<{ file: string }>;
        writeFileSync(slots[0]!.file, '{}', { mode: 0o600 });
      }
      return true;
    };
    const result = await prepareTauriTerminals(
      { action: 'create', provider: 'codex', count: 1 },
      f.context,
      f.ports,
    );
    assert.equal(result.status, 'prepared');
  } finally {
    f.close();
  }
});

test('unreviewed version and strict native request bounds remain enforced', async () => {
  const f = fixture();
  try {
    const ports = {
      ...f.ports,
      authorizeCli: async (candidate: Parameters<TauriPreparationPorts['authorizeCli']>[0]) => ({
        ...(await f.ports.authorizeCli(candidate)),
        version: '999.0.0',
      }),
    };
    await assert.rejects(
      productionPreparation({ action: 'create', provider: 'codex', count: 1 }, f.context, ports),
      (error: unknown) => {
        assert.deepEqual(tauriPreparationFailure(error), {
          stage: 'plan',
          code: 'failed',
          effects: 'not_started',
        });
        assert.ok(!String(error).includes(f.context.node));
        return true;
      },
    );
    for (const request of [
      { action: 'create', provider: 'opencode', count: 1 },
      { action: 'create', provider: 'codex', count: 9 },
      { action: 'create', provider: 'codex', count: 1, mcp: true },
      { action: 'review', files: [] },
    ])
      assert.equal(tauriPreparationSchema.safeParse(request).success, false);
    assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
  } finally {
    f.close();
  }
});

test(
  'private packaged helper provisions through bounded correlated IPC without starting any provider',
  { skip: !nativePreparationSupported },
  async () => {
    const f = fixture();
    mkdirSync(join(f.context.parent, 'managed-agents'), { mode: 0o700 });
    const child = spawn(
      process.execPath,
      [
        join(bundle, 'host.cjs'),
        JSON.stringify({ action: 'create', provider: 'codex', count: 4 }),
        f.context.parent,
      ],
      {
        env: { HOME: f.context.home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const exit = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    const messages: Array<Record<string, unknown>> = [];
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      const value = JSON.parse(line) as Record<string, unknown>;
      messages.push(value);
      if (value.kind !== 'complete')
        child.stdin.write(
          JSON.stringify({
            id: value.id,
            value: value.kind === 'pick' ? (value.directory ? f.project : f.executable) : true,
          }) + '\n',
        );
    });
    try {
      assert.equal((await exit)[0], 0);
      const result = messages.at(-1)!;
      assert.equal(result.kind, 'complete');
      assert.equal(result.status, 'open');
      const members = inspectManagedTerminalFiles(result.files as string[], 8);
      assert.equal(members.length, 4);
      assert.ok(
        members.every(({ config }) => !readdirSync(config.state).includes('terminal.sqlite')),
      );
      assert.deepEqual(readdirSync(f.project), []);
    } finally {
      clearTimeout(timer);
      child.kill();
      f.close();
    }
  },
);

for (const fault of ['eof', 'wrong-id', 'oversized'] as const) {
  test(
    `private preparation parent ${fault} cannot write state`,
    { skip: !nativePreparationSupported },
    async () => {
      const f = fixture();
      const child = spawn(
        process.execPath,
        [
          join(bundle, 'host.cjs'),
          JSON.stringify({ action: 'create', provider: 'codex', count: 1 }),
          f.context.parent,
        ],
        {
          env: { HOME: f.context.home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const exit = once(child, 'exit');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      child.stderr.resume();
      const messages: Array<Record<string, unknown>> = [];
      createInterface({ input: child.stdout }).on('line', (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        messages.push(message);
        if (fault === 'eof') child.stdin.end();
        else
          child.stdin.write(
            JSON.stringify({
              id: fault === 'wrong-id' ? 999 : message.id,
              value: fault === 'oversized' ? 'x'.repeat(17000) : f.executable,
            }) + '\n',
          );
      });
      try {
        assert.equal((await exit)[0], 0);
        assert.equal(
          messages.some((value) => value.kind === 'complete'),
          false,
        );
        assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
        assert.deepEqual(readdirSync(f.project), []);
      } finally {
        clearTimeout(timer);
        child.kill();
        f.close();
      }
    },
  );
}

test('unknown preparation errors never become no-effect claims or leak raw data', () => {
  const secret = 'SYNTHETIC /private/config token proof stderr';
  assert.deepEqual(tauriPreparationFailure(new Error(secret)), {
    stage: 'bootstrap',
    code: 'failed',
    effects: 'possible',
  });
  assert.deepEqual(
    tauriPreparationFailure(
      new TauriPreparationError({
        stage: 'opening',
        code: 'failed',
        effects: 'not_started',
      }),
    ),
    { stage: 'bootstrap', code: 'failed', effects: 'possible' },
  );
  const error = new TauriPreparationError({
    stage: 'revalidation',
    code: 'catalog_changed',
    effects: 'not_started',
  });
  assert.deepEqual(tauriPreparationFailure(error), error.failure);
  assert.ok(!JSON.stringify(tauriPreparationFailure(new Error(secret))).includes(secret));
});

test('a stale CLI authorization refuses creation and asks for a fresh review', async () => {
  const f = fixture();
  try {
    f.ports.authorizeCli = async () => ({ status: 'stale' });
    await assert.rejects(
      prepareTauriTerminals({ action: 'create', provider: 'codex', count: 1 }, f.context, f.ports),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'failure' in error);
        assert.equal(Reflect.get(error.failure as object, 'code'), 'cli_authorization_stale');
        return true;
      },
    );
    assert.deepEqual(readdirSync(f.context.parent), ['unknown-reservation']);
    assert.deepEqual(readdirSync(f.project), []);
  } finally {
    f.close();
  }
});
