// SYNTHETIC interop check: the unchanged Node relay transport (connectMcpInstance from
// packages/core/src/terminal/mcp-socket.ts) talks to a Rust hub endpoint.
// Usage: tsx relay.ts <socketPath> <capabilityFile> -> prints JSON {role, results, second}.
import { connectMcpInstance } from '../../../../../packages/core/src/terminal/mcp-socket.js';

const [socketPath, capabilityFile] = process.argv.slice(2) as [string, string];
const client = await connectMcpInstance(socketPath, capabilityFile);
const results: unknown[] = [];
const calls = [
  { name: 'list_terminals', arguments: {} },
  { name: 'send_message', arguments: { to: '@T-002', text: 'hello from the relay ✓' } },
  { name: 'send_message', arguments: { to: 'T-009', text: 'nobody' } },
  { name: 'wait_messages', arguments: { timeout_ms: 50 } },
  { name: 'read_messages', arguments: { limit: 99 } },
];
for (const [index, call] of calls.entries()) {
  try {
    results.push({
      ok: await client.call(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, call),
    });
  } catch (error) {
    results.push({ error: (error as Error).message });
  }
}
// One authenticated connection per endpoint lifetime: a second client is refused.
let second = 'connected';
try {
  const other = await connectMcpInstance(socketPath, capabilityFile);
  other.close();
} catch {
  second = 'refused';
}
client.close();
console.log(JSON.stringify({ role: client.role, results, second }));
