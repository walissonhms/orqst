export const offlineURL = 'orqst-desktop://offline/';

/** A port, rather than an arbitrary URL, keeps the trust boundary on IPv4 loopback. */
export function bridgeOrigin(value: string | undefined): string {
  const port = value === undefined ? 4317 : Number(value);
  if (
    (value !== undefined && !/^\d+$/.test(value)) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error('ORQST_DESKTOP_PORT must be an integer from 1024 to 65535');
  return `http://127.0.0.1:${port}`;
}

export function allowedNavigation(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return (
      value === offlineURL ||
      (url.origin === origin &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search)
    );
  } catch {
    return false;
  }
}

export function allowedRequest(value: string, origin: string, resourceType: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (value === offlineURL) return resourceType === 'mainFrame';
    if (url.protocol === 'data:') return resourceType === 'image';
    if (resourceType === 'subFrame') return false;
    if (resourceType === 'mainFrame') return allowedNavigation(value, origin);
    if (url.origin === origin) return true;
    return (
      resourceType === 'webSocket' &&
      url.origin === origin.replace('http:', 'ws:') &&
      url.pathname === '/ws'
    );
  } catch {
    return false;
  }
}

export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[character]!;
  });
}
