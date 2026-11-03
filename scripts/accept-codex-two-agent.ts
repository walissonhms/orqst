// Explicit developer acceptance ONLY. No provider runs without both human authorization flags.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '@orqst/database';
import type { CommunicationPane } from '@orqst/protocol';
import {
  PaneCommunication,
  type CommunicationContentScope,
} from '../packages/core/src/communication/service.js';
import {
  CodexStructuredRuntime,
  nativeCodexBackend,
} from '../packages/core/src/managed-codex/runtime.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import {
  readManagedCodexConfig,
  terminalDirectory,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  assertTwoAgentAcceptanceResults,
  twoAgentAcceptancePrompts,
} from './terminal/two-agent-acceptance.js';

const { values } = parseArgs({
  options: {
    'authorize-real-codex': { type: 'boolean' },
    'acknowledge-advisory-cost-only': { type: 'boolean' },
    'cleanup-owned-processes': { type: 'boolean' },
    'acceptance-root': { type: 'string' },
    model: { type: 'string' },
  },
});
// Gate before filesystem/authentication/config access or any native launch.
assert.ok(
  values['authorize-real-codex'] &&
    values['acknowledge-advisory-cost-only'] &&
    values['cleanup-owned-processes'] &&
    values['acceptance-root'] &&
    values.model,
  'Requires explicit --authorize-real-codex --acknowledge-advisory-cost-only --cleanup-owned-processes --acceptance-root NEW_PRIVATE_ROOT --model EXACT_MODEL. Read docs/development/codex-two-agent-acceptance.md first.',
);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.notEqual(process.getuid?.(), 0);
process.umask(0o077);
const root = realpathSync(values['acceptance-root']);
terminalDirectory(root, true);
const project = join(root, 'project');
assert.deepEqual(
  readdirSync(project),
  [],
  'Acceptance requires a separate empty project, never a user repository',
);
const files = ['slot-a', 'slot-b'].map((slot) => join(root, slot, 'terminal.json'));
const configs = files.map(readManagedCodexConfig);
for (let index = 0; index < 2; index++) {
  assert.equal(configs[index]!.project, project);
  assert.equal(configs[index]!.state, join(root, index === 0 ? 'slot-a' : 'slot-b'));
  assert.equal(
    existsSync(join(configs[index]!.state, 'terminal.sqlite')),
    false,
    'Never reuse a previous runtime journal or bypass an uncertain run',
  );
}
assert.deepEqual(configs[0]!.executable, configs[1]!.executable);
assert.equal(existsSync(join(root, 'communication.sqlite')), false);
const keys = generateKeyPairSync('ed25519');
const authority = new TerminalAuthority(
  new Map([['developer-acceptance', keys.publicKey]]),
  Date.now,
);
const proof = (challenge: TerminalChallenge) => ({
  challengeId: challenge.challengeId,
  signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
});
const store = new Store(join(root, 'communication.sqlite'));
const content = new Map<string, { scope: CommunicationContentScope; bytes: Uint8Array }>();
const read = (scope: Readonly<CommunicationContentScope>, id: string) => {
  const value = content.get(id);
  assert.ok(value);
  assert.deepEqual(value.scope, scope);
  return value.bytes;
};
const communication = new PaneCommunication(
  store.communicationJournal(randomUUID(), { recover: false }),
  read,
);
const write = (scope: Readonly<CommunicationContentScope>, bytes: Uint8Array) => {
  assert.ok(bytes.length <= 16384 && content.size < 32);
  const id = randomUUID();
  content.set(id, { scope: { ...scope }, bytes: Uint8Array.from(bytes) });
  return { id, bytes: bytes.length, sha256: terminalDigest(bytes) };
};
const runtime = new CodexStructuredRuntime(
  authority,
  communication,
  write,
  nativeCodexBackend(resolve('dist/codex-structured-host.cjs')),
  read,
);
const instances: string[] = [];
let passed = false;
try {
  const panes: CommunicationPane[] = [];
  for (let index = 0; index < 2; index++) {
    const prepared = runtime.prepare('developer-acceptance', files[index]!, {
      workspaceId: 'disposable-two-agent-acceptance',
      ownerId: 'developer-acceptance',
      name: index === 0 ? 'Acceptance initiator A' : 'Acceptance worker B',
      model: values.model,
      dynamicTools: index === 0,
    });
    instances.push(prepared.instanceId);
    panes.push(await runtime.launch(prepared.instanceId, proof(prepared.challenge)));
    console.log(
      JSON.stringify({
        phase: 'native-thread-ready',
        paneId: panes[index]!.paneId,
        displayId: panes[index]!.displayId,
        snapshot: runtime.snapshot(prepared.instanceId),
      }),
    );
  }
  const marker = `ORQST_B_${randomUUID()}`;
  const { delegatedTask, text } = twoAgentAcceptancePrompts(panes[1]!.paneId, marker);
  const prepared = runtime.prepareRootTask('developer-acceptance', instances[0]!, {
    targetPaneId: panes[1]!.paneId,
    text,
    delegatedTask,
    deadline: Date.now() + 120000,
  });
  const result = await runtime.runRootTask(prepared.plan.taskId, proof(prepared.challenge));
  const answer = read(
    {
      workspaceId: panes[0]!.workspaceId,
      actorId: panes[0]!.ownerId,
      sourcePaneId: panes[0]!.paneId,
      targetPaneId: panes[0]!.paneId,
      purpose: 'result',
    },
    result.result.id,
  );
  const workerResults = [...content.values()]
    .filter(
      ({ scope }) =>
        scope.workspaceId === panes[0]!.workspaceId &&
        scope.actorId === panes[0]!.ownerId &&
        scope.sourcePaneId === panes[0]!.paneId &&
        scope.targetPaneId === panes[1]!.paneId &&
        scope.purpose === 'result',
    )
    .map(({ bytes }) => bytes);
  assertTwoAgentAcceptanceResults(marker, workerResults, answer);
  assert.equal(runtime.snapshot(instances[0]!).dynamicTools, 'observed');
  assert.equal(runtime.snapshot(instances[0]!).delegationReturned, true);
  assert.deepEqual(readdirSync(project), []);
  passed = true;
  console.log(
    JSON.stringify({
      phase: 'native-delegation-confirmed',
      taskId: result.taskId,
      correlationId: result.correlationId,
      resultHash: result.result.sha256,
      tokens: 'unavailable',
      actualCost: 'unavailable',
      uiAcceptance: 'not-performed',
    }),
  );
} finally {
  const cleanup: Array<{ instanceId: string; confirmedExit: boolean }> = [];
  for (const id of instances) {
    try {
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        const current = runtime.snapshot(id);
        if (current.nativeExit || current.state !== 'running') break;
        const challenge = runtime.requestStop('developer-acceptance', id, signal);
        runtime.stop(id, signal, proof(challenge));
        for (let attempt = 0; attempt < 20 && !runtime.snapshot(id).nativeExit; attempt++)
          await delay(100);
      }
    } catch {
      /* Transport loss is uncertainty; never signal a stored PID. */
    }
    cleanup.push({ instanceId: id, confirmedExit: runtime.snapshot(id).nativeExit !== null });
  }
  runtime.shutdown();
  store.close();
  content.clear();
  console.log(
    JSON.stringify({
      phase: 'cleanup',
      passed,
      cleanup,
      privateStateRetained: true,
      note: 'Do not delete or reuse uncertain state; no PID adoption or automatic retry.',
    }),
  );
  if (cleanup.some((entry) => !entry.confirmedExit)) process.exitCode = 1;
}
