/** Explicit allowlist of native pane requests. View-only actions never carry a signal. */
export type PaneActionRequest =
  { action: 'attach' | 'input' | 'detach' } | { action: 'stop'; signal: 'SIGTERM' | 'SIGKILL' };

export function paneActionRequest(action: string): PaneActionRequest | undefined {
  if (action === 'attach') return { action: 'attach' };
  if (action === 'input') return { action: 'input' };
  if (action === 'detach') return { action: 'detach' };
  if (action === 'stop') return { action: 'stop', signal: 'SIGTERM' };
  if (action === 'kill') return { action: 'stop', signal: 'SIGKILL' };
  // Hide is layout-only and produces no native process request.
  return undefined;
}

/** Profile actions are handled before the instance allowlist; keep them explicit too. */
export function profileAction(
  action: string,
  operationalOpen: boolean,
): { action: 'open' | 'start'; login?: true } | undefined {
  // The protocol has no "login" action: it starts the reviewed login profile.
  if (action === 'login') return { action: 'start', login: true };
  if (action === 'start') return { action: operationalOpen ? 'open' : 'start' };
  return undefined;
}
