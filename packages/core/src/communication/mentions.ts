// Adapted from Tucano, Apache-2.0, commit 0501956d127699300209902e889f3e69a0948766:
// src/core/context.ts:303 (mentioned), src/shared/types.ts:464 (CODE_SPANS).
// ORQST modifications: return normalized handles rather than application-specific Agents;
// retain unknown handles for fail-closed routing; reject partial/oversized handles and email locals.
// See NOTICE and docs/research/mention-communication.md. No upstream dependencies imported.
const codeSpans = /(`{3,}|~{3,})[\s\S]*?(?:\1|$)|`[^`\n]*`/g;

/** Explicitly submitted composer text only. Never route captured CLI output through this helper. */
export function mentionedHandles(text: string): string[] {
  const found: string[] = [];
  for (const match of text
    .replace(codeSpans, ' ')
    .matchAll(/(^|[^\p{L}\p{N}_@.+%-])@([a-z0-9][a-z0-9_-]*)(?![\p{L}\p{N}_-])/giu)) {
    const handle = match[2]!.toLowerCase();
    if (!found.includes(handle)) found.push(handle);
  }
  return found;
}
