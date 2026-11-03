import { dashboardSessionPathSchema, dashboardViewSchema } from '@orqst/protocol';

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

export function isSessionLocation(location: Pick<Location, 'pathname' | 'hash'>): boolean {
  if (dashboardViewSchema.options.some((view) => location.hash === `#${view}`)) return false;
  return (
    location.hash.startsWith('#session=') ||
    dashboardSessionPathSchema.safeParse(location.pathname).success
  );
}

export function sessionFromLocation(
  location: Pick<Location, 'pathname' | 'hash'>,
  sessionIds: readonly string[],
): string | undefined {
  // Recognized legacy hashes take precedence, preserving old same-document links.
  if (location.hash.startsWith('#session=')) return sessionFromHash(location.hash, sessionIds);
  if (dashboardViewSchema.options.some((view) => location.hash === `#${view}`)) return undefined;
  if (!dashboardSessionPathSchema.safeParse(location.pathname).success) return undefined;
  const id = decodeURIComponent(location.pathname.slice('/overview/sessions/'.length));
  return sessionIds.includes(id) ? id : undefined;
}
