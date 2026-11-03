// SYNTHETIC bytes and transports only; no provider or source sessions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedLineSplitter } from '../packages/core/src/managed-codex/line-splitter.js';
import {
  CodexChannel,
  codexChannelLimits,
  type CodexTransport,
} from '../packages/core/src/managed-codex/channel.js';

function fixture() {
  let receive: (chunk: Uint8Array) => void = () => {};
  let signals = 0;
  const transport: CodexTransport = {
    send() {},
    listen(data) {
      receive = data;
      return () => {};
    },
    signal() {
      signals++;
    },
    detach() {},
  };
  const channel = new CodexChannel(transport);
  return { channel, receive: (bytes: Uint8Array) => receive(bytes), signals: () => signals };
}

test('framing preserves raw UTF-8, empty lines and caller-owned fragments at the byte limit', () => {
  const splitter = new BoundedLineSplitter(4);
  const bytes = Buffer.from('ação');
  const lines: Buffer[] = [];
  const small = new BoundedLineSplitter(bytes.length);
  for (const byte of bytes) lines.push(...small.push(Buffer.from([byte])));
  assert.equal(small.pendingLength, bytes.length);
  lines.push(...small.push(Buffer.from('\n\n')));
  assert.deepEqual(lines, [bytes, Buffer.alloc(0)]);
  const reused = Buffer.from('ab');
  assert.deepEqual([...splitter.push(reused)], []);
  reused.fill(0);
  assert.deepEqual([...splitter.push(Buffer.from('cd\n'))], [Buffer.from('abcd')]);
  assert.equal(splitter.pendingLength, 0);
  assert.throws(() => [...splitter.push(Buffer.from('12345'))], /budget/);
  assert.equal(splitter.pendingLength, 0);
  assert.deepEqual([...splitter.push(Buffer.from('1234'))], []);
  assert.throws(() => [...splitter.push(Buffer.from('5\n'))], /budget/);
  splitter.clear();
  assert.equal(splitter.pendingLength, 0);
  assert.deepEqual([...splitter.push(Buffer.from('ok\n'))], [Buffer.from('ok')]);
  for (const limit of [0, -1, NaN, Infinity, 1.5])
    assert.throws(() => new BoundedLineSplitter(limit), /budget/);
});

test('structured channel concatenates fragmented lines only at completion', (t) => {
  const f = fixture();
  const original = Buffer.concat;
  let copiedBytes = 0;
  t.mock.method(Buffer, 'concat', (list: readonly Uint8Array[], length?: number) => {
    copiedBytes += list.reduce((total, part) => total + part.byteLength, 0);
    return original(list, length);
  });
  const bytes = Buffer.from(JSON.stringify({ method: 'SYNTHETIC', params: 'x'.repeat(32768) }));
  let observed = 0;
  f.channel.onNotification(() => observed++);
  for (const byte of bytes) f.receive(Buffer.from([byte]));
  assert.equal(copiedBytes, 0);
  assert.equal(f.channel.startupDiagnostic().bufferedBytes, bytes.length);
  f.receive(Buffer.from('\n'));
  assert.equal(copiedBytes, bytes.length);
  assert.equal(observed, 1);
  assert.equal(f.channel.startupDiagnostic().bufferedBytes, 0);
  f.channel.detach();
  assert.equal(f.signals(), 0);
});

test('channel preserves delivery before a later oversized line and frozen partial diagnostics', () => {
  const f = fixture();
  const prefix = Buffer.from('{"method":"SYNTHETIC"}\n');
  let observed = 0;
  f.channel.onNotification(() => observed++);
  f.receive(
    Buffer.concat([prefix, Buffer.alloc(codexChannelLimits.lineBytes - prefix.length, 32)]),
  );
  f.receive(Buffer.alloc(prefix.length, 32));
  assert.equal(observed, 1);
  assert.equal(f.channel.available, true);
  f.receive(Buffer.from('x\n'));
  assert.equal(f.channel.available, false);
  assert.equal(f.channel.diagnostic()?.reason, 'output_limit');
  assert.equal(f.channel.startupDiagnostic().bufferedBytes, codexChannelLimits.lineBytes);
  assert.equal(f.signals(), 0);
});

test('channel preserves strict decoding, aggregate/chunk limits and incomplete EOF', () => {
  const invalid = fixture();
  invalid.receive(Buffer.from([0xc3, 0x0a]));
  assert.equal(invalid.channel.diagnostic()?.reason, 'invalid_message');
  const chunk = fixture();
  chunk.receive(Buffer.alloc(codexChannelLimits.lineBytes + 1));
  assert.equal(chunk.channel.diagnostic()?.reason, 'output_limit');
  const partial = fixture();
  partial.receive(Buffer.from('{"method":"SYNTHETIC"}'));
  partial.channel.detach();
  assert.equal(partial.channel.startupDiagnostic().bufferedBytes, 22);
  const total = fixture();
  const line = Buffer.from(
    JSON.stringify({ method: 'SYNTHETIC', params: 'x'.repeat(65500) }) + '\n',
  );
  for (let bytes = 0; bytes <= codexChannelLimits.sessionBytes; bytes += line.length)
    total.receive(line);
  assert.equal(total.channel.diagnostic()?.reason, 'output_limit');
  assert.equal(total.signals(), 0);
});
