// Real synthetic PTY process. Reviewed hash substitution exists ONLY in disposable test bundles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { build, type PluginBuild } from 'esbuild';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import type { ManagedOpenCodeConfig } from '../packages/core/src/terminal/opencode-profile.js';
import type { ManagedClaudeConfig } from '../packages/core/src/terminal/interactive-profile.js';
import type {
  TerminalEvents,
  OwnedTerminalHandle,
} from '../packages/core/src/terminal/supervisor.js';

for (const provider of ['claude', 'opencode'] as const)
  test(
    `${provider}-shaped synthetic PTY revalidates native launch, owns exit and refuses reuse/drift`,
    { skip: process.platform !== 'darwin' || process.arch !== 'arm64', timeout: 20000 },
    async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-claude-fixture-')));
      const require = createRequire(import.meta.url);
      let handle: OwnedTerminalHandle | undefined;
      try {
        const fake = join(root, 'SYNTHETIC-NOT-A-PROVIDER');
        execFileSync('/usr/bin/cc', [
          resolve('tests/helpers/managed-terminal-fixture.c'),
          '-o',
          fake,
        ]);
        const hash = terminalExecutableSha256(fake);
        const state = join(root, 'state');
        const home = join(root, 'native-home');
        const project = join(root, 'project');
        for (const dir of [state, home, project, join(state, 'tmp')])
          mkdirSync(dir, { mode: 0o700 });
        if (provider === 'claude') mkdirSync(join(home, '.claude'), { mode: 0o700 });
        const nativeSentinel = join(home, 'SYNTHETIC-DO-NOT-READ');
        writeFileSync(nativeSentinel, 'SYNTHETIC-UNCHANGED', { mode: 0o000 });
        const node = realpathSync(process.execPath);
        const config: ManagedClaudeConfig | ManagedOpenCodeConfig =
          provider === 'opencode'
            ? {
                version: 3,
                provider,
                trust: 'native-same-user',
                executable: {
                  path: fake,
                  sha256: hash as ManagedOpenCodeConfig['executable']['sha256'],
                },
                executableVersion: '2.2.5',
                node: { path: node, sha256: terminalExecutableSha256(node) },
                project,
                state,
                authentication: {
                  mode: 'reuse-existing',
                  nativeIdentity: {
                    HOME: home,
                    OPENCODE_DB: join(home, 'SYNTHETIC-NOT-OPENED.db'),
                  },
                  sharedNativeConfiguration: true,
                },
                interactive: {
                  sharedNativeSessions: true,
                  nativeStartupAuthorized: true,
                  nativeDatabaseMigrationsAcknowledged: true,
                  nativeStartupActivityAcknowledged: true,
                },
              }
            : {
                version: 2,
                provider: 'claude',
                trust: 'native-same-user',
                executable: { path: fake, sha256: hash },
                executableVersion: '2.1.178',
                node: { path: node, sha256: terminalExecutableSha256(node) },
                project,
                state,
                sessionId: randomUUID(),
                authentication: { mode: 'reuse-existing', home, sharedNativeConfiguration: true },
                interactive: { sharedNativeSessions: true },
              };
        const file = join(state, 'terminal.json');
        writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
        // Compile isolated fixture bundles; never change the checked-in contract or Desktop output.
        const options = {
          bundle: true,
          platform: 'node' as const,
          format: 'cjs' as const,
          target: 'node24',
          plugins: [
            {
              name: 'synthetic-reviewed-hash-only',
              setup(builder: PluginBuild) {
                builder.onLoad({ filter: /provider-mcp-config\.ts$/ }, (args) => ({
                  contents: readFileSync(args.path, 'utf8')
                    .replace(reviewedProviderMcpBinaries.claude.sha256, hash)
                    .replace(reviewedProviderMcpBinaries.opencode.sha256, hash),
                  loader: 'ts',
                }));
              },
            },
          ],
        };
        await build({
          ...options,
          entryPoints: ['packages/core/src/terminal/pty-host.ts'],
          outfile: join(root, 'host.cjs'),
          external: ['node-pty'],
        });
        await build({
          ...options,
          stdin: {
            contents:
              "export { managedTerminalBackend } from './packages/core/src/terminal/pty-backend.ts'; export { readInteractiveTerminalConfig, interactiveTerminalProfiles } from './packages/core/src/terminal/interactive-profile.ts'; export { inspectManagedTerminalFiles } from './packages/core/src/terminal/managed-files.ts';",
            resolveDir: process.cwd(),
            loader: 'ts',
          },
          outfile: join(root, 'driver.cjs'),
        });
        cpSync(dirname(require.resolve('node-pty/package.json')), join(root, 'terminal-pty'), {
          recursive: true,
        });
        chmodSync(join(root, 'terminal-pty/prebuilds/darwin-arm64/spawn-helper'), 0o700);
        const fixture = require(
          join(root, 'driver.cjs'),
        ) as typeof import('../packages/core/src/terminal/pty-backend.js') &
          typeof import('../packages/core/src/terminal/interactive-profile.js') &
          typeof import('../packages/core/src/terminal/managed-files.js');
        const profile = fixture.interactiveTerminalProfiles(
          fixture.readInteractiveTerminalConfig(file),
        )[0]!;
        const otherState = join(root, 'other-state');
        mkdirSync(otherState, { mode: 0o700 });
        mkdirSync(join(otherState, 'tmp'), { mode: 0o700 });
        const otherFile = join(otherState, 'terminal.json');
        writeFileSync(otherFile, JSON.stringify({ ...config, state: otherState }), { mode: 0o600 });
        if (provider === 'claude')
          assert.throws(
            () => fixture.inspectManagedTerminalFiles([file, otherFile]),
            /Duplicate Claude session UUID/,
          );
        assert.equal(existsSync(join(state, 'terminal.sqlite')), false);
        assert.equal(existsSync(join(otherState, 'terminal.sqlite')), false);
        writeFileSync(
          otherFile,
          JSON.stringify({
            ...config,
            state: otherState,
            ...(provider === 'claude' ? { sessionId: randomUUID() } : {}),
          }),
        );
        assert.equal(fixture.inspectManagedTerminalFiles([file, otherFile]).length, 2);
        const sameProvider = readFileSync(otherFile, 'utf8');
        const common = {
          trust: config.trust,
          executable: config.executable,
          node: config.node,
          project,
          state: otherState,
        };
        const mixed =
          provider === 'claude'
            ? {
                ...common,
                version: 3,
                provider: 'opencode',
                executableVersion: reviewedProviderMcpBinaries.opencode.version,
                authentication: {
                  mode: 'reuse-existing',
                  nativeIdentity: { HOME: home },
                  sharedNativeConfiguration: true,
                },
                interactive: {
                  sharedNativeSessions: true,
                  nativeStartupAuthorized: true,
                  nativeDatabaseMigrationsAcknowledged: true,
                  nativeStartupActivityAcknowledged: true,
                },
              }
            : {
                ...common,
                version: 2,
                provider: 'claude',
                executableVersion: reviewedProviderMcpBinaries.claude.version,
                sessionId: randomUUID(),
                authentication: { mode: 'reuse-existing', home, sharedNativeConfiguration: true },
                interactive: { sharedNativeSessions: true },
              };
        writeFileSync(otherFile, JSON.stringify(mixed));
        assert.throws(() => fixture.inspectManagedTerminalFiles([file, otherFile]), /one provider/);
        if (provider === 'claude') {
          for (const name of ['home', 'codex']) mkdirSync(join(otherState, name), { mode: 0o700 });
          const codex: ManagedCodexConfig = {
            ...common,
            version: 1,
            executableVersion: 'SYNTHETIC-NOT-A-PROVIDER',
          };
          writeFileSync(join(otherState, 'codex/config.toml'), managedCodexSettings(codex), {
            mode: 0o600,
          });
          writeFileSync(otherFile, JSON.stringify(codex));
          assert.throws(
            () => fixture.inspectManagedTerminalFiles([file, otherFile]),
            /one provider/,
          );
        }
        writeFileSync(otherFile, sameProvider);

        const backend = fixture.managedTerminalBackend(file, join(root, 'host.cjs'));
        assert.equal(backend.validate(profile), true);
        assert.equal(backend.validate({ ...profile, argv: ['--resume'] }), false);
        let started = false;
        let startEvidence: { startedAt: number } | undefined;
        let exitEvidence: { startedAt: number; exitedAt: number } | undefined;
        let output = '';
        let exit: number | undefined;
        const events: TerminalEvents = {
          started: (evidence) => {
            started = true;
            startEvidence = evidence;
          },
          data: (text) => {
            output += text;
          },
          exit: (code, _signal, evidence) => {
            exit = code;
            exitEvidence = evidence;
          },
          lost: () => {},
        };
        handle = backend.start(profile, events, {
          instanceId: randomUUID(),
          epoch: randomUUID(),
          manifestDigest: 'a'.repeat(64),
        });
        const until = async (predicate: () => boolean) => {
          const deadline = Date.now() + 7000;
          while (!predicate() && Date.now() < deadline)
            await new Promise((done) => setTimeout(done, 10));
          assert.ok(predicate(), 'Synthetic owned PTY did not reach expected state');
        };
        await until(() => started && output.includes('SYNTHETIC:OWNED_TUI'));
        assert.ok(startEvidence?.startedAt);
        if (config.version === 2) {
          const transcriptDir = join(
            home,
            '.claude',
            'projects',
            project.replace(/[^a-zA-Z0-9-]/g, '-'),
          );
          mkdirSync(transcriptDir, { recursive: true, mode: 0o700 });
          writeFileSync(
            join(transcriptDir, `${config.sessionId}.jsonl`),
            JSON.stringify({
              sessionId: config.sessionId,
              cwd: project,
              timestamp: new Date().toISOString(),
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', name: 'Read', input: { secret: 'SYNTHETIC ONLY' } }],
              },
            }) + '\n',
            { mode: 0o600 },
          );
          const session = handle.sessionEvidence?.() as
            { session?: { sessionId?: string }; activities?: Array<{ label: string }> } | undefined;
          assert.equal(session?.session?.sessionId, config.sessionId);
          assert.equal(session?.activities?.[0]?.label, 'Read');
          assert.ok(!JSON.stringify(session).includes('SYNTHETIC ONLY'));
        }
        assert.equal(backend.validate(profile), false);
        assert.throws(
          () =>
            backend.start(profile, events, {
              instanceId: randomUUID(),
              epoch: randomUUID(),
              manifestDigest: 'b'.repeat(64),
            }),
          /changed/,
        );
        handle.write('ping\n');
        await until(() => output.includes('SYNTHETIC:PONG'));
        handle.write('exit\n');
        await until(() => exit === 0);
        assert.equal(exitEvidence?.startedAt, startEvidence.startedAt);
        assert.ok(exitEvidence && exitEvidence.exitedAt >= exitEvidence.startedAt);
        handle.dispose();
        handle = undefined;
        writeFileSync(file, JSON.stringify({ ...config, project: home }));
        assert.equal(backend.validate(profile), false);
        writeFileSync(fake, 'SYNTHETIC-EXECUTABLE-DRIFT');
        assert.throws(() => fixture.readInteractiveTerminalConfig(file));
      } finally {
        try {
          handle?.signal('SIGTERM');
        } catch {
          // A disconnected fixture host no longer has a signal transport.
        }
        handle?.dispose();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
