// Disposable synthetic executables only. Installed providers and native credentials are never opened.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import {
  localCliPathDirectories,
  terminalToolPath,
} from '../packages/core/src/terminal/local-cli-path.js';
import { discoverLocalClis } from '../packages/core/src/terminal/local-cli.js';
import {
  managedCodexConfigSchema,
  managedCodexEnvironment,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  interactiveTerminalEnvironment,
  managedClaudeConfigSchema,
} from '../packages/core/src/terminal/interactive-profile.js';
import {
  managedOpenCodeConfigSchema,
  openCodeTerminalEnvironment,
} from '../packages/core/src/terminal/opencode-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-tool-path-')));
  chmodSync(home, 0o700);
  const env = join(home, 'env-bin');
  const local = join(home, '.local/bin');
  const claude = join(home, '.claude/local');
  const opencode = join(home, '.opencode/bin');
  for (const path of [env, local, claude, opencode])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  return {
    home,
    env,
    local,
    claude,
    opencode,
    close: () => rmSync(home, { recursive: true, force: true }),
  };
}

test('one passive path policy preserves environment priority, reports origins and deduplicates directory identity', () => {
  const f = fixture();
  try {
    const alias = join(f.home, 'alias');
    symlinkSync(f.env, alias);
    const search = localCliPathDirectories(
      [f.env, '.', '', 'relative', alias, f.local].join(delimiter),
      f.home,
    );
    assert.equal(search.inspection, 'complete');
    assert.deepEqual(
      search.directories.filter(({ path }) => path.startsWith(f.home)),
      [
        { path: f.env, origin: 'env' },
        { path: f.local, origin: 'env' },
        { path: f.claude, origin: 'fallback' },
        { path: f.opencode, origin: 'fallback' },
      ],
    );
    assert.equal(terminalToolPath(search.path), search.path);
    const selected = join(f.home, 'selected-host-bin');
    mkdirSync(selected, { mode: 0o700 });
    symlinkSync(process.execPath, join(selected, 'codex'));
    const withSelection = localCliPathDirectories(f.env, f.home, [selected]);
    assert.deepEqual(withSelection.directories.at(-1), { path: selected, origin: 'fallback' });
    assert.equal(
      discoverLocalClis(f.env, f.home, [selected])[0]!.candidates.at(-1)?.launcher,
      join(selected, 'codex'),
    );
    assert.throws(() => terminalToolPath(alias), /canonical/);
    assert.throws(() => terminalToolPath(`${f.env}${delimiter}${f.env}`), /duplicate directory/);
    assert.throws(() => terminalToolPath(`.${delimiter}${f.env}`), /nonabsolute/);
  } finally {
    f.close();
  }
});

test('GUI minimal PATH discovers synthetic native installer locations without a shell or provider probe', () => {
  const f = fixture();
  try {
    for (const [name, directory] of [
      ['codex', f.local],
      ['claude', f.claude],
      ['opencode', f.opencode],
    ])
      symlinkSync(process.execPath, join(directory!, name!));
    const discovery = discoverLocalClis('/usr/bin:/bin:/usr/sbin:/sbin', f.home);
    for (const item of discovery) {
      assert.equal(item.lookup, 'candidate_found');
      assert.ok(
        item.candidates.some(
          (candidate) => candidate.origin === 'fallback' && candidate.launcher.startsWith(f.home),
        ),
      );
      assert.equal(item.authentication, 'unknown');
      assert.equal(item.version, null);
      assert.equal(item.execution, 'not_authorized');
    }
  } finally {
    f.close();
  }
});

function syntheticTool(directory: string, name: string, output: string): void {
  writeFileSync(
    join(directory, name),
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(output)});\n`,
    { mode: 0o700 },
  );
}
function runSyntheticTool(path: string, name: string): string {
  const child = spawnSync(name, [], { env: { PATH: path }, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}

test('GUI selected tool homonyms precede installer tools and system git stubs', () => {
  const f = fixture();
  try {
    const tools = join(f.home, 'selected-tools');
    mkdirSync(tools, { mode: 0o700 });
    syntheticTool(tools, 'git', 'SYNTHETIC_SELECTED');
    syntheticTool(f.local, 'git', 'SYNTHETIC_INSTALLER');
    const gui = localCliPathDirectories('/usr/bin:/bin:/usr/sbin:/sbin', f.home, [tools]);
    assert.equal(gui.precedence, 'selected-installers-system');
    assert.equal(gui.directories[0]?.path, tools);
    assert.equal(runSyntheticTool(gui.path, 'git'), 'SYNTHETIC_SELECTED');
  } finally {
    f.close();
  }
});

test('GUI installer tool homonyms precede system git stubs without a selected directory', () => {
  const f = fixture();
  try {
    syntheticTool(f.local, 'git', 'SYNTHETIC_INSTALLER');
    const gui = localCliPathDirectories('/usr/bin:/bin:/usr/sbin:/sbin', f.home);
    assert.equal(gui.precedence, 'selected-installers-system');
    assert.equal(gui.directories[0]?.path, f.local);
    assert.equal(runSyntheticTool(gui.path, 'git'), 'SYNTHETIC_INSTALLER');
  } finally {
    f.close();
  }
});

test('custom environment PATH keeps its deliberate order and wins tool homonyms', () => {
  const f = fixture();
  try {
    syntheticTool(f.env, 'fixture-tool', 'SYNTHETIC_ENV');
    syntheticTool(f.local, 'fixture-tool', 'SYNTHETIC_INSTALLER');
    const explicit = localCliPathDirectories(['/usr/bin', f.env].join(delimiter), f.home, [
      f.local,
    ]);
    assert.equal(explicit.precedence, 'explicit-env-first');
    assert.equal(explicit.directories[0]?.path, realpathSync('/usr/bin'));
    assert.ok(explicit.path.indexOf('/usr/bin') < explicit.path.indexOf(f.local));
    assert.equal(runSyntheticTool(explicit.path, 'fixture-tool'), 'SYNTHETIC_ENV');
  } finally {
    f.close();
  }
});

test('explicit installer PATH priority and environment origin survive deduplication', () => {
  const f = fixture();
  try {
    syntheticTool(f.env, 'fixture-tool', 'SYNTHETIC_ENV');
    syntheticTool(f.local, 'fixture-tool', 'SYNTHETIC_INSTALLER');
    const explicit = localCliPathDirectories([f.local, f.env, '/usr/bin'].join(delimiter), f.home, [
      f.local,
    ]);
    assert.equal(explicit.precedence, 'explicit-env-first');
    assert.deepEqual(explicit.directories[0], { path: f.local, origin: 'env' });
    assert.equal(explicit.directories.filter(({ path }) => path === f.local).length, 1);
    assert.equal(runSyntheticTool(explicit.path, 'fixture-tool'), 'SYNTHETIC_INSTALLER');
  } finally {
    f.close();
  }
});

test('explicitly selected missing, writable, noncanonical or unrepresentable tool directories fail closed', () => {
  const f = fixture();
  try {
    const alias = join(f.home, 'alias');
    symlinkSync(f.env, alias);
    const colon = join(f.home, 'synthetic:delimiter');
    mkdirSync(colon, { mode: 0o700 });
    for (const selected of [join(f.home, 'missing'), alias, colon, 'relative', '/'])
      assert.throws(
        () => localCliPathDirectories('/usr/bin:/bin', f.home, [selected]),
        /Selected CLI tool directory is unavailable or unsafe/,
      );
    chmodSync(f.env, 0o777);
    assert.throws(
      () => localCliPathDirectories('/usr/bin:/bin', f.home, [f.env]),
      /Selected CLI tool directory is unavailable or unsafe/,
    );
  } finally {
    f.close();
  }
});

test('untrusted directories, changed aliases and exceeded budgets cannot become a reviewed child PATH', () => {
  const f = fixture();
  try {
    chmodSync(f.env, 0o777);
    assert.deepEqual(localCliPathDirectories(f.env).rejected, [
      { path: f.env, origin: 'env', reason: 'unsafe_directory' },
    ]);
    assert.throws(() => terminalToolPath(f.env), /changed/);
    chmodSync(f.env, 0o700);
    const reviewed = terminalToolPath(f.env);
    rmSync(f.env, { recursive: true });
    symlinkSync(f.local, f.env);
    assert.throws(() => terminalToolPath(reviewed), /no longer canonical/);
    const excess = Array.from({ length: 129 }, (_, index) => join(f.home, `absent-${index}`)).join(
      delimiter,
    );
    assert.equal(localCliPathDirectories(excess).inspection, 'limited');
    assert.throws(() => localCliPathDirectories('x'.repeat(32769)), /budget/);
    assert.throws(() => terminalToolPath(''));
    assert.throws(() => terminalToolPath('/'), /filesystem root/);
    assert.equal(localCliPathDirectories('/').directories.length, 0);
    const unrepresentable = join(f.home, 'synthetic:delimiter');
    mkdirSync(unrepresentable, { mode: 0o700 });
    const alias = join(f.home, 'delimiter-alias');
    symlinkSync(unrepresentable, alias);
    assert.equal(localCliPathDirectories(alias).directories.length, 0);
    assert.equal(localCliPathDirectories(alias).rejected[0]?.reason, 'unsafe_directory');
  } finally {
    f.close();
  }
});

test('discovery and every provider child environment use the exact reviewed PATH, retaining the environment whitelist', () => {
  const f = fixture();
  try {
    symlinkSync(process.execPath, join(f.local, 'codex'));
    symlinkSync(process.execPath, join(f.local, 'synthetic-tool'));
    const search = localCliPathDirectories('/usr/bin:/bin:/usr/sbin:/sbin', f.home);
    const common = {
      trust: 'native-same-user',
      executable: { path: realpathSync(process.execPath), sha256: 'a'.repeat(64) },
      node: { path: realpathSync(process.execPath), sha256: 'b'.repeat(64) },
      project: f.home,
      state: join(f.home, 'state'),
      toolPath: search.path,
    };
    const codex = managedCodexConfigSchema.parse({
      ...common,
      version: 1,
      executableVersion: 'SYNTHETIC',
      authentication: {
        mode: 'reuse-existing',
        home: f.home,
        codexHome: f.home,
        sharedNativeConfiguration: true,
      },
      interactive: { sharedNativeSessions: true },
    });
    const claude = managedClaudeConfigSchema.parse({
      ...common,
      version: 2,
      provider: 'claude',
      executableVersion: reviewedProviderMcpBinaries.claude.version,
      sessionId: '11111111-1111-4111-8111-111111111111',
      authentication: { mode: 'reuse-existing', home: f.home, sharedNativeConfiguration: true },
      interactive: { sharedNativeSessions: true },
    });
    const opencode = managedOpenCodeConfigSchema.parse({
      ...common,
      version: 3,
      provider: 'opencode',
      executable: { ...common.executable, sha256: reviewedProviderMcpBinaries.opencode.sha256 },
      executableVersion: reviewedProviderMcpBinaries.opencode.version,
      authentication: {
        mode: 'reuse-existing',
        nativeIdentity: { HOME: f.home },
        sharedNativeConfiguration: true,
      },
      interactive: { sharedNativeSessions: true, nativeStartupAuthorized: false },
    });
    const discovery = discoverLocalClis('/usr/bin:/bin:/usr/sbin:/sbin', f.home);
    assert.ok(discovery[0]!.candidates.some(({ launcher }) => launcher === join(f.local, 'codex')));
    for (const env of [
      managedCodexEnvironment(codex),
      interactiveTerminalEnvironment(claude),
      openCodeTerminalEnvironment(opencode),
    ]) {
      assert.equal(env.PATH, search.path);
      assert.ok(env.PATH!.split(delimiter).includes(f.local));
      for (const name of [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'NODE_OPTIONS',
        'ELECTRON_RUN_AS_NODE',
        'ORQST_SOCKET_PATH',
      ])
        assert.equal(name in env, false);
      // This starts only the known local Node interpreter as a disposable synthetic child.
      // Its tool lookup exercises the same environment sent to the private PTY host.
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `const {spawnSync}=require('node:child_process');const r=spawnSync('synthetic-tool',['-e','process.stdout.write("SYNTHETIC_TOOL_FOUND")'],{encoding:'utf8'});process.stdout.write(r.stdout||'');process.exit(r.status??1)`,
        ],
        {
          env,
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, 'SYNTHETIC_TOOL_FOUND');
    }
    delete codex.toolPath;
    assert.equal(managedCodexEnvironment(codex).PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  } finally {
    f.close();
  }
});

const roundTrips: {
  name: string;
  mutate?: (f: ReturnType<typeof fixture>) => void;
  error?: RegExp;
}[] = [
  { name: 'unchanged canonical path remains usable' },
  {
    name: 'missing directory reports a safe missing/access reason',
    mutate: (f) => rmSync(f.env, { recursive: true }),
    error: /missing or inaccessible/,
  },
  {
    name: 'permission drift reports a safe ownership/permissions reason',
    mutate: (f) => chmodSync(f.env, 0o777),
    error: /ownership or permissions changed/,
  },
  {
    name: 'symlink replacement reports a canonicality reason',
    mutate: (f) => {
      rmSync(f.env, { recursive: true });
      symlinkSync(f.local, f.env);
    },
    error: /no longer canonical/,
  },
  {
    name: 'trusted replacement at the same path is not an inode-persistence guarantee',
    mutate: (f) => {
      rmSync(f.env, { recursive: true });
      mkdirSync(f.env, { mode: 0o700 });
    },
  },
];
for (const entry of roundTrips) {
  test(`reviewed PATH JSON round trip: ${entry.name}`, () => {
    const f = fixture();
    try {
      const stored = JSON.parse(JSON.stringify({ toolPath: terminalToolPath(f.env) })) as {
        toolPath: string;
      };
      entry.mutate?.(f);
      if (entry.error) assert.throws(() => terminalToolPath(stored.toolPath), entry.error);
      else assert.equal(terminalToolPath(stored.toolPath), stored.toolPath);
    } finally {
      f.close();
    }
  });
}
