// Synthetic executables and state only. No installed provider or authentication query.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  discoverLocalClis,
  localCliDiscoveryPolicy,
  localCliIntegrationPlan,
} from '../packages/core/src/terminal/local-cli.js';
import { claudeDescriptor } from '../packages/adapters/claude/src/index.js';
import { opencodeDescriptor } from '../packages/adapters/opencode/src/index.js';

const run = promisify(execFile);
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-cli-discovery-')));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  return { root, bin };
}

test('passive discovery resolves CLI aliases, deduplicates and retains PATH priority without execution', () => {
  const f = fixture();
  try {
    const canonical = join(f.root, 'synthetic-codex');
    writeFileSync(canonical, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
    symlinkSync(canonical, join(f.bin, 'codex'));
    const next = join(f.root, 'second');
    mkdirSync(next);
    symlinkSync(canonical, join(next, 'codex'));
    writeFileSync(join(f.bin, 'claude'), 'SYNTHETIC-NEVER-EXECUTE', { mode: 0o700 });
    const discovery = discoverLocalClis([f.bin, next, f.bin].join(delimiter));
    assert.deepEqual(discovery[0]!.candidates, [{ launcher: join(f.bin, 'codex'), canonical }]);
    assert.equal(discovery[0]!.inspection, 'complete');
    assert.equal(discovery[1]!.lookup, 'candidate_found');
    assert.equal(discovery[2]!.lookup, 'not_found');
    for (const item of discovery) {
      assert.equal(item.version, null);
      assert.equal(item.authentication, 'unknown');
      assert.equal(item.execution, 'not_authorized');
      const plan = localCliIntegrationPlan(item);
      assert.equal(plan.authenticationPolicy, 'reuse_existing');
      assert.equal(plan.automaticInstall, false);
      assert.equal(plan.automaticLogin, false);
      assert.equal(plan.execution, 'blocked');
    }
    assert.equal(claudeDescriptor.implemented, false);
    assert.equal(opencodeDescriptor.implemented, false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('discovery rejects non-executables, directories, broken links and cwd-relative lookup', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.bin, 'codex'), 'SYNTHETIC', { mode: 0o600 });
    mkdirSync(join(f.bin, 'claude'));
    symlinkSync(join(f.root, 'absent'), join(f.bin, 'opencode'));
    assert.ok(discoverLocalClis(f.bin).every((item) => item.lookup === 'not_found'));
    assert.ok(
      discoverLocalClis(`.${delimiter}${delimiter}relative`).every(
        (item) => item.candidates.length === 0,
      ),
    );
    const loop = join(f.root, 'loop');
    mkdirSync(loop);
    symlinkSync(join(loop, 'codex'), join(loop, 'codex'));
    assert.equal(discoverLocalClis(loop)[0]!.lookup, 'incomplete');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('bounded discovery reports partial inspection and ambiguous canonical candidates', () => {
  const f = fixture();
  try {
    const entries = Array.from({ length: 140 }, (_, index) => join(f.root, `bin-${index}`));
    for (const directory of entries.slice(0, 18)) {
      mkdirSync(directory);
      writeFileSync(join(directory, 'codex'), 'SYNTHETIC', { mode: 0o700 });
    }
    const discovery = discoverLocalClis(entries.join(delimiter));
    assert.equal(discovery[0]!.candidates.length, localCliDiscoveryPolicy.maximumCandidates);
    assert.equal(discovery[0]!.inspection, 'limited');
    assert.equal(discovery[1]!.lookup, 'incomplete');
    assert.ok(localCliIntegrationPlan(discovery[0]!).blockers.includes('discovery_incomplete'));
    assert.ok(
      localCliIntegrationPlan(discovery[0]!).blockers.includes(
        'explicit_executable_selection_required',
      ),
    );
    assert.throws(() => discoverLocalClis('x'.repeat(32769)), /budget/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('developer discovery never runs fixture CLI or opens synthetic authentication; setup defaults to no writes', async () => {
  const f = fixture();
  try {
    const marker = join(f.root, 'executed');
    // If accidentally invoked, this fixture would leave an observable side effect.
    writeFileSync(join(f.bin, 'codex'), `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o700 });
    const auth = join(f.root, 'auth.json');
    writeFileSync(auth, 'SYNTHETIC-SECRET-MUST-NOT-APPEAR', { mode: 0o000 });
    const environment = { PATH: f.bin, HOME: f.root, CODEX_HOME: f.root };
    const result = await run(
      process.execPath,
      ['--import', 'tsx', resolve('scripts/discover-local-clis.ts')],
      { env: environment },
    );
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes('SYNTHETIC-SECRET'));
    assert.equal(JSON.parse(result.stdout).providers[0].authentication, 'unknown');
    assert.equal(existsSync(marker), false);
    const state = join(f.root, 'must-not-be-created');
    for (const authentication of [[], ['--authentication', 'reuse-existing']]) {
      await assert.rejects(
        run(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve('scripts/setup-managed-terminal.ts'),
            ...authentication,
            '--state',
            state,
          ],
          { env: environment },
        ),
        /No state created/,
      );
      assert.equal(existsSync(state), false);
      assert.equal(existsSync(marker), false);
    }
    chmodSync(auth, 0o600);
    assert.equal(readFileSync(auth, 'utf8'), 'SYNTHETIC-SECRET-MUST-NOT-APPEAR');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('legacy setup requires explicit auth choice and complete unambiguous discovery before provisioning', async () => {
  const f = fixture();
  try {
    // Use the current native Node as a hash-only synthetic executable, never as a provider.
    symlinkSync(process.execPath, join(f.bin, 'codex'));
    const project = join(f.root, 'synthetic-project');
    mkdirSync(project, { mode: 0o700 });
    const state = join(f.root, 'synthetic-managed');
    const args = [
      '--import',
      'tsx',
      resolve('scripts/setup-managed-terminal.ts'),
      '--authentication',
      'separate-login',
      '--executable-version',
      'SYNTHETIC-NODE-NOT-CODEX',
      '--project',
      project,
      '--state',
      state,
    ];
    const environment = { PATH: f.bin };
    await run(process.execPath, args, { env: environment });
    const config = JSON.parse(readFileSync(join(state, 'terminal.json'), 'utf8'));
    assert.equal(config.executable.path, realpathSync(process.execPath));
    assert.equal(config.state, state);
    assert.equal(existsSync(join(state, 'codex/auth.json')), false);
    await assert.rejects(run(process.execPath, args, { env: environment }), /EEXIST/);
    const second = join(f.root, 'second');
    mkdirSync(second);
    writeFileSync(join(second, 'codex'), 'SYNTHETIC-SHIM', { mode: 0o700 });
    const otherState = join(f.root, 'must-not-exist');
    const ambiguous = [...args.slice(0, -1), otherState];
    await assert.rejects(
      run(process.execPath, ambiguous, {
        env: { PATH: [f.bin, second].join(delimiter) },
      }),
      /no unique Codex candidate/,
    );
    assert.equal(existsSync(otherState), false);
    await assert.rejects(
      run(process.execPath, ambiguous, {
        env: {
          PATH: [
            f.bin,
            ...Array.from({ length: 129 }, (_, index) => join(f.root, `absent-${index}`)),
          ].join(delimiter),
        },
      }),
      /no unique Codex candidate/,
    );
    assert.equal(existsSync(otherState), false);
    await assert.rejects(
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('scripts/accept-codex-two-agent.ts'),
          '--authorize-real-codex',
          '--acknowledge-advisory-cost-only',
          '--cleanup-owned-processes',
          '--acceptance-root',
          '/SYNTHETIC-MUST-NOT-BE-READ',
          '--model',
          'SYNTHETIC',
        ],
        { env: environment },
      ),
      /Requires explicit.*--authentication separate-login/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('existing-login setup requires shared-config acknowledgment and never reads or copies synthetic secrets', async () => {
  const f = fixture();
  try {
    symlinkSync(process.execPath, join(f.bin, 'codex'));
    const project = join(f.root, 'synthetic-project');
    const nativeHome = join(f.root, 'synthetic-native-home');
    mkdirSync(project, { mode: 0o700 });
    mkdirSync(nativeHome, { mode: 0o700 });
    for (const name of ['auth.json', 'config.toml'])
      writeFileSync(join(nativeHome, name), 'SYNTHETIC-SECRET-MUST-NOT-BE-COPIED', { mode: 0o000 });
    const state = join(f.root, 'new-slot');
    const args = [
      '--import',
      'tsx',
      resolve('scripts/setup-managed-terminal.ts'),
      '--authentication',
      'reuse-existing',
      '--executable-version',
      'SYNTHETIC-NODE-NOT-CODEX',
      '--project',
      project,
      '--state',
      state,
      '--user-home',
      f.root,
      '--codex-home',
      nativeHome,
    ];
    const environment = { PATH: f.bin };
    await assert.rejects(run(process.execPath, args, { env: environment }), /No state created/);
    assert.equal(existsSync(state), false);
    for (const extra of [['--interactive'], ['--acknowledge-shared-native-sessions']]) {
      await assert.rejects(
        run(process.execPath, [...args, '--acknowledge-shared-native-config', ...extra], {
          env: environment,
        }),
        /No state created/,
      );
      assert.equal(existsSync(state), false);
    }
    const output = await run(process.execPath, [...args, '--acknowledge-shared-native-config'], {
      env: environment,
    });
    const config = JSON.parse(readFileSync(join(state, 'terminal.json'), 'utf8'));
    assert.equal(config.authentication.mode, 'reuse-existing');
    assert.equal(config.authentication.codexHome, nativeHome);
    assert.equal(config.authentication.sharedNativeConfiguration, true);
    assert.equal(existsSync(join(state, 'codex/auth.json')), false);
    assert.ok(!JSON.stringify(config).includes('SYNTHETIC-SECRET'));
    assert.ok(!output.stdout.includes('SYNTHETIC-SECRET'));
    await assert.rejects(
      run(process.execPath, [...args, '--acknowledge-shared-native-config'], { env: environment }),
      /EEXIST/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
