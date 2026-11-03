// Synthetic metadata and byte streams only; no provider executable or credentials.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexChannel, type CodexTransport } from '../packages/core/src/managed-codex/channel.js';
import {
  hostCounterNames,
  hostDiagnosticSchema,
  reportHostStartup,
  StartupCounters,
  startupDiagnosticLimits,
  type HostDiagnostic,
} from '../packages/core/src/managed-codex/startup-diagnostics.js';

test('startup metadata has fixed keys, saturating counters, immutable copies and frozen elapsed time', () => {
  const counters = new StartupCounters(hostCounterNames);
  counters.add('stdoutBytes', startupDiagnosticLimits.counter + 1);
  counters.add('stdinBytes', -1);
  counters.add('stdinBytes', NaN);
  counters.add('stdinBytes', Infinity);
  counters.add('SYNTHETIC-SECRET' as 'stdinBytes');
  const snapshot = counters.snapshot();
  assert.equal(snapshot.counters.stdoutBytes, startupDiagnosticLimits.counter);
  assert.equal(snapshot.counters.stdinBytes, 0);
  assert.equal(snapshot.saturated, true);
  snapshot.counters.stdoutBytes = 0;
  assert.equal(counters.snapshot().counters.stdoutBytes, startupDiagnosticLimits.counter);
  counters.freeze();
  const frozen = counters.snapshot();
  counters.add('stdinBytes');
  assert.deepEqual(counters.snapshot(), frozen);
  assert.ok(JSON.stringify(frozen).length < 1024);
  assert.ok(!JSON.stringify(frozen).includes('SYNTHETIC-SECRET'));
});

test('host reporter caps traffic, never retries pending frames and clears all timers', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const counters = new StartupCounters(hostCounterNames);
  let frames = 0;
  const stop = reportHostStartup(counters, (frame, done) => {
    frames++;
    assert.ok(hostDiagnosticSchema.safeParse(frame).success);
    assert.ok(JSON.stringify(frame).length < 1024);
    done();
  });
  for (let i = 0; i < 400; i++) t.mock.timers.tick(startupDiagnosticLimits.intervalMs);
  assert.equal(frames, startupDiagnosticLimits.hostSnapshots);
  const frozen = counters.snapshot();
  counters.add('stdinBytes');
  assert.deepEqual(counters.snapshot(), frozen);
  stop();
  t.mock.timers.tick(120000);
  assert.equal(frames, startupDiagnosticLimits.hostSnapshots);
});

for (const behavior of ['pending', 'throw', 'error', 'disconnect'] as const) {
  test(`reporter ${behavior} is bounded, has no retry and cannot delay cleanup`, (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    let frames = 0;
    const counters = new StartupCounters(hostCounterNames);
    const stop = reportHostStartup(counters, (_frame, done) => {
      frames++;
      if (behavior === 'throw') throw new Error('SYNTHETIC-SECRET');
      if (behavior === 'error') done(new Error('SYNTHETIC-SECRET'));
    });
    t.mock.timers.tick(250);
    assert.equal(frames, 1);
    if (behavior === 'disconnect') stop();
    for (let i = 0; i < 300; i++) t.mock.timers.tick(250);
    assert.equal(frames, 1);
    const frozen = counters.snapshot();
    counters.add('stdinBytes');
    assert.deepEqual(counters.snapshot(), frozen);
    stop();
  });
}

test('unsupported versions, payload fields, unbounded numbers and extra counters are rejected', () => {
  const frame: HostDiagnostic = {
    type: 'startup_diagnostic',
    version: 1,
    sequence: 1,
    ...new StartupCounters(hostCounterNames).snapshot(),
  };
  assert.ok(hostDiagnosticSchema.safeParse(frame).success);
  for (const invalid of [
    { ...frame, version: 2 },
    { ...frame, payload: 'SYNTHETIC-SECRET' },
    { ...frame, sequence: 129 },
    { ...frame, elapsedMs: 60001 },
    { ...frame, counters: { ...frame.counters, stdoutBytes: Infinity } },
    { ...frame, counters: { ...frame.counters, stdoutBytes: 16777217 } },
    { ...frame, counters: { ...frame.counters, secret: 'SYNTHETIC-SECRET' } },
  ])
    assert.equal(hostDiagnosticSchema.safeParse(invalid).success, false);
});

function fake() {
  let receive: (bytes: Uint8Array) => void = () => {};
  let unsubscribed = 0;
  let sent: { id: string } | undefined;
  let signals = 0;
  const transport: CodexTransport = {
    send: (line) => {
      sent = JSON.parse(line) as { id: string };
    },
    listen: (onData) => {
      receive = onData;
      return () => {
        unsubscribed++;
      };
    },
    signal: () => {
      signals++;
    },
    detach: () => {},
  };
  const channel = new CodexChannel(transport);
  return {
    channel,
    receive: (text: string) => receive(Buffer.from(text)),
    reply: () => JSON.stringify({ id: sent!.id, result: { secret: 'SYNTHETIC-SECRET' } }),
    cleanup: () => ({ unsubscribed, signals }),
  };
}

test('complete correlated response requires LF; diagnostic exposes no payload, request ID or prompt', async () => {
  const f = fake();
  const request = f.channel.request('initialize', { secret: 'SYNTHETIC-SECRET-PROMPT' });
  f.receive(f.reply());
  assert.equal(f.channel.startupDiagnostic().counters.completeLines, 0);
  assert.ok(f.channel.startupDiagnostic().bufferedBytes > 0);
  f.receive('\n');
  await request;
  assert.equal(f.channel.startupDiagnostic().counters.correlatedResponses, 1);
  f.channel.finishDiagnostics();
  const frozen = f.channel.startupDiagnostic();
  f.receive('{"method":"SYNTHETIC-SECRET-NOTIFICATION","params":"SYNTHETIC-SECRET"}\n');
  assert.deepEqual(f.channel.startupDiagnostic(), frozen);
  assert.ok(!JSON.stringify(frozen).includes('SYNTHETIC'));
  f.channel.detach();
  assert.deepEqual(f.cleanup(), { unsubscribed: 1, signals: 0 });
});

test('late correlated response does not repair timeout, retry or signal; buffered bytes survive diagnostically', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fake();
  const request = f.channel.request('initialize', {});
  const rejected = assert.rejects(request, /unavailable/);
  f.receive(f.reply());
  t.mock.timers.tick(8001);
  await rejected;
  const frozen = f.channel.startupDiagnostic();
  f.receive('\n');
  assert.deepEqual(f.channel.startupDiagnostic(), frozen);
  assert.equal(f.channel.diagnostic()?.reason, 'request_timeout');
  assert.equal(frozen.counters.correlatedResponses, 0);
  assert.ok(frozen.bufferedBytes > 0);
  assert.deepEqual(f.cleanup(), { unsubscribed: 1, signals: 0 });
});

test('existing parser output limit remains fail-closed and payload-free', async () => {
  const f = fake();
  const pending = f.channel.request('initialize', { secret: 'SYNTHETIC-SECRET' });
  const rejected = assert.rejects(pending, /unavailable/);
  f.receive('SYNTHETIC-SECRET'.repeat(20000));
  await rejected;
  assert.equal(f.channel.diagnostic()?.reason, 'output_limit');
  const snapshot = f.channel.startupDiagnostic();
  assert.equal(snapshot.counters.outputLimits, 1);
  assert.equal(snapshot.counters.correlatedResponses, 0);
  assert.equal(snapshot.bufferedBytes, 0);
  assert.ok(!JSON.stringify(snapshot).includes('SYNTHETIC-SECRET'));
  assert.deepEqual(f.cleanup(), { unsubscribed: 1, signals: 0 });
});
