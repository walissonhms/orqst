import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  desktopStructuredAgentsRequestSchema,
  structuredAgentsReviewSchema,
  structuredAgentsScopeSchema,
  type StructuredProvider,
} from '@orqst/protocol';
import { redact } from '@orqst/shared';
import { terminalExecutableSha256 } from '../../../packages/core/src/terminal/codex-profile.js';
import { discoverLocalClis } from '../../../packages/core/src/terminal/local-cli.js';
import { resolveTerminalPreparationContext } from '../../../packages/core/src/terminal/preparation-context.js';
import { BoundedLineSplitter } from '../../../packages/core/src/managed-codex/line-splitter.js';
import { structuredCodexEnvironment } from '../../../packages/core/src/structured-agents/codex-process.js';
import { reviewedProviderMcpBinaries } from '../../../packages/core/src/terminal/provider-mcp-config.js';
import { openCodeArgs } from '../../../packages/core/src/structured-agents/opencode-process.js';
import { StructuredAgents } from '../../../packages/core/src/structured-agents/service.js';
import { structuredMentionGrant } from './structured-mention.js';

const reviewed = {
  codex: {
    version: '0.169.0',
    sha256: '739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002',
  },
  opencode: reviewedProviderMcpBinaries.opencode,
};
const correlation = z.object({ id: z.number().int().safe().positive() });
const envelope = z.strictObject({
  ...correlation.shape,
  scope: structuredAgentsScopeSchema,
  request: desktopStructuredAgentsRequestSchema,
  operation: z.enum(['snapshot', 'prepare', 'apply']),
  token: z.uuid().optional(),
});

function executable(provider: StructuredProvider): string {
  const candidates = discoverLocalClis(process.env.PATH ?? '', process.env.HOME).find(
    (entry) => entry.provider === provider,
  )!.candidates;
  for (const { canonical } of candidates) {
    try {
      if (terminalExecutableSha256(canonical) === reviewed[provider].sha256) return canonical;
    } catch {
      // Inaccessible and unreviewed executables cannot be used.
    }
  }
  throw new Error('Reviewed structured executable unavailable');
}

async function run(): Promise<void> {
  process.umask(0o077);
  if (
    process.env.ORQST_STRUCTURED_AGENTS !== '1' ||
    process.platform !== 'darwin' ||
    process.arch !== 'arm64' ||
    process.getuid?.() === 0 ||
    !/^v24\./.test(process.version)
  )
    throw new Error('Structured pilot unavailable');
  const preferencesDirectory = z.string().startsWith('/').max(2048).parse(process.argv[2]);
  const trusted = {
    preferencesDirectory,
    observerDatabase: join(dirname(preferencesDirectory), 'core/orqst.db'),
  };
  const service = new StructuredAgents();
  let plan: { token: string; binding: string; expiresAt: number } | undefined;
  let closed = false;
  let mutating = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    plan = undefined;
    process.stdin.destroy();
    void service.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  function send(id: number, value: object) {
    if (closed) return;
    const line = JSON.stringify({ id, value }) + '\n';
    if (Buffer.byteLength(line) > 512 * 1024 || process.stdout.writableLength > 512 * 1024)
      return shutdown();
    process.stdout.write(line);
  }
  async function receive(message: z.infer<typeof envelope>) {
    const { id, scope, request: submitted, operation, token } = message;
    if (operation === 'apply' && mutating) return send(id, { status: 'busy' });
    if (operation === 'apply') mutating = true;
    try {
      const { project, feature, fence } = resolveTerminalPreparationContext(
        trusted,
        scope.workspaceId,
        scope.featureId,
      );
      if (!feature) return send(id, { status: 'denied' });
      const request =
        submitted.action === 'mention'
          ? structuredMentionGrant(scope, service.snapshot(scope).sessions, submitted)
          : submitted;
      if (!request) return send(id, { status: 'denied' });
      if (operation === 'snapshot' && request.action === 'snapshot')
        return send(id, { status: 'ok', snapshot: service.snapshot(scope) });
      if (request.action === 'snapshot' || operation === 'snapshot')
        return send(id, { status: 'denied' });
      const action = service.review(scope, request);
      if (!action) return send(id, { status: 'denied' });
      const provider = request.action === 'start' ? (request.provider ?? 'codex') : undefined;
      const launch = provider
        ? {
            executable: executable(provider),
            cwd: project,
            env: provider === 'opencode' ? process.env : structuredCodexEnvironment(process.env),
            provider,
          }
        : undefined;
      const review = {
        feature: feature.name,
        featureId: scope.featureId,
        ...(launch && provider
          ? {
              project,
              executable: launch.executable,
              version: reviewed[provider].version,
              sha256: reviewed[provider].sha256,
              ...(provider === 'opencode'
                ? {
                    arguments: openCodeArgs,
                    storage: 'existing OpenCode login, configuration and local session history',
                    approvalPolicy:
                      'Ask for read, edit, glob and grep unless OpenCode has a matching saved approval. Deny other tools.',
                  }
                : { sandbox: 'read-only', approvalPolicy: 'on-request' }),
            }
          : {}),
        ...action,
      };
      const binding = JSON.stringify([scope, submitted, request, fence, feature.revision, review]);
      if (operation === 'prepare') {
        const detail = JSON.stringify(review, null, 2).replace(
          /[\p{Cf}\u2028\u2029]/gu,
          (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
        );
        const checked = structuredAgentsReviewSchema.safeParse({ token: randomUUID(), detail });
        if (!checked.success || detail !== redact(detail)) return send(id, { status: 'denied' });
        plan = { token: checked.data.token, binding, expiresAt: Date.now() + 60_000 };
        return send(id, { status: 'ok', ...checked.data });
      }
      const confirmed = plan;
      plan = undefined;
      if (
        !confirmed ||
        confirmed.token !== token ||
        confirmed.binding !== binding ||
        confirmed.expiresAt <= Date.now()
      )
        return send(id, { status: 'denied' });
      send(id, await service.apply(scope, request, launch));
    } catch {
      send(id, { status: 'unavailable' });
    } finally {
      if (operation === 'apply') mutating = false;
    }
  }

  const lines = new BoundedLineSplitter(64 * 1024);
  process.stdin.on('data', (chunk: Buffer) => {
    try {
      for (const line of lines.push(chunk)) {
        if (closed) return;
        if (line.toString('utf8') === 'shutdown') return shutdown();
        const raw: unknown = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(line));
        const message = envelope.safeParse(raw);
        if (message.success) void receive(message.data);
        else {
          const reply = correlation.safeParse(raw);
          if (reply.success) send(reply.data.id, { status: 'denied' });
        }
      }
    } catch {
      shutdown();
    }
  });
  process.stdin.on('end', shutdown);
  process.stdin.on('error', shutdown);
  process.stdout.on('error', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.stdin.resume();
}

void run().catch(() => {
  process.exitCode = 1;
});
