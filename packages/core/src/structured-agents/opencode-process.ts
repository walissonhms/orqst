import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { request, type IncomingMessage } from 'node:http';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { BoundedLineSplitter } from '../managed-codex/line-splitter.js';
import { reviewedProviderMcpBinaries } from '../terminal/provider-mcp-config.js';
import { processTransport, type StructuredProcessExit } from './codex-process.js';
import { StructuredStartupFailure } from './session.js';

const wireBytes = 24 * 1024 * 1024;
const lineBytes = 1024 * 1024;
const requestMs = 8_000;
const startupMs = 36_000;
export const openCodePermissions = [
  { action: '*', resource: '*', effect: 'deny' },
  ...['read', 'edit', 'glob', 'grep'].map((action) => ({ action, resource: '*', effect: 'ask' })),
];

const config = JSON.stringify({
  share: 'disabled',
  formatter: false,
  lsp: false,
  snapshots: false,
  update: 'disable',
  warming: false,
  experimental: { schedules: false },
  plugins: ['-opencode.config.mcp'],
  permissions: openCodePermissions,
  policies: ['mcp.use', 'plugin.use', 'skill.use', 'integration.connect'].map((action) => ({
    action,
    resource: '*',
    effect: 'deny',
  })),
});

export interface OpenCodeLaunch {
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const userDirectories = [
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
] as const;

function userEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {
    HOME: env.HOME && isAbsolute(env.HOME) ? env.HOME : userInfo().homedir,
    PATH: env.PATH ?? '/usr/bin:/bin',
    LANG: env.LANG ?? 'en_US.UTF-8',
  };
  for (const key of userDirectories) {
    const value = env[key];
    if (value && isAbsolute(value)) result[key] = value;
  }
  return result;
}

function verifyManagedConfigAbsent(): void {
  const paths =
    process.platform === 'darwin'
      ? [
          '/Library/Application Support/opencode',
          '/Library/Managed Preferences/ai.opencode.managed.plist',
          join('/Library/Managed Preferences', userInfo().username, 'ai.opencode.managed.plist'),
        ]
      : ['/etc/opencode'];
  for (const path of paths) {
    try {
      lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('OpenCode managed configuration takes precedence over pilot policy');
  }
}

export const openCodeArgs = ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'];

export class OwnedOpenCode {
  private readonly lifetime = new AbortController();
  private readonly process;
  private readonly auth: string;
  private readonly endpoint: Promise<number>;
  private bytes = 0;
  readonly exited: Promise<StructuredProcessExit>;

  constructor({ executable, cwd, env }: OpenCodeLaunch) {
    if (!isAbsolute(executable) || !isAbsolute(cwd) || process.platform === 'win32')
      throw new Error('Structured OpenCode requires absolute paths and POSIX groups');
    verifyManagedConfigAbsent();
    const password = randomBytes(32).toString('base64url');
    this.auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
    const child = spawn(executable, openCodeArgs, {
      cwd,
      env: {
        ...userEnvironment(env),
        OPENCODE_PASSWORD: password,
        OPENCODE_CLIENT: 'orqst',
        OPENCODE_CONFIG_CONTENT: config,
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        OPENCODE_DISABLE_CLAUDE_CODE: '1',
        OPENCODE_DISABLE_FILEWATCHER: '1',
        OPENCODE_DISABLE_MODELS_FETCH: '1',
        OPENCODE_DISABLE_FFF: '1',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
      detached: true,
    });
    this.process = processTransport(child, 1200);
    this.exited = this.process.exited.then((exit) => {
      this.lifetime.abort();
      return exit;
    });
    this.endpoint = new Promise<number>((resolve, reject) => {
      const lines = new BoundedLineSplitter(4096);
      const expire = setTimeout(
        reject,
        startupMs,
        new StructuredStartupFailure('provider_startup_timeout'),
      );
      let ready = false;
      const finish = () => clearTimeout(expire);
      this.process.listen(
        (chunk) => {
          if (ready) return; // Keep draining stdout after consuming the one readiness line.
          try {
            for (const line of lines.push(Buffer.from(chunk))) {
              const { url } = z.strictObject({ url: z.string() }).parse(JSON.parse(decode(line)));
              const port = Number(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(url)?.[1]);
              if (!Number.isInteger(port) || port > 65535) throw new Error('Invalid loopback port');
              ready = true;
              finish();
              resolve(port);
              return;
            }
          } catch {
            finish();
            reject(new Error('OpenCode readiness unavailable'));
          }
        },
        () => {
          finish();
          reject(new Error('OpenCode exited before readiness'));
          if (ready) void this.terminate().catch(() => {});
        },
      );
    });
  }

  get pid() {
    return this.process.pid;
  }

  async verify(): Promise<void> {
    // Cold process startup has its own deadline and must not spend an HTTP request budget.
    await this.endpoint;
    const untrusted = await this.http(
      '/api/event',
      'GET',
      undefined,
      AbortSignal.timeout(requestMs),
      false,
    );
    untrusted.destroy();
    if (untrusted.statusCode !== 401) throw new Error('OpenCode authentication unavailable');
    z.object({ version: z.literal(reviewedProviderMcpBinaries.opencode.version) }).parse(
      await this.json('/api/info'),
    );
  }

  async json(path: string, payload?: object, empty = false): Promise<unknown> {
    const response = await this.http(
      path,
      payload ? 'POST' : 'GET',
      payload,
      AbortSignal.timeout(requestMs),
    );
    try {
      if (empty ? response.statusCode !== 204 : response.statusCode !== 200)
        throw new Error('Unexpected OpenCode HTTP status');
      if (empty) return;
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk);
        this.charge(buffer.length);
        bytes += buffer.length;
        if (bytes > lineBytes) throw new Error('OpenCode response too large');
        chunks.push(buffer);
      }
      return JSON.parse(decode(Buffer.concat(chunks)));
    } finally {
      response.destroy();
    }
  }

  async *events(path: string, signal: AbortSignal): AsyncGenerator<unknown> {
    const response = await this.http(path, 'GET', undefined, signal);
    try {
      if (
        response.statusCode !== 200 ||
        !/^text\/event-stream(?:;|$)/i.test(response.headers['content-type'] ?? '')
      )
        throw new Error('OpenCode event stream unavailable');
      const lines = new BoundedLineSplitter(lineBytes);
      let frame = '';
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk);
        this.charge(buffer.length);
        for (const raw of lines.push(buffer)) {
          const line = decode(raw).replace(/\r$/, '');
          if (!line && frame) {
            const event: unknown = JSON.parse(frame);
            frame = '';
            yield event;
          }
          if (line.startsWith('data:')) {
            frame += (frame ? '\n' : '') + line.slice(5).trimStart();
            if (frame.length > lineBytes) throw new Error('OpenCode event frame too large');
          }
        }
      }
      if (frame || lines.pendingLength) throw new Error('Truncated OpenCode event');
    } finally {
      response.destroy();
    }
  }

  terminate(): Promise<StructuredProcessExit> {
    this.lifetime.abort();
    void this.process.terminate();
    return this.exited;
  }

  private charge(bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > wireBytes) throw new Error('OpenCode wire budget exceeded');
  }

  private async http(
    path: string,
    method: 'GET' | 'POST',
    payload: object | undefined,
    signal: AbortSignal,
    authorized = true,
  ): Promise<IncomingMessage> {
    const port = await this.endpoint;
    const body = payload && JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          agent: false,
          signal: AbortSignal.any([this.lifetime.signal, signal]),
          headers: {
            ...(authorized ? { authorization: this.auth } : {}),
            ...(body
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
              : {}),
          },
        },
        resolve,
      );
      outgoing.setTimeout(35_000, () => outgoing.destroy(new Error('OpenCode stream idle')));
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }
}

function decode(buffer: Buffer): string {
  return new TextDecoder('utf8', { fatal: true }).decode(buffer);
}
