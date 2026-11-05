import assert from 'node:assert/strict';
import test from 'node:test';
import { tauriCliSignatureVerifier } from '../apps/desktop/src/tauri-cli-signature.js';

test('native signature transport accepts only an affirmative reply', async () => {
  const requests: object[] = [];
  let answer: string | boolean | null = true;
  const verifier = tauriCliSignatureVerifier(async (request) => {
    requests.push(request);
    return answer;
  });
  assert.deepEqual(await verifier.verify('codex', '/synthetic/cli'), {
    valid: true,
    teamId: '2DC432GLL2',
    identifier: 'codex',
  });
  assert.deepEqual(requests, [
    { kind: 'cli-signature', provider: 'codex', path: '/synthetic/cli' },
  ]);
  for (answer of [false, null, 'true'])
    assert.equal(await verifier.verify('codex', '/synthetic/cli'), undefined);
});
