/** A session link selects only an identity present in the current Bridge snapshot. */
export function sessionFromHash(hash: string, sessionIds: readonly string[]): string | undefined {
  if (!hash.startsWith('#session=') || hash.length > 1810) return undefined;
  try {
    const id = decodeURIComponent(hash.slice(9));
    return id.length > 0 && id.length <= 200 && sessionIds.includes(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
