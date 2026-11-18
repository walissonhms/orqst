import type { StructuredAgentsScope, StructuredSession } from './structured-agents.js';

type Identity = Pick<StructuredSession, 'sessionId' | 'label' | 'workspaceId' | 'featureId'>;

/** Resolve a single address against Feature-local identities, including unavailable sessions. */
export function resolveStructuredHandle(
  scope: StructuredAgentsScope,
  sessions: readonly Identity[],
  handle: string,
): string | undefined {
  const text = handle.trim();
  if (!/^@[a-z0-9][a-z0-9_-]{0,63}$/i.test(text)) return;
  const name = text.slice(1).toLowerCase();
  const local = sessions.filter(
    (session) => session.workspaceId === scope.workspaceId && session.featureId === scope.featureId,
  );
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name))
    return local.find((session) => session.sessionId === name)?.sessionId;
  const matches = local.filter((session) => session.label.toLowerCase() === name);
  if (matches.length === 1) return matches[0]!.sessionId;
}
