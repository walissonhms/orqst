// SYNTHETIC authority/host fixtures only; packaged native hosts are checked separately.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { managedAgentsReplySchema } from '@orqst/protocol';
import { TauriAgentsService } from '../apps/desktop/src/tauri-agents-service.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';

function fixture() {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-agents', keys.publicKey]]), Date.now);
  const messages: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  const digest = terminalDigest('SYNTHETIC exact routing revision');
  const changeId = randomUUID();
  let approved = 0;
  let closed = 0;
  let oversized = false;
  let expire = false;
  let blockPreparation: (() => Promise<void>) | undefined;
  const core = {
    close: () => {
      closed++;
    },
    async call(request: Record<string, unknown>): Promise<unknown> {
      calls.push(request);
      if (request.operation === 'snapshot')
        return {
          project: 'SYNTHETIC',
          admission: 'unclaimed',
          canRetire: false,
          slots: [null, null],
          messages: [],
          root: null,
        };
      if (request.operation === 'prepareRouting') {
        await blockPreparation?.();
        const challenge = authority.prepare('desktop-agents', {
          operation: 'delegate',
          target: changeId,
          digest,
        });
        return {
          changeId,
          plan: {
            exact: oversized ? 'x'.repeat(4097) : 'SYNTHETIC \u202e',
            update: request.update,
          },
          challenge: expire ? { ...challenge, expiresAt: 0 } : challenge,
        };
      }
      if (request.operation === 'applyRouting') {
        assert.equal(request.changeId, changeId);
        authority.consume(request.proof, { operation: 'delegate', target: changeId, digest });
        approved++;
        return;
      }
      throw new Error('Unexpected operation');
    },
  };
  const service = new TauriAgentsService(
    core,
    keys.privateKey,
    (value) => messages.push(value as Record<string, unknown>),
    (key) => key,
  );
  const request = (focused = true, extra: Record<string, unknown> = {}) => ({
    kind: 'request',
    id: randomUUID(),
    focused,
    request: {
      version: 1,
      action: 'routing',
      slot: 0,
      update: {
        name: 'SYNTHETIC',
        handle: 'synthetic',
        role: 'orchestrator',
        allowedTargetPaneIds: [],
      },
      ...extra,
    },
  });
  const status = (id: string) =>
    managedAgentsReplySchema.parse(
      messages.findLast((m) => m.kind === 'reply' && m.id === id)?.value,
    ).status;
  return {
    service,
    messages,
    calls,
    request,
    status,
    approved: () => approved,
    closed: () => closed,
    oversized: () => {
      oversized = true;
    },
    expire: () => {
      expire = true;
    },
    block: (fn: () => Promise<void>) => {
      blockPreparation = fn;
    },
  };
}

test('Tauri routing review signs exact Core challenge once and never returns proof to the document', async () => {
  const f = fixture();
  try {
    const request = f.request();
    const pending = f.service.receive(request);
    await setImmediate();
    const review = f.messages.find((m) => m.kind === 'confirm')!;
    assert.equal(review.requestId, request.id);
    assert.match(String(review.detail), /\\u\{202e\}/);
    await f.service.receive({ kind: 'confirm', id: randomUUID(), accepted: true });
    assert.equal(f.approved(), 0);
    await f.service.receive({ kind: 'confirm', id: review.id, accepted: true });
    await pending;
    assert.equal(f.status(request.id), 'ok');
    assert.equal(f.approved(), 1);
    await f.service.receive({ kind: 'confirm', id: review.id, accepted: true });
    assert.equal(f.approved(), 1);
    const replies = JSON.stringify(f.messages.filter((m) => m.kind === 'reply'));
    for (const secret of ['signature', 'privateKey', 'challengeId'])
      assert.equal(replies.includes(secret), false);
  } finally {
    f.service.close();
  }
});

test('Tauri blur, explicit cancellation and close fence a pending authorization', async () => {
  for (const mode of ['revoke', 'cancel', 'close']) {
    const f = fixture();
    try {
      const request = f.request();
      const pending = f.service.receive(request);
      await setImmediate();
      const review = f.messages.find((m) => m.kind === 'confirm')!;
      if (mode === 'revoke') await f.service.receive({ kind: 'revoke' });
      if (mode === 'close') f.service.close();
      else await f.service.receive({ kind: 'confirm', id: review.id, accepted: mode !== 'cancel' });
      await pending;
      assert.equal(f.approved(), 0);
      assert.equal(f.status(request.id), 'cancelled');
    } finally {
      f.service.close();
    }
    assert.equal(f.closed(), 1);
  }
});

test('Tauri denies hidden, malformed, oversized and expired routing reviews without mutation', async () => {
  for (const mode of ['focus', 'malformed', 'oversized', 'expired']) {
    const f = fixture();
    try {
      if (mode === 'oversized') f.oversized();
      if (mode === 'expired') f.expire();
      const request = f.request(
        mode !== 'focus',
        mode === 'malformed' ? { command: 'arbitrary' } : {},
      );
      const pending = f.service.receive(request);
      await setImmediate();
      const review = f.messages.find((m) => m.kind === 'confirm');
      if (review) await f.service.receive({ kind: 'confirm', id: review.id, accepted: true });
      await pending;
      assert.equal(f.status(request.id), mode === 'focus' ? 'focus_required' : 'denied');
      assert.equal(f.approved(), 0);
      if (mode !== 'expired') assert.equal(review, undefined);
    } finally {
      f.service.close();
    }
  }
});

test('Tauri serializes mutations but permits snapshots; revocation during preparation prevents review', async () => {
  const f = fixture();
  let release!: () => void;
  f.block(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    const first = f.request();
    const pending = f.service.receive(first);
    const second = f.request();
    await f.service.receive(second);
    assert.equal(f.status(second.id), 'busy');
    const read = { ...f.request(false), request: { version: 1, action: 'snapshot' } };
    await f.service.receive(read);
    assert.equal(f.status(read.id), 'ok');
    await f.service.receive({ kind: 'revoke' });
    release();
    await pending;
    assert.equal(f.status(first.id), 'denied');
    assert.equal(
      f.messages.some((m) => m.kind === 'confirm'),
      false,
    );
    assert.equal(f.approved(), 0);
    await assert.rejects(
      f.service.receive({
        kind: 'request',
        id: randomUUID(),
        focused: true,
        request: {},
        path: '/arbitrary',
      }),
    );
  } finally {
    f.service.close();
  }
});
