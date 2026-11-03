import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync as realpathSyncFile,
} from 'node:fs';
import { chmod, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from './codex-profile.js';
import { McpTaskBroker, mcpToolCallSchema, type McpRole } from './mcp-task.js';

const authenticate = z.strictObject({ secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const request = z.strictObject({ id: z.uuid(), call: mcpToolCallSchema });
const response = z.union([
  z.strictObject({ authenticated: z.literal(true), role: z.enum(['source', 'worker']) }),
  z.strictObject({ id: z.uuid(), ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id: z.uuid(), ok: z.literal(false) }),
]);
const hash = (secret: string) => createHash('sha256').update(secret).digest();

/** Bounded newline framing; no payload is logged, queued without a limit or treated as code. */
export function readMcpLines(
  socket: NodeJS.ReadableStream,
  line: (value: unknown) => void,
  failed: () => void,
) {
  let pending = Buffer.alloc(0);
  let stopped = false;
  const data = (chunk: Buffer | string) => {
    if (stopped) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    // A stream chunk is bounded as well as each individual record.
    if (bytes.length + pending.length > 131072) return fail();
    pending = Buffer.concat([pending, bytes]);
    let end: number;
    while ((end = pending.indexOf(10)) >= 0) {
      const bytes = pending.subarray(0, end);
      pending = pending.subarray(end + 1);
      if (bytes.length > 65536) return fail();
      try {
        line(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      } catch {
        return fail();
      }
      if (stopped) return;
    }
    if (pending.length > 65536) fail();
  };
  const fail = () => {
    if (!stopped) {
      stopped = true;
      failed();
    }
  };
  const end = () => {
    if (pending.length) fail();
  };
  socket.on('data', data);
  socket.on('end', end);
  return () => {
    stopped = true;
    socket.off('data', data);
    socket.off('end', end);
    pending = Buffer.alloc(0);
  };
}

/** Opt-in local Unix transport only. No TCP/HTTP endpoint, observed session or PTY access. */
export async function openMcpInstanceSockets(
  broker: Pick<McpTaskBroker, 'call' | 'close'> & { snapshot(): { state: string } },
  parent = '/tmp',
) {
  if (process.platform === 'win32' || !['ungranted', 'ready'].includes(broker.snapshot().state))
    throw new Error('MCP transport unavailable');
  const directory = await realpath(await mkdtemp(join(await realpath(parent), 'orqst-mcp-')));
  await chmod(directory, 0o700);
  terminalDirectory(directory, true);
  const servers: ReturnType<typeof createServer>[] = [];
  const sockets = new Set<Socket>();
  const files: string[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    broker.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    for (const file of files)
      await unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await rmdir(directory);
  };
  const endpoints: Array<{ role: McpRole; socketPath: string; capabilityFile: string }> = [];
  try {
    for (const role of ['source', 'worker'] as const) {
      const socketPath = join(directory, `${role}.sock`);
      if (Buffer.byteLength(socketPath) > 100) throw new Error('Unix socket path too long');
      const capabilityFile = join(directory, `${role}.cap`);
      const secret = randomBytes(32).toString('base64url');
      const expected = hash(secret);
      await writeFile(capabilityFile, secret, { flag: 'wx', mode: 0o600, flush: true });
      files.push(capabilityFile);
      let claimed = false;
      let attempts = 0;
      const server = createServer((socket) => {
        if (closed || claimed || ++attempts > 16) return socket.destroy();
        sockets.add(socket);
        let authenticated = false,
          busy = false,
          calls = 0;
        const timer = setTimeout(() => socket.destroy(), 2000);
        const unbind = readMcpLines(
          socket,
          (raw) => {
            if (!authenticated) {
              const parsed = authenticate.safeParse(raw);
              if (
                !parsed.success ||
                !timingSafeEqual(expected, hash(parsed.data.secret)) ||
                claimed
              )
                return socket.destroy();
              claimed = authenticated = true;
              clearTimeout(timer);
              socket.write(JSON.stringify({ authenticated: true, role }) + '\n');
              return;
            }
            const parsed = request.safeParse(raw);
            if (!parsed.success || busy || ++calls > 3) return socket.destroy();
            busy = true;
            void broker
              .call(role, parsed.data.call)
              .then((value) => {
                if (!socket.destroyed)
                  socket.write(JSON.stringify({ id: parsed.data.id, ok: true, value }) + '\n');
              })
              .catch(() => {
                if (!socket.destroyed)
                  socket.write(JSON.stringify({ id: parsed.data.id, ok: false }) + '\n');
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
          if (authenticated) broker.close(); // Lost MCP != CLI exit; no reconnect/retry.
        });
      });
      server.maxConnections = 2;
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', () => {
        broker.close();
      });
      await chmod(socketPath, 0o600);
      files.push(socketPath);
      endpoints.push({ role, socketPath, capabilityFile });
    }
    return { directory, endpoints, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Relay reads only its exact private capability. No provider credential lookup or inherited token. */
function readCapability(file: string): string {
  terminalDirectory(dirname(file), true);
  if (realpathSyncFile(file) !== file) throw new Error('Noncanonical MCP capability');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077 ||
      stat.nlink !== 1 ||
      stat.size !== 43
    )
      throw new Error('MCP capability unavailable');
    const secret = readFileSync(fd, 'utf8');
    return authenticate.parse({ secret }).secret;
  } finally {
    closeSync(fd);
  }
}

// Kept separate from the async setup path: the child never repairs or creates a capability.

export async function connectMcpInstance(socketPath: string, capabilityFile: string) {
  if (dirname(socketPath) !== dirname(capabilityFile) || Buffer.byteLength(socketPath) > 100)
    throw new Error('MCP endpoint mismatch');
  const secret = readCapability(capabilityFile);
  const target = lstatSync(socketPath);
  if (
    realpathSyncFile(socketPath) !== socketPath ||
    !target.isSocket() ||
    target.uid !== process.getuid?.() ||
    target.mode & 0o077
  )
    throw new Error('Private MCP socket unavailable');
  const socket = createConnection(socketPath);
  let pending:
    | {
        id: string;
        resolve(value: unknown): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let initialized = false;
  let ready: (role: McpRole) => void;
  let reject: (error: Error) => void;
  const startup = new Promise<McpRole>((resolve, fail) => {
    ready = resolve;
    reject = fail;
  });
  const fail = () => {
    socket.destroy();
    const error = new Error('MCP transport unavailable; outcome unknown; no retry');
    reject(error);
    clearTimeout(pending?.timer);
    pending?.reject(error);
    pending = undefined;
  };
  const timer = setTimeout(fail, 2000);
  socket.on('connect', () => {
    try {
      const current = lstatSync(socketPath);
      if (
        !current.isSocket() ||
        current.dev !== target.dev ||
        current.ino !== target.ino ||
        current.mode & 0o077 ||
        current.uid !== process.getuid?.()
      )
        return fail();
      socket.write(JSON.stringify({ secret }) + '\n');
    } catch {
      fail();
    }
  });
  socket.on('error', fail);
  socket.on('close', fail);
  const unbind = readMcpLines(
    socket,
    (raw) => {
      const parsed = response.safeParse(raw);
      if (!parsed.success) return fail();
      const r = parsed.data;
      if ('authenticated' in r) {
        if (initialized) return fail();
        initialized = true;
        clearTimeout(timer);
        ready(r.role);
        return;
      }
      if (!initialized || !pending || pending.id !== r.id) return fail();
      const active = pending;
      pending = undefined;
      clearTimeout(active.timer);
      if (r.ok) active.resolve(r.value);
      else active.reject(new Error('MCP operation denied'));
    },
    fail,
  );
  try {
    const role = await startup;
    return {
      role,
      call(id: string, call: unknown) {
        const value = request.parse({ id, call });
        if (pending || socket.destroyed)
          return Promise.reject(new Error('MCP request unavailable'));
        return new Promise<unknown>((resolve, reject) => {
          pending = { id, resolve, reject, timer: setTimeout(fail, 125000) };
          socket.write(JSON.stringify(value) + '\n', (error) => {
            if (error) fail();
          });
        });
      },
      close() {
        clearTimeout(timer);
        unbind();
        fail();
      },
    };
  } catch (error) {
    clearTimeout(timer);
    unbind();
    fail();
    throw error;
  }
}
