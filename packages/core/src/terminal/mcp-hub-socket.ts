// Private Unix endpoint for one terminal of the message hub (docs/design/mcp-n-terminals.md).
// Same framing, capability and file-mode rules as the pair transport in mcp-socket.ts.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from './codex-profile.js';
import { HubRefusal, type TerminalMessageHub } from './mcp-hub.js';
import { readMcpLines } from './mcp-socket.js';

const authenticate = z.strictObject({ secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const request = z.strictObject({ id: z.uuid(), call: z.unknown() });
const hash = (secret: string) => createHash('sha256').update(secret).digest();

/** Instructive refusal text for the agent (Anywh roomManager.ts:1334-1336 style). */
export const hubRefusalText: Record<string, string> = {
  unknown_terminal:
    'No such terminal in your Feature. Use list_terminals; other Features and yourself are not reachable.',
  inbox_full: 'That terminal has too many unread messages. Try later.',
  rate_limited: 'Too many messages this minute. Wait before sending more.',
  chain_too_deep:
    'This conversation chain reached its limit of three hops. Report back to the owner instead.',
  unknown_task: 'No such task for you.',
  already_submitted: 'This task already has a result.',
  too_many_tasks: 'Too many open tasks. Finish some first.',
  not_member: 'This terminal is not active in ORQST.',
  unavailable: 'ORQST messaging is unavailable right now.',
};

/**
 * `terminal` is the bound terminal id, or a lookup for endpoints opened ahead for slots that
 * enroll later (the Core's request handler is synchronous). An unbound endpoint refuses.
 */
export async function openHubEndpoint(
  hub: Pick<TerminalMessageHub, 'call'>,
  terminal: string | (() => string | undefined),
  parent = '/tmp',
) {
  if (typeof terminal === 'string') z.uuid().parse(terminal);
  const bound = () => (typeof terminal === 'string' ? terminal : terminal());
  const directory = await realpath(await mkdtemp(join(await realpath(parent), 'orqst-hub-')));
  await chmod(directory, 0o700);
  terminalDirectory(directory, true);
  const socketPath = join(directory, 'terminal.sock');
  if (Buffer.byteLength(socketPath) > 100) throw new Error('Unix socket path too long');
  const capabilityFile = join(directory, 'terminal.cap');
  const secret = randomBytes(32).toString('base64url');
  const expected = hash(secret);
  await writeFile(capabilityFile, secret, { flag: 'wx', mode: 0o600, flush: true });
  const sockets = new Set<Socket>();
  let claimed = false;
  let attempts = 0;
  let closed = false;
  const server = createServer((socket) => {
    if (closed || claimed || ++attempts > 16) return socket.destroy();
    sockets.add(socket);
    let authenticated = false;
    let busy = false;
    const timer = setTimeout(() => socket.destroy(), 2000);
    const unbind = readMcpLines(
      socket,
      (raw) => {
        if (!authenticated) {
          const parsed = authenticate.safeParse(raw);
          if (!parsed.success || !timingSafeEqual(expected, hash(parsed.data.secret)) || claimed)
            return socket.destroy();
          claimed = authenticated = true;
          clearTimeout(timer);
          socket.write(JSON.stringify({ authenticated: true, role: 'terminal' }) + '\n');
          return;
        }
        const parsed = request.safeParse(raw);
        // One call at a time per terminal, like the CLI's own tool loop.
        if (!parsed.success || busy) return socket.destroy();
        busy = true;
        const terminalId = bound();
        void (
          terminalId
            ? hub.call(terminalId, parsed.data.call)
            : Promise.reject(new HubRefusal('not_member'))
        )
          .then(
            (value) => ({ id: parsed.data.id, ok: true, value }),
            (error: unknown) =>
              error instanceof HubRefusal
                ? {
                    id: parsed.data.id,
                    ok: true,
                    value: {
                      refused: error.code,
                      message: hubRefusalText[error.code] ?? 'Refused.',
                    },
                  }
                : { id: parsed.data.id, ok: false },
          )
          .then((reply) => {
            if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n');
          })
          .finally(() => {
            busy = false;
          });
      },
      () => socket.destroy(),
    );
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(timer);
      unbind();
      sockets.delete(socket);
    });
  });
  server.maxConnections = 2;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const file of [socketPath, capabilityFile])
      await unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await rmdir(directory);
  };
  return { socketPath, capabilityFile, close };
}
