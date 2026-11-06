// SYNTHETIC golden fixture (no user data, no sockets): drive the TypeScript
// TerminalMessageHub (packages/core/src/terminal/mcp-hub.ts) with a fixed clock and id
// sequence. Usage: tsx hub.ts <hub-steps.json> -> prints JSON {results, evidence}.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';

let sequence = 0;
crypto.randomUUID = () =>
  `00000000-0000-4000-8000-${(0x100000000000 + ++sequence).toString(16)}` as ReturnType<
    typeof crypto.randomUUID
  >;
syncBuiltinESMExports();
const { TerminalMessageHub, HubRefusal } =
  await import('../../../../../packages/core/src/terminal/mcp-hub.js');

type Member = {
  terminalId: string;
  alias: string;
  name: string;
  provider: string;
  featureId: string | null;
  running: boolean;
};
const fixture = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  members: Member[];
  steps: Record<string, unknown>[];
};
let clock = 1_000_000;
const members = fixture.members.map((member) => ({ ...member }));
const evidence: unknown[] = [];
const hub = new TerminalMessageHub(
  () => members,
  (event: unknown) => evidence.push(event),
  () => clock,
);
let lastTask = '00000000-0000-4000-8000-000000000000';
const results: string[] = [];
for (const step of fixture.steps) {
  try {
    switch (step.op) {
      case 'call': {
        const call = JSON.parse(JSON.stringify(step.call).replaceAll('$TASK', lastTask));
        const value = (await hub.call(step.from as string, call)) as { taskId?: string };
        if (call.name === 'delegate_task' && value.taskId) lastTask = value.taskId;
        results.push(`ok:${JSON.stringify(value)}`);
        break;
      }
      case 'owner':
        results.push(
          `ok:${JSON.stringify(hub.ownerSend(step.featureId as string, step.to as string, step.text as string))}`,
        );
        break;
      case 'advance':
        clock += step.ms as number;
        results.push('ok:null');
        break;
      case 'stop':
        members.find((member) => member.terminalId === step.terminal)!.running = false;
        results.push('ok:null');
        break;
      case 'forget':
        hub.forget(step.terminal as string);
        results.push('ok:null');
        break;
      case 'close':
        hub.close();
        results.push('ok:null');
        break;
      default:
        results.push('ok:null');
    }
  } catch (error) {
    results.push(error instanceof HubRefusal ? `refused:${error.code}` : 'error');
  }
}
console.log(JSON.stringify({ results, evidence }));
