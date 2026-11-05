import {
  TerminalCliPolicyStore,
  type TerminalCliEvidence,
} from '../../packages/core/src/terminal/cli-authorization.js';
import { terminalDigest } from '../../packages/core/src/terminal/authority.js';
import { readFileSync } from 'node:fs';
import type { TerminalProfile } from '../../packages/core/src/terminal/supervisor.js';

const root = process.argv[2]!;
const executable = process.argv[3]!;
const profile: TerminalProfile = {
  id: 'synthetic',
  projectId: 'synthetic',
  executable,
  executableSha256: terminalDigest(readFileSync(executable)),
  executableVersion: '0.162.1',
  argv: [],
  cwd: root,
  environmentProfile: 'synthetic',
  permissions: 'synthetic',
  cliAuthorizationScope: 'synthetic',
};
const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
const store = new TerminalCliPolicyStore(root);
const verifier = {
  async verify() {
    return signature;
  },
};
const probe = async (): Promise<TerminalCliEvidence> => ({
  provider: 'codex',
  mode: 'tui',
  version: '0.162.1',
  contractRevision: 'codex-tui-0.162.1',
  sha256: profile.executableSha256,
  signature,
});
const status = await store.authorizeVerifiedCli(
  profile,
  'codex',
  'tui',
  verifier,
  probe,
  async () => {
    process.send?.('review');
    return await new Promise<boolean>((resolve) =>
      process.once('message', (message) => resolve(message === 'approve')),
    );
  },
);
process.send?.(status, () => process.disconnect?.());
