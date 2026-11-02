import {
  artifactExtractionResultSchema,
  artifactSaveRequestSchema,
  artifactTextLimit,
  type ArtifactExtractionRequest,
  type ArtifactSaveResult,
} from '@orqst/protocol';
import { MarkdownDestination } from './artifact-files.js';

export function validateExtractedArtifact(
  data: unknown,
  selection: ArtifactExtractionRequest,
): string {
  const result = artifactExtractionResultSchema.parse(data);
  if (result.availability !== 'available') throw new Error('Artifact unavailable');
  const { reference, original } = result.value;
  const { evidence, identity } = reference;
  if (
    evidence.sequence !== selection.sequence ||
    evidence.eventId !== selection.eventId ||
    evidence.source.hash !== selection.sourceHash ||
    identity.sessionRef.nativeSessionId !== selection.sessionId ||
    identity.sessionRef.machineId !== selection.machineId ||
    identity.sessionRef.adapterId !== selection.adapter ||
    identity.workspaceId !== selection.workspaceId ||
    identity.observedAgent.id !== selection.agentId ||
    Buffer.from(original.text, 'utf8').toString('utf8') !== original.text ||
    original.text.includes('\0') ||
    Buffer.byteLength(original.text) > artifactTextLimit
  )
    throw new Error('Artifact mismatch');
  return original.text;
}

export async function readSaveOriginal(
  fetcher: typeof fetch,
  origin: string,
  selection: ArtifactExtractionRequest,
  authorized: () => boolean = () => true,
): Promise<string> {
  const check = () => {
    if (!authorized()) throw new Error('Revoked operation');
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    check();
    const response = await fetcher(`${origin}/api/artifacts/extract`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(selection),
      signal: controller.signal,
    });
    if (
      !authorized() ||
      !response.ok ||
      !response.body ||
      response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
    ) {
      await response.body?.cancel();
      throw new Error('Artifact unavailable');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        check();
        if (done) break;
        size += value.byteLength;
        if (size > 262144) throw new Error('Artifact response limit');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return validateExtractedArtifact(JSON.parse(Buffer.concat(chunks).toString('utf8')), selection);
  } finally {
    clearTimeout(timeout);
  }
}

export interface SaveDependencies {
  authorized(): boolean;
  original(selection: ArtifactExtractionRequest): Promise<string>;
  choose(): Promise<string | undefined>;
  confirm(path: string): Promise<boolean>;
  open(path: string): Promise<string>;
}

/** One operation, no queue, no retained grants, and no caller-supplied destination. */
export class ArtifactSaver {
  private busy = false;

  async save(input: unknown, deps: SaveDependencies): Promise<ArtifactSaveResult> {
    if (this.busy || !deps.authorized()) return { status: 'failed' };
    const parsed = artifactSaveRequestSchema.safeParse(input);
    if (!parsed.success) return { status: 'failed' };
    this.busy = true;
    let destination: MarkdownDestination | undefined;
    let saved = false;
    const check = () => {
      if (!deps.authorized()) throw new Error('Revoked operation');
    };
    try {
      const original = await deps.original(parsed.data.selection);
      check();
      const text = parsed.data.representation === 'original' ? original : parsed.data.draft;
      const selected = await deps.choose();
      check();
      if (selected === undefined) return { status: 'cancelled' };
      destination = new MarkdownDestination(selected);
      if (destination.exists) {
        const confirmed = await deps.confirm(destination.path);
        check();
        if (!confirmed) return { status: 'cancelled' };
      }
      check();
      destination.write(text);
      saved = true;
      if (parsed.data.openAfterSave) {
        check();
        destination.verifySaved();
        const error = await deps.open(destination.path);
        check();
        return { status: error ? 'saved_open_failed' : 'saved_opened' };
      }
      return { status: 'saved' };
    } catch {
      return {
        status: saved ? 'saved_open_failed' : destination?.touched ? 'write_failed' : 'failed',
      };
    } finally {
      try {
        destination?.close();
      } catch {
        /* No OS diagnostics cross the native boundary. */
      }
      this.busy = false;
    }
  }
}
