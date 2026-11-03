import {
  sessionModelHistoryLimits,
  sessionModelHistoryResultSchema,
  type SessionModelHistoryResult,
} from '@orqst/protocol';

/** Enforce actual streamed bytes before decoding, JSON or schema materialization. */
export async function fetchSessionModelHistory(
  sessionId: string,
  signal: AbortSignal,
): Promise<SessionModelHistoryResult> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-history`, {
    credentials: 'same-origin',
    signal,
  });
  if (
    !response.ok ||
    !response.body ||
    response.headers.get('content-type')?.split(';')[0] !== 'application/json'
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Invalid model history response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > sessionModelHistoryLimits.responseBytes)
        throw new Error('Model history response limit');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = sessionModelHistoryResultSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
    );
    if (
      result.availability === 'available' &&
      (result.value.sessionId !== sessionId ||
        result.value.entries.some(
          (entry, index, entries) => index > 0 && entry.sequence >= entries[index - 1]!.sequence,
        ))
    )
      throw new Error('Invalid model history identity or order');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
