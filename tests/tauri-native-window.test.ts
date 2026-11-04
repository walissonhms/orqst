// Synthetic WindowServer metadata and disposable Node children only. No native app or provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CAPTURABLE_MIN_HEIGHT,
  CAPTURABLE_MIN_WIDTH,
  captureNativeWindow,
  compileNativeWindowProbe,
  parseNativeWindowSample,
  observeNativeFixtureExit,
  runNativeWindowProbe,
  type NativeWindowSample,
} from '../scripts/tauri/native-window.js';

const capturable = {
  number: 41,
  layer: 0,
  alpha: 1,
  onscreen: true,
  bounds: { x: 0, y: 0, width: CAPTURABLE_MIN_WIDTH, height: CAPTURABLE_MIN_HEIGHT },
  owner: 'SYNTHETIC-NOT-A-PROVIDER',
};
const sample = (windows: NativeWindowSample['windows'] = [capturable]): NativeWindowSample => ({
  tool: 'orqst-native-window-probe',
  pid: 4242,
  windows,
});

function clock() {
  let time = 0;
  return {
    now: () => time,
    delay: async (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

test('probe samples accept only bounded WindowServer metadata', () => {
  assert.deepEqual(parseNativeWindowSample(JSON.stringify(sample())), sample());
  assert.deepEqual(parseNativeWindowSample(JSON.stringify(sample([]))).windows, []);
  const invalid: unknown[] = [
    { ...sample(), tool: 'other' },
    { ...sample(), pid: 1 },
    { ...sample(), pid: 1.5 },
    { ...sample(), windows: [{ ...capturable, bounds: { ...capturable.bounds, width: -1 } }] },
    { ...sample(), windows: [{ ...capturable, alpha: 1.5 }] },
    { ...sample(), windows: [{ ...capturable, onscreen: 'yes' }] },
    { ...sample(), windows: [{ ...capturable, owner: 'x'.repeat(65) }] },
    { ...sample(), windows: [{ ...capturable, title: 'private window title' }] },
    { ...sample(), windows: [{ ...capturable, bounds: { ...capturable.bounds, width: 1.2 } }] },
    { ...sample(), windows: Array.from({ length: 33 }, () => capturable) },
    { ...sample(), extra: true },
  ];
  for (const value of invalid) {
    assert.throws(() => parseNativeWindowSample(JSON.stringify(value)));
  }
  assert.throws(() => parseNativeWindowSample('not json'));
  assert.throws(() => parseNativeWindowSample(''));
});

test('a missing compiler is reported instead of silently passing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orqst-synthetic-missing-swift-'));
  try {
    assert.equal(compileNativeWindowProbe(root, '/nonexistent/swiftc-695'), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fixture exit remains observable after window inspection sees the process gone', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const exited = observeNativeFixtureExit(child);
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  assert.equal(child.exitCode, 0);
  assert.equal(await exited, false);
});

test('fixture spawn failure is captured before a delayed result is consumed', async () => {
  const child = spawn('/nonexistent/orqst-synthetic-fixture', [], { stdio: 'ignore' });
  const exited = observeNativeFixtureExit(child);
  await new Promise<void>((resolve) => child.once('error', () => resolve()));
  assert.equal(await exited, true);
});

test('the first capturable window sample ends the bounded wait', async () => {
  const time = clock();
  let calls = 0;
  const evidence = await captureNativeWindow('/synthetic/probe', 4242, {
    timeoutMs: 10_000,
    intervalMs: 500,
    now: time.now,
    delay: time.delay,
    alive: () => true,
    run: () => {
      calls++;
      return calls < 3 ? sample([{ ...capturable, onscreen: false }]) : sample();
    },
  });
  assert.equal(evidence.status, 'window-observed');
  assert.equal(evidence.samples, 3);
  assert.equal(evidence.waitedMs, 1_000);
  assert.deepEqual(evidence.windows, [capturable]);
});

test('a window that exists but never becomes capturable is reported separately', async () => {
  const time = clock();
  const evidence = await captureNativeWindow('/synthetic/probe', 4242, {
    timeoutMs: 2_000,
    intervalMs: 500,
    now: time.now,
    delay: time.delay,
    alive: () => true,
    run: () => sample([{ ...capturable, onscreen: false }]),
  });
  assert.equal(evidence.status, 'window-exists-offscreen');
  assert.ok(evidence.waitedMs >= 2_000);
});

test('small helper or menu windows alone never count as a rendered pane', async () => {
  const time = clock();
  const evidence = await captureNativeWindow('/synthetic/probe', 4242, {
    timeoutMs: 1_000,
    intervalMs: 500,
    now: time.now,
    delay: time.delay,
    alive: () => true,
    run: () =>
      sample([
        { ...capturable, bounds: { ...capturable.bounds, width: 199 } },
        { ...capturable, bounds: { ...capturable.bounds, height: 149 } },
        { ...capturable, alpha: 0 },
        { ...capturable, layer: 25 },
      ]),
  });
  assert.equal(evidence.status, 'no-window');
  assert.deepEqual(evidence.windows, []);
  assert.ok(evidence.waitedMs <= 1_500);
});

test('an owned process that exits before a window is never accepted', async () => {
  const time = clock();
  let alive = true;
  const evidence = await captureNativeWindow('/synthetic/probe', 4242, {
    timeoutMs: 10_000,
    intervalMs: 500,
    now: time.now,
    delay: time.delay,
    alive: () => alive,
    run: () => {
      alive = false;
      return sample([]);
    },
  });
  assert.equal(evidence.status, 'process-exited');
  assert.equal(evidence.samples, 1);
});

test('probe failures stay bounded and retain one diagnostic message', async () => {
  const time = clock();
  const evidence = await captureNativeWindow('/synthetic/probe', 4242, {
    timeoutMs: 1_500,
    intervalMs: 500,
    now: time.now,
    delay: time.delay,
    alive: () => true,
    run: () => {
      throw new Error('probe refused');
    },
  });
  assert.equal(evidence.status, 'probe-invalid');
  assert.equal(evidence.lastError, 'probe refused');
  assert.equal(evidence.samples, 0);
  assert.ok(evidence.waitedMs >= 1_500);
});

test('invalid timing and process identifiers are rejected before probing', async () => {
  for (const pid of [0, 1, -2, 1.5]) {
    await assert.rejects(() => captureNativeWindow('/synthetic/probe', pid, { timeoutMs: 10 }));
  }
  await assert.rejects(() => captureNativeWindow('/synthetic/probe', 4242, { timeoutMs: -1 }));
  assert.throws(() => runNativeWindowProbe('/nonexistent/probe-695', 4242));
});
