export const appViews = ['overview', 'workspaces', 'agents', 'models'] as const;
export type AppView = (typeof appViews)[number];
export interface ShellPreferences {
  view: AppView;
  workspaceId: string;
  collapsed: boolean;
  status: string;
  workspaceLayout: 'grid' | 'list';
  workspaceSort: 'recent' | 'name';
}
export const shellStorageKey = 'orqst.shell.v1';
export const defaultShellPreferences: ShellPreferences = {
  view: 'overview',
  workspaceId: '',
  collapsed: false,
  status: '',
  workspaceLayout: 'grid',
  workspaceSort: 'recent',
};
export function viewFromHash(hash: string): AppView | undefined {
  return appViews.find((view) => hash === `#${view}`);
}
export function parseShellPreferences(value: string | null): ShellPreferences {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultShellPreferences;
    const record = data as Record<string, unknown>;
    return {
      view: appViews.find((view) => view === record.view) ?? 'overview',
      workspaceId:
        typeof record.workspaceId === 'string' && record.workspaceId.length <= 200
          ? record.workspaceId
          : '',
      collapsed: record.collapsed === true,
      status:
        typeof record.status === 'string' &&
        ['running', 'waiting_for_user', 'completed', 'failed', 'interrupted', 'unknown'].includes(
          record.status,
        )
          ? record.status
          : '',
      workspaceLayout: record.workspaceLayout === 'list' ? 'list' : 'grid',
      workspaceSort: record.workspaceSort === 'name' ? 'name' : 'recent',
    };
  } catch {
    return defaultShellPreferences;
  }
}
export function readShellPreferences(): ShellPreferences {
  try {
    return parseShellPreferences(localStorage.getItem(shellStorageKey));
  } catch {
    return defaultShellPreferences;
  }
}
