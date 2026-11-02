import { createHash } from 'node:crypto';
export function stableId(...parts: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED]',
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(
      /(["']?(?:[A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?token|token|secret|password)|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
}
export function safeText(value: unknown, limit = 32000): string | undefined {
  if (typeof value === 'string') return redact(value).slice(0, limit);
  if (Array.isArray(value))
    return (
      value
        .map((item) =>
          item && typeof item === 'object' && 'text' in item
            ? (safeText(item.text, limit) ?? '')
            : '',
        )
        .filter(Boolean)
        .join('\n')
        .slice(0, limit) || undefined
    );
  return undefined;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
