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
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import type { ManagedClaudeConfig } from '../packages/core/src/terminal/interactive-profile.js';
import type {
  TerminalEvents,
  OwnedTerminalHandle,
} from '../packages/core/src/terminal/supervisor.js';

test(
  'Claude-shaped synthetic PTY revalidates native launch, owns exit and refuses reuse/drift',
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
      for (const dir of [state, home, project, join(state, 'tmp')]) mkdirSync(dir, { mode: 0o700 });
      const nativeSentinel = join(home, 'SYNTHETIC-DO-NOT-READ');
      writeFileSync(nativeSentinel, 'SYNTHETIC-UNCHANGED', { mode: 0o000 });
      const node = realpathSync(process.execPath);
      const config: ManagedClaudeConfig = {
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
                contents: readFileSync(args.path, 'utf8').replace(
                  reviewedProviderMcpBinaries.claude.sha256,
                  hash,
                ),
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
      assert.throws(
        () => fixture.inspectManagedTerminalFiles([file, otherFile]),
        /Duplicate Claude session UUID/,
      );
      assert.equal(existsSync(join(state, 'terminal.sqlite')), false);
      assert.equal(existsSync(join(otherState, 'terminal.sqlite')), false);
      writeFileSync(
        otherFile,
        JSON.stringify({ ...config, state: otherState, sessionId: randomUUID() }),
      );
      assert.equal(fixture.inspectManagedTerminalFiles([file, otherFile]).length, 2);
      const backend = fixture.managedTerminalBackend(file, join(root, 'host.cjs'));
      assert.equal(backend.validate(profile), true);
      assert.equal(backend.validate({ ...profile, argv: ['--resume'] }), false);
      let started = false;
      let output = '';
      let exit: number | undefined;
      const events: TerminalEvents = {
        started: () => {
          started = true;
        },
        data: (text) => {
          output += text;
        },
        exit: (code) => {
          exit = code;
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
      handle.dispose();
      handle = undefined;
      writeFileSync(file, JSON.stringify({ ...config, sessionId: randomUUID() }));
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
