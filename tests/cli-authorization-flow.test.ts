import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { requireCliGrant } from '../scripts/terminal/require-cli-grant.js';
import { cliAuthorizationScope } from '../packages/core/src/terminal/cli-authorization-scope.js';
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
  const policyParent = join(root, 'managed-agents');
  const store = new TerminalCliPolicyStore(policyParent);
  assert.equal(existsSync(policyParent), false);
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
    permissions: 'synthetic',
    ...cliAuthorizationScope('codex', 'tui'),
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
    assert.equal(
      (await authorizeCliCandidate({ ...input, review: async () => false })).status,
      'blocked',
    );
    assert.equal(existsSync(policyParent), false);
    probes = 0;
    const initial = await authorizeCliCandidate(input);
    assert.equal(initial.status, 'allowed');
    assert.equal(existsSync(policyParent), true);
    if (initial.status !== 'allowed') throw new Error('Synthetic authorization failed');
    const binding = await store.verifiedBinding(initial.profile, 'codex', 'tui', input.verifier);
    assert.equal(binding?.policyRevision, 1);
    assert.equal(binding?.authorizationEpoch, initial.epoch);
    assert.equal(binding?.teamId, signature.teamId);
    assert.equal('sha256' in binding!, false);
    const reused = await requireCliGrant({
      directory: policyParent,
      provider: 'codex',
      mode: 'tui',
      executable,
      version: initial.profile.executableVersion,
      sha256: initial.profile.executableSha256,
      project: root,
      verifier: input.verifier,
    });
    assert.deepEqual(reused, binding);
    await assert.rejects(
      requireCliGrant({
        directory: policyParent,
        provider: 'codex',
        mode: 'tui',
        executable,
        version: initial.profile.executableVersion,
        sha256: '0'.repeat(64),
        project: root,
        verifier: input.verifier,
      }),
      /No current CLI authorization/,
    );
    const second = await authorizeCliCandidate(input);
    assert.equal(second.status, 'allowed');
    assert.equal(probes, 1);
    assert.equal(reviews, 1);
    writeFileSync(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 9, 8, 7, 6]));
    const changed = await authorizeCliCandidate(input);
    assert.equal(changed.status, 'allowed');
    if (changed.status !== 'allowed') throw new Error('Synthetic reauthorization failed');
    assert.notEqual(changed.epoch, initial.epoch);
    assert.equal(changed.binding.policyRevision, 2);
    assert.equal(probes, 2);
    assert.equal(reviews, 2);
    const next = join(root, 'synthetic-other-path');
    writeFileSync(next, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 9, 8, 7, 6]), { mode: 0o700 });
    let seenPrevious = false;
    const moved = await authorizeCliCandidate({
      ...input,
      executable: next,
      profile: (version, sha256) => ({ ...profile(version, sha256), executable: next }),
      probe: async () => ({
        provider: 'codex',
        mode: 'tui',
        version: '0.162.1',
        contractRevision: 'codex-tui-0.162.1',
        sha256: (
          await import('../packages/core/src/terminal/codex-profile.js')
        ).terminalExecutableSha256(next),
        signature,
      }),
      review: async (details) => {
        seenPrevious =
          details.previous === undefined &&
          details.previousProviderGrants?.some((grant) => grant.executable === executable) === true;
        return true;
      },
    });
    assert.equal(moved.status, 'allowed');
    assert.equal(seenPrevious, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
