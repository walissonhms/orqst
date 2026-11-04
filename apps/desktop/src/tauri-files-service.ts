import { z } from 'zod';
import {
  analyticsNativeRequestSchema,
  artifactSaveRequestSchema,
  type AnalyticsNativeResult,
  type ArtifactSaveResult,
} from '@orqst/protocol';
import { AnalyticsSaver, readNativeAnalytics } from './analytics.js';
import { ArtifactSaver, readSaveOriginal } from './artifacts.js';

export const tauriFileRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('artifact'), input: artifactSaveRequestSchema }),
  z.strictObject({ kind: z.literal('analytics'), input: analyticsNativeRequestSchema }),
]);
export type TauriFileRequest = z.infer<typeof tauriFileRequestSchema>;
export interface FileDialog {
  title: string;
  message?: string;
  name: string;
  extension: 'md' | 'csv';
}
export interface TauriFilePorts {
  fetch: typeof fetch;
  origin: string;
  translate(key: string, values?: Record<string, unknown>): string;
  choose(dialog: FileDialog): Promise<string | undefined>;
  confirm(title: string, path: string): Promise<boolean>;
  open(path: string): Promise<string>;
}

/** Electron's exact savers, with a separate document fence and a single shared file latch. */
export class TauriFilesService {
  private document = 0;
  private live = true;
  private busy = false;
  private readonly artifact = new ArtifactSaver();
  private readonly analytics = new AnalyticsSaver();
  constructor(private readonly ports: TauriFilePorts) {}

  revoke(document: number): void {
    if (Number.isSafeInteger(document) && document > this.document) this.document = document;
  }
  close(): void {
    this.live = false;
  }
  async request(
    raw: unknown,
    document: number,
  ): Promise<ArtifactSaveResult | AnalyticsNativeResult> {
    const parsed = tauriFileRequestSchema.safeParse(raw);
    if (!parsed.success || !this.live || document !== this.document) return { status: 'failed' };
    const expires = Date.now() + 180_000;
    const authorized = () => this.live && this.document === document && Date.now() < expires;
    const request = parsed.data;
    // Context revocation must work while a native dialog/file operation is pending.
    if (request.kind === 'analytics' && request.input.action === 'context')
      return this.analytics.context(request.input, document);
    let claimed = false;
    const claim = () => {
      if (this.busy) return undefined;
      this.busy = true;
      claimed = true;
      return () => {
        this.busy = false;
        claimed = false;
      };
    };
    const { fetch: fetcher, origin, translate: t } = this.ports;
    try {
      if (request.kind === 'artifact') {
        if (!claim()) return { status: 'failed' };
        return await this.artifact.save(request.input, {
          authorized,
          original: (selection) => readSaveOriginal(fetcher, origin, selection, authorized),
          choose: () =>
            this.ports.choose({
              title: t('artifacts.nativeSave'),
              name: 'artifact.md',
              extension: 'md',
            }),
          confirm: (path) => this.ports.confirm(t('artifacts.nativeOverwrite'), path),
          open: (path) => this.ports.open(path),
        });
      }
      return await this.analytics.save(request.input, {
        document,
        authorized,
        claim,
        read: (reading, active) => readNativeAnalytics(fetcher, origin, reading, active),
        choose: (input, report) => {
          const csv = input.format === 'csv';
          return this.ports.choose({
            title: t('analytics.export.nativeTitle'),
            message: t('analytics.export.nativeReading', {
              format: csv ? 'CSV' : 'Markdown',
              ranking: t(
                input.reading.ranking === 'tokens' ? 'analytics.byTokens' : 'analytics.bySessions',
              ),
              at: input.reading.obtainedAt,
              from: report.query.from ?? t('analytics.export.unbounded'),
              to: report.query.to ?? t('analytics.export.unbounded'),
              filters: (['workspaceId', 'agentId', 'adapter', 'model'] as const)
                .map(
                  (key) =>
                    `${t(key === 'workspaceId' ? 'workspaces' : `analytics.${key === 'agentId' ? 'agent' : key}`)}: ${t(report.query[key] === undefined ? 'analytics.export.filterAll' : 'analytics.export.filterApplied')}`,
                )
                .join('; '),
              sessions: report.sessions,
              tokens: report.usage?.total ?? t('unknown'),
            }),
            name: `orqst-model-usage.${csv ? 'csv' : 'md'}`,
            extension: csv ? 'csv' : 'md',
          });
        },
        confirm: (path) => this.ports.confirm(t('analytics.export.nativeOverwrite'), path),
      });
    } finally {
      if (claimed) this.busy = false;
    }
  }
}

/** Bootstrap once against the native-owned origin; retain the cookie only inside this host. */
export async function nativeFileFetch(origin: string): Promise<typeof fetch> {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port
  )
    throw new Error('Invalid Core origin');
  const response = await fetch(`${origin}/api/bootstrap`, {
    redirect: 'error',
    headers: { Origin: origin },
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  const cookie = response.headers.get('set-cookie')?.match(/^orqst_session=([a-f0-9]{64});/);
  if (!response.ok || !cookie) throw new Error('Core bootstrap refused');
  return (input, init) => {
    const target = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (
      target.origin !== origin ||
      !['/api/artifacts/extract', '/api/events', '/api/analytics/models'].includes(target.pathname)
    )
      return Promise.reject(new Error('Fixed export route required'));
    const headers = new Headers(init?.headers);
    headers.set('Cookie', `orqst_session=${cookie[1]}`);
    headers.set('Origin', origin);
    return fetch(target, { ...init, headers, redirect: 'error' });
  };
}
