// SYNTHETIC compiled app-server + production host/IPC only. Never execute Codex.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { Store } from '@orqst/database';
import { PaneCommunication } from '../packages/core/src/communication/service.js';
import {
  readLifecycleReceipt,
  type LifecycleBinding,
} from '../packages/core/src/managed-codex/lifecycle-receipt.js';
import {
  CodexStructuredRuntime,
  nativeCodexBackend,
} from '../packages/core/src/managed-codex/runtime.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

test(
  'production startup counters distinguish observed boundaries without inferring the cause of silence',
  { timeout: 55000, skip: process.platform !== 'darwin' || process.arch !== 'arm64' },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-initialize-')));
    chmodSync(root, 0o700);
    const binary = join(root, 'SYNTHETIC-app-server');
    const compile = spawnSync(
      '/usr/bin/cc',
      [resolve('tests/helpers/structured-app-server-fixture.c'), '-o', binary],
      { encoding: 'utf8' },
    );
    assert.equal(compile.status, 0, compile.stderr);
    chmodSync(binary, 0o700);
    const bundle = join(root, 'SYNTHETIC-production-host.cjs');
    await build({
      entryPoints: ['packages/core/src/managed-codex/native-host.ts'],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
    });
    const stderrErrorBundle = join(root, 'SYNTHETIC-stderr-error-host.cjs');
    await build({
      entryPoints: ['packages/core/src/managed-codex/native-host.ts'],
      outfile: stderrErrorBundle,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      plugins: [
        {
          name: 'synthetic-stderr-read-error',
          setup(builder) {
            builder.onResolve({ filter: /^node:child_process$/ }, (args) =>
              args.namespace === 'stderr-fault'
                ? { path: args.path, external: true }
                : { path: args.path, namespace: 'stderr-fault' },
            );
            builder.onLoad({ filter: /.*/, namespace: 'stderr-fault' }, () => ({
              contents: `
              import { spawn as nativeSpawn } from 'node:child_process';
              import { writeFileSync } from 'node:fs';
              import { join } from 'node:path';
              export function spawn(...args) {
                const child = nativeSpawn(...args);
                setImmediate(() => {
                  writeFileSync(join(process.env.TMPDIR, 'SYNTHETIC-stderr-error'), 'injected');
                  child.stderr.destroy(new Error('SYNTHETIC-SECRET'));
                });
                return child;
              }
            `,
              loader: 'js',
            }));
          },
        },
      ],
    });
    const keys = generateKeyPairSync('ed25519');
    const proof = (challenge: TerminalChallenge) => ({
      challengeId: challenge.challengeId,
      signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString(
        'base64url',
      ),
    });
    const scenarios = [
      'compatible',
      'stderr-error',
      'delayed-initialize',
      'silent',
      'unterminated',
      'events-only',
      'content-length',
      'rejected',
    ];
    let allExited = true;
    try {
      for (const mode of scenarios) {
        const area = join(root, mode);
        mkdirSync(area, { mode: 0o700 });
        const compatible = ['compatible', 'stderr-error', 'delayed-initialize'].includes(mode);
        const project = join(area, mode === 'stderr-error' ? 'compatible' : mode);
        const state = join(area, 'state');
        for (const directory of [
          project,
          state,
          join(state, 'home'),
          join(state, 'codex'),
          join(state, 'tmp'),
        ])
          mkdirSync(directory, { mode: 0o700 });
        const config: ManagedCodexConfig = {
          version: 1,
          trust: 'native-same-user',
          executable: { path: binary, sha256: terminalExecutableSha256(binary) },
          executableVersion: 'SYNTHETIC-NOT-CODEX',
          node: {
            path: realpathSync(process.execPath),
            sha256: terminalExecutableSha256(realpathSync(process.execPath)),
          },
          project,
          state,
          ...(compatible
            ? {
                authentication: {
                  mode: 'reuse-existing',
                  home: area,
                  codexHome: area,
                  sharedNativeConfiguration: true,
                },
              }
            : {}),
        };
        writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), {
          mode: 0o600,
        });
        const file = join(state, 'terminal.json');
        writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
        const store = new Store(join(area, 'communication.sqlite'));
        const authority = new TerminalAuthority(new Map([['synthetic', keys.publicKey]]), Date.now);
        const communication = new PaneCommunication(
          store.communicationJournal(randomUUID(), { recover: false }),
          () => {
            throw new Error('No content access during synthetic preparation');
          },
        );
        const runtime = new CodexStructuredRuntime(
          authority,
          communication,
          () => {
            throw new Error('No inference during synthetic preparation');
          },
          nativeCodexBackend(mode === 'stderr-error' ? stderrErrorBundle : bundle),
        );
        const prepared = runtime.prepare('synthetic', file, {
          workspaceId: 'synthetic',
          ownerId: 'synthetic',
          name: mode,
          model: 'SYNTHETIC-model',
          dynamicTools: true,
        });
        const binding: LifecycleBinding = {
          instanceId: prepared.instanceId,
          epoch: prepared.challenge.epoch,
          manifestDigest: prepared.challenge.digest,
          configDigest: prepared.manifest.configDigest,
        };
        let receipt: ReturnType<typeof readLifecycleReceipt> = { status: 'missing' };
        try {
          if (compatible) {
            await runtime.launch(prepared.instanceId, proof(prepared.challenge));
            const snapshot = runtime.snapshot(prepared.instanceId);
            assert.equal(snapshot.authentication, 'existing-native-login');
            assert.equal(snapshot.startupPhase, 'ready');
            assert.equal(snapshot.reportedModel, 'SYNTHETIC-model');
            assert.equal(snapshot.dynamicTools, 'requested');
            assert.equal(snapshot.channelDiagnostic, null);
            assert.equal(snapshot.activeTurnId, null);
            assert.ok(!JSON.stringify(snapshot).includes('SYNTHETIC-SECRET'));
            if (mode === 'stderr-error')
              assert.ok(existsSync(join(state, 'tmp/SYNTHETIC-stderr-error')));
            const stop = runtime.requestStop('synthetic', prepared.instanceId, 'SIGTERM');
            runtime.stop(prepared.instanceId, 'SIGTERM', proof(stop));
          } else {
            await assert.rejects(
              runtime.launch(prepared.instanceId, proof(prepared.challenge)),
              /no automatic retry/,
            );
            const snapshot = runtime.snapshot(prepared.instanceId);
            assert.equal(snapshot.state, 'ownership_lost');
            assert.equal(snapshot.nativeExit, null);
            assert.equal(snapshot.startupPhase, 'initialize');
            assert.deepEqual(snapshot.channelDiagnostic, {
              reason:
                mode === 'content-length'
                  ? 'invalid_message'
                  : mode === 'rejected'
                    ? 'native_request_rejected'
                    : 'request_timeout',
              method: mode === 'content-length' ? null : 'initialize',
            });
            assert.throws(
              () => runtime.requestStop('synthetic', prepared.instanceId, 'SIGTERM'),
              /No owned/,
            );
            assert.ok(!JSON.stringify(snapshot).includes('SYNTHETIC-SECRET'));
            const diagnostic = snapshot.startupDiagnostic!;
            const transport = diagnostic.transport as {
              finished: boolean;
              host: {
                counters: {
                  accepted: number;
                  stdinBytes: number;
                  stdinCallbacks: number;
                  stdoutBytes: number;
                  stdoutNewlines: number;
                  stderrBytes: number;
                };
              } | null;
              parent: { counters: { sendQueued: number; dataFrames: number } };
            };
            assert.equal(transport.finished, true);
            assert.equal(
              diagnostic.parser.counters.correlatedResponses,
              mode === 'rejected' ? 1 : 0,
            );
            if (['silent', 'unterminated', 'events-only'].includes(mode)) {
              assert.ok(
                transport.host,
                'Host observations are present before the eight-second deadline',
              );
              assert.equal(transport.parent.counters.sendQueued, 1);
              assert.equal(transport.host.counters.accepted, 1);
              assert.ok(transport.host.counters.stdinBytes > 0);
              assert.equal(transport.host.counters.stdinCallbacks, 1);
              assert.equal(transport.host.counters.stdoutNewlines, mode === 'events-only' ? 1 : 0);
              assert.equal(
                diagnostic.parser.counters.completeLines,
                mode === 'events-only' ? 1 : 0,
              );
              assert.equal(diagnostic.parser.bufferedBytes > 0, mode === 'unterminated');
              assert.equal(transport.host.counters.stdoutBytes > 0, mode !== 'silent');
              assert.ok(transport.host.counters.stderrBytes > 0);
            }
            const frozen = JSON.stringify(diagnostic);
            await delay(20);
            assert.equal(
              JSON.stringify(runtime.snapshot(prepared.instanceId).startupDiagnostic),
              frozen,
            );
            assert.ok(!frozen.includes('SYNTHETIC-SECRET'));
            assert.ok(!frozen.includes(area));
          }
        } finally {
          // Never adopt a PID or signal after loss. Each fake has an independent bounded self-exit.
          let exitConfirmed = false;
          try {
            for (let attempt = 0; attempt < 150; attempt++) {
              receipt = readLifecycleReceipt(state, binding);
              if (
                receipt.status === 'recorded_exit' &&
                (!compatible || runtime.snapshot(prepared.instanceId).nativeExit !== null)
              ) {
                exitConfirmed = true;
                break;
              }
              await delay(100);
            }
            const snapshot = runtime.snapshot(prepared.instanceId);
            if (compatible) {
              assert.equal(snapshot.state, 'exited');
              assert.deepEqual(snapshot.nativeExit, { code: null, signal: 'SIGTERM' });
            } else {
              assert.equal(snapshot.state, 'ownership_lost');
              assert.equal(snapshot.nativeExit, null);
            }
          } finally {
            allExited &&= exitConfirmed;
            runtime.shutdown();
            store.close();
          }
        }
        assert.equal(receipt.status, 'recorded_exit', `Retain uncertain fake state: ${area}`);
        const trace = join(state, 'tmp/SYNTHETIC-methods.log');
        const methods = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [];
        assert.deepEqual(
          methods,
          mode === 'silent'
            ? []
            : compatible
              ? ['initialize', 'initialized', 'account/read', 'thread/start']
              : ['initialize'],
        );
      }
    } finally {
      // Delete only disposable synthetic state with recorded direct-child exits.
      if (allExited) rmSync(root, { recursive: true, force: true });
    }
  },
);
