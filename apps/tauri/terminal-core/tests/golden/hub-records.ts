// SYNTHETIC golden fixture (temporary private dir, no user data): composer mention records,
// the hub metadata journal and the MCP pair communication journal written by TypeScript.
// Usage: tsx hub-records.ts <userData> -> prints JSON {features, mentions, projection}.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableId } from '../../../../../packages/shared/src/index.js';
import { featureConfigurationDatabase } from '../../../../../packages/core/src/terminal/feature-configuration.js';
import { recordComposerMention } from '../../../../../packages/core/src/terminal/composer-mentions.js';
import { hubMessageJournal } from '../../../../../packages/core/src/terminal/mcp-hub-journal.js';
import { mcpCommunicationJournal } from '../../../../../packages/core/src/terminal/mcp-communication.js';

const userData = process.argv[2]!;
const [A, B, C, D] = ['a1', 'b1', 'c1', 'd1'].map((s) => `00000000-0000-4000-8000-0000000000${s}`);
const workspace = stableId('workspace', '/synthetic/orqst-project');
const features = featureConfigurationDatabase(userData, workspace);
const f1 = features.create({ name: 'Alpha' });
features.assignTerminal(f1.featureId, A!, 1);
features.assignTerminal(f1.featureId, B!, 2);
const f2 = features.create({ name: 'Beta' });
features.assignTerminal(f2.featureId, C!, 1);

const known = [A!, B!, C!, D!];
const deliver = (terminalId: string) =>
  terminalId === B
    ? ({ delivery: 'queued', reason: 'hub_inbox' } as const)
    : ({ delivery: 'denied', reason: 'inbox_full' } as const);
const inputs: [string | null, unknown, boolean][] = [
  [f1.featureId, { from: { kind: 'user' }, to: [A, B, C, D], text: 'owner ✓' }, true],
  [f1.featureId, { from: { kind: 'terminal', terminalId: A }, to: [B], text: 'peer' }, true],
  [f1.featureId, { from: { kind: 'terminal', terminalId: C }, to: [B], text: 'foreign' }, true],
  [null, { from: { kind: 'user' }, to: [D, A], text: 'unassigned' }, true],
  [null, { from: { kind: 'terminal', terminalId: D }, to: [D], text: 'self' }, false],
  [f2.featureId, { from: { kind: 'user' }, to: [C], text: 'no hub' }, false],
];
const mentions = inputs.map(([featureId, input, hub]) => {
  try {
    const reply = recordComposerMention(
      userData,
      workspace,
      featureId,
      known,
      input as never,
      hub ? deliver : undefined,
    );
    const record = readFileSync(join(userData, 'composer-mentions', `${reply.id}.json`), 'utf8');
    return { reply: JSON.stringify(reply), record };
  } catch {
    return { error: true };
  }
});

const epoch = '00000000-0000-4000-8000-0000000000e1';
const hubJournal = hubMessageJournal(userData, epoch);
for (let index = 0; index < 7000; index++)
  hubJournal.append({
    messageId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    kind: (['message', 'task', 'result'] as const)[index % 3]!,
    from: index % 5 === 0 ? 'owner' : A!,
    to: B!,
    featureId: f1.featureId,
    at: 1_000 + index,
    ...(index % 3 ? { taskId: '00000000-0000-4000-8000-0000000000aa' } : {}),
  });
hubJournal.close();

const pairEpoch = '00000000-0000-4000-8000-0000000000e2';
const pair = mcpCommunicationJournal(userData, pairEpoch, workspace, [A!, B!], () =>
  featureConfigurationDatabase(userData, workspace).list(),
);
const [S, T, G1, G2, K1, K2] = ['51', '52', '61', '62', '71', '72'].map(
  (s) => `00000000-0000-4000-8000-0000000000${s}`,
);
const bound = pair.bind(S!, T!)!;
const evidence = (grantId: string, taskId: string, kind: 'delegation' | 'result', at: number) => ({
  grantId,
  taskId,
  sourceInstanceId: S!,
  targetInstanceId: T!,
  kind,
  at,
});
bound(evidence(G1!, K1!, 'result', 5)); // result before delegation: dropped
bound(evidence(G1!, K1!, 'delegation', 10));
bound(evidence(G1!, K1!, 'delegation', 11)); // duplicate id: dropped
bound(evidence(G1!, K2!, 'result', 12)); // task mismatch: dropped
bound(evidence(G1!, K1!, 'result', 13));
bound(evidence(G2!, K2!, 'delegation', 14));
bound({ ...evidence(G2!, K2!, 'result', 15), sourceInstanceId: T! }); // other instance: dropped
const projection = [f1.featureId, f2.featureId, null].map((id) => JSON.stringify(pair.project(id)));
console.log(JSON.stringify({ features: [f1.featureId, f2.featureId], mentions, projection }));
