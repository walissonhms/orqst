// Explicit disposable Electron diagnostic-channel test; never runs a CLI or Bridge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-stdio']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
process.umask(0o077);
const root = await mkdtemp(join(tmpdir(), 'orqst-synthetic-stdio-'));
const require = createRequire(resolve('apps/desktop/package.json'));
const executable = require('electron') as string;
const guard = join(root, 'diagnostic-output.cjs');
try {
  await build({
    entryPoints: ['apps/desktop/src/diagnostic-output.ts'],
    outfile: guard,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
  });
  for (const channel of ['stdout', 'stderr'] as const) {
    for (const guarded of [false, true]) {
      const id = `${channel}-${guarded}`;
      const report = join(root, `${id}.json`);
      const bootstrap = join(root, `${id}.cjs`);
      await writeFile(
        bootstrap,
        `const {app} = require('electron');
        const fs = require('node:fs');
        app.setPath('userData', ${JSON.stringify(join(root, id))});
        ${guarded ? `require(${JSON.stringify(guard)});` : ''}
        const record = (value) => fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify(value));
        // Fixture only: record a fatal error and exit, avoiding Electron's modal error dialog.
        // This never resumes the process and is never installed in the application.
        process.on('uncaughtException', error => {
          record({code:error.code, syscall:error.syscall, stack:error.stack}); app.exit(43);
        });
        app.whenReady().then(() => {
          process.stdout.write('SYNTHETIC-READY\\n');
          process.stdin.once('data', () => {
            // Strict fixture console exposes the exact warning/console stack in the report.
            // Default Node Console can itself ignore pipe errors; no production flag changes.
            const {Console} = require('node:console');
            global.console = new Console({stdout:process.stdout, stderr:process.stderr, ignoreErrors:false});
            if (${JSON.stringify(channel)} === 'stderr') process.emitWarning('SYNTHETIC warning');
            else console.log('SYNTHETIC stdout');
            setTimeout(() => {
              // Repeated writes and warning output during teardown must not change app lifetime.
              if (${JSON.stringify(channel)} === 'stderr') process.emitWarning('SYNTHETIC teardown');
              else console.log('SYNTHETIC teardown');
              setTimeout(() => { record({survived:true, electron:process.versions.electron,
                node:process.versions.node}); app.exit(0); }, 50);
            }, 50);
          });
        });`,
      );
      const child = spawn(executable, [bootstrap], {
        // Mirrors the detached process group and diagnostic pipes used by Playwright on macOS.
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
      });
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      try {
        let output = '';
        while (!output.includes('SYNTHETIC-READY\n')) {
          const [chunk] = await Promise.race([
            once(child.stdout, 'data'),
            exited.then(() => {
              throw new Error('Electron fixture exited before readiness');
            }),
          ]);
          output += String(chunk);
        }
        const closed = once(child[channel], 'close');
        child[channel].destroy();
        await closed;
        child.stdin.end('write');
        const [code, signal] = await exited;
        assert.equal(signal, null);
        const result = JSON.parse(await readFile(report, 'utf8'));
        assert.equal(code, guarded ? 0 : 43);
        if (guarded) assert.equal(result.survived, true);
        else {
          assert.equal(result.code, 'EPIPE');
          assert.equal(result.syscall, 'write');
          assert.match(result.stack, /afterWriteDispatched/);
          assert.match(result.stack, /kWriteToConsole/);
          if (channel === 'stderr') assert.match(result.stack, /writeOut/);
        }
        console.log(
          JSON.stringify({ synthetic: true, channel, guarded, pid: child.pid, code, result }),
        );
      } finally {
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
      }
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
