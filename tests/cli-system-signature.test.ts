import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifySystemCliSignature } from '../packages/core/src/terminal/cli-system-signature.js';

test(
  'system signature verifier rejects an unsigned fixture and a different signed identity',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-signature-test-')));
    const fixture = join(root, 'synthetic');
    try {
      writeFileSync(fixture, 'synthetic unsigned', { mode: 0o700 });
      for (const provider of ['codex', 'claude', 'opencode'] as const) {
        assert.equal(verifySystemCliSignature(provider, fixture), false);
        assert.equal(verifySystemCliSignature(provider, '/usr/bin/codesign'), false);
        assert.equal(verifySystemCliSignature(provider, 'relative'), false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
