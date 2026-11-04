import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { terminalPreparationFailureSchema, tauriStudioReplySchema } from '@orqst/protocol';
import {
  TerminalStartupError,
  terminalStartupFailure,
  terminalStartupFailureSchema,
  terminalStartupHostFailure,
} from '../packages/core/src/terminal/startup-failure.js';

test('Core admission reason survives private IPC, host stdout and Studio without private fields', () => {
  const id = randomUUID();
  const failure = {
    stage: 'core_admission' as const,
    code: 'capacity_reserved' as const,
    effects: 'possible' as const,
  };
  const message = terminalStartupFailureSchema.parse({ type: 'startup-failure', id, failure });
  const stdout = terminalStartupHostFailure(message.id, new TerminalStartupError(message.failure));
  assert.deepEqual(stdout, { kind: 'failure', id, failure });
  assert.equal(
    tauriStudioReplySchema.safeParse({ status: 'denied', failure: stdout.failure }).success,
    true,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(stdout)) < 1024);
  for (const privateField of [
    'stderr',
    'message',
    'path',
    'config',
    'proof',
    'credentials',
    'admissionOwner',
    'initialFiles',
  ]) {
    assert.equal(
      terminalStartupFailureSchema.safeParse({ ...message, [privateField]: 'SYNTHETIC' }).success,
      false,
    );
    assert.equal(
      terminalStartupFailureSchema.safeParse({
        ...message,
        failure: { ...failure, [privateField]: 'SYNTHETIC' },
      }).success,
      false,
    );
  }
});

test('unknown startup and forged no-effect envelopes never become not_started or raw messages', () => {
  const unknown = { stage: 'core_startup', code: 'startup_failed', effects: 'possible' };
  assert.deepEqual(
    terminalStartupFailure(new Error('SYNTHETIC /private/path token proof stderr')),
    unknown,
  );
  assert.deepEqual(
    terminalStartupFailure(
      new TerminalStartupError({
        stage: 'core_startup',
        code: 'startup_timeout',
        effects: 'not_started',
      }),
    ),
    unknown,
  );
  for (const stage of ['core_admission', 'core_startup']) {
    assert.equal(
      terminalPreparationFailureSchema.safeParse({
        stage,
        code: 'capacity_reserved',
        effects: 'not_started',
      }).success,
      false,
    );
  }
  assert.equal(
    terminalPreparationFailureSchema.safeParse({
      stage: 'admission_preflight',
      code: 'capacity_reserved',
      effects: 'not_started',
    }).success,
    true,
  );
});

test('a timeout cannot claim not_started under a preflight stage either', () => {
  assert.equal(
    terminalPreparationFailureSchema.safeParse({
      stage: 'admission_preflight',
      code: 'startup_timeout',
      effects: 'not_started',
    }).success,
    false,
  );
});
