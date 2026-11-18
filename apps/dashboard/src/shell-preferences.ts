import { dashboardViewSchema, type DashboardView } from '@orqst/protocol';

export const appViews = [
  'studio',
  'overview',
  'communication',
  'models',
  'artifacts',
  'settings',
] as const;
export type AppView = DashboardView;
export interface ShellPreferences {
  view: AppView;
  workspaceId: string;
  managedWorkspaceId: string;
  managedFeatureId: string;
  status: string;
  workspaceLayout: 'grid' | 'list';
  workspaceSort: 'recent' | 'name';
}
export const shellStorageKey = 'orqst.shell.v1';
export const defaultShellPreferences: ShellPreferences = {
  view: 'studio',
  workspaceId: '',
  managedWorkspaceId: '',
  managedFeatureId: '',
  status: '',
  workspaceLayout: 'grid',
  workspaceSort: 'recent',
};
export function viewFromHash(hash: string): AppView | undefined {
  return dashboardViewSchema.options.find((view) => hash === `#${view}`);
}
export function parseShellPreferences(value: string | null): ShellPreferences {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultShellPreferences;
    const record = data as Record<string, unknown>;
    return {
      view: dashboardViewSchema.options.find((view) => view === record.view) ?? 'studio',
      workspaceId:
        typeof record.workspaceId === 'string' && record.workspaceId.length <= 200
          ? record.workspaceId
          : '',
      managedWorkspaceId:
        typeof record.managedWorkspaceId === 'string' && record.managedWorkspaceId.length <= 200
          ? record.managedWorkspaceId
          : '',
      managedFeatureId:
        typeof record.managedFeatureId === 'string' && record.managedFeatureId.length <= 36
          ? record.managedFeatureId
          : '',
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
