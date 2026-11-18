import type { TauriStudio } from '@orqst/protocol';

type Scope = { workspaceId: string; featureId: string | null };
type Reply = Awaited<ReturnType<TauriStudio['request']>>;
const ttl = 10 * 60_000;
const maxScopes = 16;
type CacheEntry = { at: number; reply: Promise<Reply>; pending: boolean };
type CatalogCache = Map<string, CacheEntry>;
const caches = new WeakMap<TauriStudio, CatalogCache>();

/** Passive picker data only. Native generation and selected evidence still fence every Open. */
export async function loadTerminalCatalog(native: TauriStudio, scope: Scope, force = false) {
  const key = JSON.stringify([scope.workspaceId, scope.featureId]);
  const cache = caches.get(native) ?? new Map<string, CacheEntry>();
  caches.set(native, cache);
  const existing = cache.get(key);
  const now = Date.now();
  if (existing && (existing.pending || (!force && now >= existing.at && now - existing.at < ttl)))
    return existing.reply;
  const reply = native.request({ action: 'catalog', ...scope });
  const entry = { at: now, reply, pending: true };
  cache.delete(key);
  cache.set(key, entry);
  const oldest = cache.keys().next().value;
  if (cache.size > maxScopes && oldest !== undefined) cache.delete(oldest);
  try {
    const result = await reply;
    entry.pending = false;
    if (
      result.status === 'catalog' &&
      result.snapshot &&
      result.catalog.workspaceId === scope.workspaceId &&
      result.catalog.featureId === scope.featureId
    )
      return result;
    if (cache.get(key) === entry) cache.delete(key);
    return result;
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}

export function invalidateTerminalCatalog(native: TauriStudio, scope: Scope) {
  caches.get(native)?.delete(JSON.stringify([scope.workspaceId, scope.featureId]));
}
