import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import {
  preferencesSchema,
  artifactExtractionRequestSchema,
  modelAnalyticsQuerySchema,
  sessionMetricsRequestSchema,
  type Snapshot,
  type StoredEvent,
  type StreamMessage,
} from '@orqst/protocol';
import { codexDescriptor } from '@orqst/adapter-codex';
import { claudeDescriptor } from '@orqst/adapter-claude';
import { opencodeDescriptor } from '@orqst/adapter-opencode';
import type { ObserverCore } from '@orqst/core';
import type { Store } from '@orqst/database';
import { AnalyticsQueries, AnalyticsQueryError } from './analytics.js';
import type { Config } from './config.js';

const modelAnalyticsHttpQuerySchema = z
  .object({
    from: z.string().max(64).optional(),
    to: z.string().max(64).optional(),
    workspaceId: z.string().min(1).max(200).optional(),
    agentId: z.string().min(1).max(200).optional(),
    adapter: modelAnalyticsQuerySchema.shape.adapter,
    model: z.string().min(1).max(200).optional(),
    unidentified: z.literal('true').optional(),
  })
  .strict()
  .refine((query) => query.unidentified === undefined || query.model === undefined)
  .transform(({ unidentified, ...query }) => ({
    ...query,
    ...(unidentified === 'true' ? { model: null } : {}),
  }))
  .pipe(modelAnalyticsQuerySchema);

export function createLocalServer(
  store: Store,
  config: Config,
  observer: Pick<Snapshot, 'diagnostics'> & Partial<Pick<ObserverCore, 'extractArtifact'>>,
) {
  const analytics = new AnalyticsQueries(store.databasePath);
  const secret = randomBytes(32).toString('hex');
  let port = config.port;
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const hosts = (): string[] => [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    ...(config.dev ? ['127.0.0.1:5173', 'localhost:5173'] : []),
  ];
  const validOrigin = (origin: string | undefined): boolean =>
    Boolean(origin && hosts().some((host) => origin === `http://${host}`));
  function trusted(request: IncomingMessage): boolean {
    return (
      hosts().includes(request.headers.host ?? '') &&
      (!request.headers.origin || validOrigin(request.headers.origin)) &&
      (!request.headers['sec-fetch-site'] ||
        ['same-origin', 'same-site', 'none'].includes(String(request.headers['sec-fetch-site'])))
    );
  }
  function authorized(request: IncomingMessage): boolean {
    const token =
      request.headers.cookie
        ?.split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith('orqst_session='))
        ?.slice('orqst_session='.length) ?? '';
    return (
      Buffer.byteLength(token) === secret.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(secret))
    );
  }
  function reply(response: ServerResponse, status: number, data: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
  }
  async function body(request: IncomingMessage): Promise<unknown> {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json')
      throw new Error('Invalid content type');
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of request) {
      const buffer = Buffer.from(part as Uint8Array);
      size += buffer.length;
      if (size > 8192) throw new Error('Request too large');
      parts.push(buffer);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  }
  function snapshot(): Snapshot {
    return {
      cursor: store.cursor(),
      workspaces: store.workspaces(),
      sessions: store.sessions(),
      events: store.recentEvents(150),
      notifications: store.notifications(),
      preferences: store.preferences(),
      adapters: [codexDescriptor, claudeDescriptor, opencodeDescriptor],
      diagnostics: { ...observer.diagnostics },
    };
  }
  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    );
    void (async () => {
      if (!trusted(request)) {
        reply(response, 403, { error: 'forbidden_origin' });
        return;
      }
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
        response.setHeader(
          'Set-Cookie',
          `orqst_session=${secret}; HttpOnly; SameSite=Strict; Path=/`,
        );
        reply(response, 200, { version: '0.1.0', local: true });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(request)) {
          reply(response, 401, { error: 'unauthorized' });
          return;
        }
        if (url.pathname === '/api/snapshot' && request.method === 'GET') {
          reply(response, 200, snapshot());
          return;
        }
        const metrics = /^\/api\/sessions\/([^/]+)\/metrics$/.exec(url.pathname);
        if (metrics && request.method === 'GET') {
          const parsed = sessionMetricsRequestSchema.safeParse({
            sessionId: decodeURIComponent(metrics[1]!),
          });
          if (!parsed.success || url.search) {
            reply(response, 400, { error: 'invalid_metrics_request' });
            return;
          }
          reply(response, 200, store.sessionMetrics(parsed.data.sessionId));
          return;
        }
        if (url.pathname === '/api/analytics/models' && request.method === 'GET') {
          const keys = [...url.searchParams.keys()];
          const parsed = modelAnalyticsHttpQuerySchema.safeParse(
            Object.fromEntries(url.searchParams),
          );
          if (url.search.length > 2048 || new Set(keys).size !== keys.length || !parsed.success) {
            reply(response, 400, { error: 'invalid_query' });
            return;
          }
          const controller = new AbortController();
          const cancel = () => controller.abort();
          response.once('close', cancel);
          try {
            const report = await analytics.query(parsed.data, controller.signal);
            if (!response.destroyed) reply(response, 200, report);
          } catch (error) {
            if (!(error instanceof AnalyticsQueryError)) throw error;
            if (!response.destroyed)
              reply(response, error.code === 'analytics_timeout' ? 504 : 503, {
                error: error.code,
              });
          } finally {
            response.off('close', cancel);
          }
          return;
        }
        if (url.pathname === '/api/artifacts/extract' && request.method === 'POST') {
          const parsed = artifactExtractionRequestSchema.safeParse(await body(request));
          if (!parsed.success || url.search) {
            reply(response, 400, { error: 'invalid_artifact_request' });
            return;
          }
          if (!observer.extractArtifact) {
            reply(response, 503, { error: 'artifacts_unavailable' });
            return;
          }
          reply(response, 200, observer.extractArtifact(parsed.data));
          return;
        }
        if (url.pathname === '/api/events' && request.method === 'GET') {
          const parsed = z
            .object({
              after: z.coerce.number().int().min(0).default(0),
              before: z.coerce.number().int().min(1).optional(),
              limit: z.coerce.number().int().min(1).max(500).default(200),
              sessionId: z.string().max(200).optional(),
            })
            .safeParse(Object.fromEntries(url.searchParams));
          if (!parsed.success) {
            reply(response, 400, { error: 'invalid_query' });
            return;
          }
          reply(response, 200, {
            events: parsed.data.before
              ? store.eventsBefore(parsed.data.before, parsed.data.limit, parsed.data.sessionId)
              : store.events(parsed.data.after, parsed.data.limit, parsed.data.sessionId),
            cursor: store.cursor(),
          });
          return;
        }
        if (url.pathname === '/api/preferences' && request.method === 'PUT') {
          const prefs = preferencesSchema.parse(await body(request));
          store.setSetting('notifications', prefs);
          reply(response, 200, prefs);
          return;
        }
        if (url.pathname === '/api/notifications/read' && request.method === 'POST') {
          store.readNotifications();
          reply(response, 200, { ok: true });
          return;
        }
        if (url.pathname === '/api/workspaces' && request.method === 'POST') {
          const data = z
            .object({
              name: z.string().trim().min(1).max(100),
              path: z.string().trim().min(1).max(4096),
            })
            .parse(await body(request));
          // Manual paths are labels only, never filesystem operations.
          const id = store.workspace(data.path, data.name);
          reply(response, 201, { id });
          return;
        }
        const association = /^\/api\/sessions\/([^/]+)\/workspace$/.exec(url.pathname);
        if (association && request.method === 'PUT') {
          const data = z
            .object({ workspaceId: z.string().min(1).max(200).nullable() })
            .parse(await body(request));
          reply(
            response,
            store.associate(decodeURIComponent(association[1]!), data.workspaceId) ? 200 : 404,
            { ok: true },
          );
          return;
        }
        reply(response, 404, { error: 'not_found' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        reply(response, 405, { error: 'method_not_allowed' });
        return;
      }
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        reply(response, 400, { error: 'invalid_path' });
        return;
      }
      const root = resolve(config.dashboardDir);
      let file = resolve(root, '.' + path);
      if (file !== root && !file.startsWith(root + sep)) {
        reply(response, 403, { error: 'invalid_path' });
        return;
      }
      if (path.includes('\0') || path.split('/').some((part) => part.startsWith('.'))) {
        reply(response, 403, { error: 'invalid_path' });
        return;
      }
      if (file === root || !extname(file)) file = resolve(root, 'index.html');
      try {
        const canonical = await realpath(file);
        const canonicalRoot = await realpath(root);
        if (!canonical.startsWith(canonicalRoot + sep)) throw new Error('Invalid static file');
        if (!(await stat(canonical)).isFile()) throw new Error('Not a file');
        const content = await readFile(canonical);
        const mime: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
        };
        response.writeHead(200, {
          'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        });
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch {
        reply(response, 404, { error: 'dashboard_not_built' });
      }
    })().catch(() => {
      if (!response.headersSent) reply(response, 400, { error: 'invalid_request' });
      else response.end();
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    } catch {
      socket.destroy();
      return;
    }
    const cursor = Number(url.searchParams.get('after') ?? '0');
    if (
      url.pathname !== '/ws' ||
      !trusted(request) ||
      !validOrigin(request.headers.origin) ||
      !authorized(request) ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      client.on('error', () => client.terminate());
      const send = (message: StreamMessage): void => {
        client.send(JSON.stringify(message));
      };
      const current = store.cursor();
      const events = store.events(cursor, 1001);
      if (
        events.length > 1000 ||
        cursor > current ||
        (cursor < current && (!events.length || events[0]!.sequence !== cursor + 1))
      )
        send({ type: 'resync', cursor: current });
      else {
        for (const event of events) send({ type: 'event', event, live: false });
        send({ type: 'ready', cursor: current });
      }
      sockets.emit('connection', client, request);
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (socket.bufferedAmount > 1024 * 1024) socket.terminate();
      else socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  let closing: Promise<void> | undefined;
  return {
    server,
    snapshot,
    broadcast(event: StoredEvent, live: boolean): void {
      const payload = JSON.stringify({ type: 'event', event, live } satisfies StreamMessage);
      for (const socket of sockets.clients)
        if (socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > 1024 * 1024) socket.terminate();
          else socket.send(payload);
        }
    },
    async listen(): Promise<number> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          if (address && typeof address !== 'string') port = address.port;
          resolve();
        });
      });
      return port;
    },
    close(): Promise<void> {
      closing ??= (async () => {
        clearInterval(heartbeat);
        const httpClosed = new Promise<void>((resolve, reject) =>
          server.close((error: NodeJS.ErrnoException | undefined) =>
            error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve(),
          ),
        );
        for (const socket of sockets.clients) socket.terminate();
        await Promise.all([
          httpClosed,
          analytics.close(),
          new Promise<void>((resolve) => sockets.close(() => resolve())),
        ]);
      })();
      return closing;
    },
  };
}
