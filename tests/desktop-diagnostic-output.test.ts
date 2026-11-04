// Disposable Node children only: no Electron window, provider, IPC host or user state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const guard = pathToFileURL(resolve('apps/desktop/src/diagnostic-output.ts')).href;

async function probe(body: string, close?: 'stdout' | 'stderr', guarded = true) {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `${guarded ? `await import(${JSON.stringify(guard)});` : ''}
      process.send('ready');
      process.once('message', () => { ${body} });`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const finished = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  let stdout = '';
  let stderr = '';
  assert.ok(child.stdout);
  assert.ok(child.stderr);
  child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
  child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
  try {
    const ready = await Promise.race([
      once(child, 'message'),
      finished.then(() => {
        throw new Error('Diagnostic fixture exited before readiness');
      }),
    ]);
    assert.deepEqual(ready, ['ready', undefined]);
    if (close) {
      const output = child[close];
      assert.ok(output);
      const closed = once(output, 'close');
      output.destroy();
      await closed;
    }
    child.send('write');
    const [code, signal] = await finished;
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await finished;
    }
  }
}

for (const channel of ['stdout', 'stderr'] as const) {
  test(`Desktop survives only write EPIPE on its ${channel}`, async () => {
    const body = `process.${channel}.write('SYNTHETIC diagnostic\\n');
      setTimeout(() => { process.disconnect(); }, 50);`;
    const baseline = await probe(body, channel, false);
    assert.equal(baseline.code, 1);
    const guarded = await probe(body, channel);
    assert.equal(guarded.code, 0);
    assert.equal(guarded.signal, null);
  });

  for (const [code, syscall] of [
    ['EIO', 'write'],
    ['EPIPE', 'read'],
    ['EPIPE', undefined],
    ['ERR_STREAM_DESTROYED', 'write'],
  ]) {
    test(`Desktop preserves ${channel} failure ${code}/${syscall ?? 'missing'}`, async () => {
      const error = JSON.stringify({ code, syscall });
      const result = await probe(`process.${channel}.emit('error',
        Object.assign(new Error('SYNTHETIC unexpected failure'), ${error}));`);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /SYNTHETIC unexpected failure/);
    });
  }
}

test('healthy diagnostics and Node warnings remain observable', async () => {
  const result = await probe(`
    console.log('SYNTHETIC stdout');
    console.error('SYNTHETIC stderr');
    process.emitWarning('SYNTHETIC warning');
    setTimeout(() => process.disconnect(), 50);
  `);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /SYNTHETIC stdout/);
  assert.match(result.stderr, /SYNTHETIC stderr/);
  assert.match(result.stderr, /Warning: SYNTHETIC warning/);
});

test('unrelated sockets and thrown EPIPE remain fatal', async () => {
  for (const body of [
    `import('node:net').then(({ Socket }) => new Socket().emit('error',
      Object.assign(new Error('SYNTHETIC IPC EPIPE'), {code: 'EPIPE', syscall: 'write'})));`,
    `throw Object.assign(new Error('SYNTHETIC ownership EPIPE'),
      {code: 'EPIPE', syscall: 'write'});`,
  ]) {
    const result = await probe(body);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /SYNTHETIC (IPC|ownership) EPIPE/);
  }
});
