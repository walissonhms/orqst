import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
} from '../packages/core/src/terminal/authority.js';

test('start proof cryptographically binds the CLI authorization epoch', () => {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['native', keys.publicKey]]));
  const binding = {
    operation: 'start' as const,
    target: randomUUID(),
    digest: terminalDigest('synthetic'),
  };
  const challenge = authority.prepare('native', binding);
  const epoch = randomUUID();
  const signature = sign(null, terminalChallengeBytes(challenge, epoch), keys.privateKey).toString(
    'base64url',
  );
  assert.throws(() =>
    authority.consume(
      { challengeId: challenge.challengeId, signature, cliAuthorizationEpoch: randomUUID() },
      binding,
    ),
  );
  assert.throws(() =>
    authority.consume({ challengeId: challenge.challengeId, signature }, binding),
  );
  assert.equal(
    authority.consume(
      { challengeId: challenge.challengeId, signature, cliAuthorizationEpoch: epoch },
      binding,
    ),
    'native',
  );
});

test('legacy proof remains readable and a CLI epoch is refused for non-start operations', () => {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['native', keys.publicKey]]));
  const binding = {
    operation: 'attach' as const,
    target: randomUUID(),
    digest: terminalDigest('synthetic'),
  };
  const challenge = authority.prepare('native', binding);
  const epoch = randomUUID();
  const invalid = sign(null, terminalChallengeBytes(challenge, epoch), keys.privateKey).toString(
    'base64url',
  );
  assert.throws(() =>
    authority.consume(
      { challengeId: challenge.challengeId, signature: invalid, cliAuthorizationEpoch: epoch },
      binding,
    ),
  );
  const signature = sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString(
    'base64url',
  );
  assert.equal(
    authority.consume({ challengeId: challenge.challengeId, signature }, binding),
    'native',
  );
});
