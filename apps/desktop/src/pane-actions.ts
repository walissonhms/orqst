/** Explicit pane action mapping: view-only actions never carry a process signal. */
export type PaneActionRequest =
  { action: 'detach' } | { action: 'stop'; signal: 'SIGTERM' | 'SIGKILL' };

export function paneActionRequest(action: string): PaneActionRequest | undefined {
  // Hide is a layout-only action and never becomes a native process request.
  if (action === 'hide-pane' || action === 'hide') return undefined;
  if (action === 'detach') return { action: 'detach' };
  if (action === 'stop') return { action: 'stop', signal: 'SIGTERM' };
  if (action === 'kill') return { action: 'stop', signal: 'SIGKILL' };
  return undefined;
}
