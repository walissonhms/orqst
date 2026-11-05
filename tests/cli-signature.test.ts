import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifiedCliSignature,
  type CliSignatureEvidence,
} from '../packages/core/src/terminal/cli-signature.js';

test('signature interface rejects missing, invalid, wrong team and wrong identifier evidence', async () => {
  const correct = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
  let evidence: CliSignatureEvidence | undefined = correct;
  const verifier = {
    async verify() {
      return evidence;
    },
  };
  assert.deepEqual(await verifiedCliSignature(verifier, 'codex', '/synthetic/codex'), correct);
  for (const rejected of [
    undefined,
    { ...correct, valid: false },
    { ...correct, teamId: 'OTHER' },
    { ...correct, identifier: 'other' },
  ]) {
    evidence = rejected;
    await assert.rejects(verifiedCliSignature(verifier, 'codex', '/synthetic/codex'), /signature/);
  }
});
