// SYNTHETIC native argv only; never starts a helper, app or provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { offlineRecoveryHelperArguments } from '../apps/desktop/src/offline-recovery-arguments.js';
test('native helper keeps legacy argv and exact optional candidate vector', () => {
  assert.deepEqual(offlineRecoveryHelperArguments(['/private/SYNTHETIC']), {
    parent: '/private/SYNTHETIC',
    historicalEvidenceFile: undefined,
  });
  assert.deepEqual(
    offlineRecoveryHelperArguments([
      '/private/SYNTHETIC',
      '--offline-recovery-binding-evidence',
      '/private/candidate',
    ]),
    { parent: '/private/SYNTHETIC', historicalEvidenceFile: '/private/candidate' },
  );
  for (const args of [
    [],
    ['relative'],
    ['/x', '/candidate'],
    ['/x', '--offline-recovery-binding-evidence'],
    ['/x', '--offline-recovery-binding-evidence', 'relative'],
    ['/x', '--offline-recovery-binding-evidence', '/x\0y'],
    ['/x', '--offline-recovery-binding-evidence', '/x', 'extra'],
    ['/x', '--wrong', '/x'],
  ])
    assert.throws(() => offlineRecoveryHelperArguments(args));
});
