import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authorizeCliCandidate } from '../packages/core/src/terminal/cli-authorization-flow.js';
import {
  TerminalCliPolicyStore,
  type TerminalCliEvidence,
} from '../packages/core/src/terminal/cli-authorization.js';
import type { TerminalProfile } from '../packages/core/src/terminal/supervisor.js';

test('candidate authorization probes once and repeats neither probe nor review for the same grant', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-candidate-')));
  const executable = join(root, 'synthetic');
  writeFileSync(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]), { mode: 0o700 });
  const store = new TerminalCliPolicyStore(root);
  const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
  let valid = false;
  let reviews = 0;
  let probes = 0;
  const profile = (version: string, sha256: string): TerminalProfile => ({
    id: 'synthetic',
    projectId: 'synthetic',
    executable,
    executableSha256: sha256,
    executableVersion: version,
    cwd: root,
    argv: [],
    environmentProfile: 'synthetic',
    permissions: 'synthetic',
    cliAuthorizationScope: 'scope',
  });
  const input = {
    store,
    provider: 'codex' as const,
    mode: 'tui' as const,
    executable,
    verifier: {
      async verify() {
        return { ...signature, valid };
      },
    },
    profile,
    async review() {
      reviews++;
      return true;
    },
    async probe(): Promise<TerminalCliEvidence> {
      probes++;
      const { terminalExecutableSha256 } =
        await import('../packages/core/src/terminal/codex-profile.js');
      return {
        provider: 'codex',
        mode: 'tui',
        version: '0.162.1',
        contractRevision: 'codex-tui-0.162.1',
        sha256: terminalExecutableSha256(executable),
        signature,
      };
    },
  };
  try {
    await assert.rejects(authorizeCliCandidate(input), /signature/);
    assert.equal(probes, 0);
    valid = true;
    const initial = await authorizeCliCandidate(input);
    assert.equal(initial.status, 'allowed');
    const second = await authorizeCliCandidate(input);
    assert.equal(second.status, 'allowed');
    assert.equal(probes, 1);
    assert.equal(reviews, 1);
    writeFileSync(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 9, 8, 7, 6]));
    assert.equal((await authorizeCliCandidate(input)).status, 'allowed');
    assert.equal(probes, 2);
    assert.equal(reviews, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
