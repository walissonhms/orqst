import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BarChart3,
  FileText,
  MessagesSquare,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { defaultFeatureId, featureDisplayName, type WorkspaceFeature } from '@orqst/protocol';
import type { CoreConnection } from './AppShell';
import type { AppView } from './shell-preferences';
import { viewPath } from './navigation';
import { Modal } from './Modal';

export interface ShellWorkspace {
  id: string;
  name: string;
  count: number;
  pinned?: boolean;
}

export interface ShellFeature {
  feature: WorkspaceFeature;
  count: number;
}

export type FeatureOperation = 'create' | 'rename' | 'duplicate' | 'archive';
type FeatureEditor = { action: FeatureOperation; feature?: WorkspaceFeature };

const routeIcons = {
  overview: Activity,
  communication: MessagesSquare,
  models: BarChart3,
  artifacts: FileText,
  settings: Settings2,
} as const;

export function ShellSidebar({
  view,
  theme,
  workspaces,
  workspaceId,
  features,
  featureId,
  featureWritable,
  onWorkspace,
  onFeature,
  onEditFeature,
  featureError,
  onNavigate,
  onCreateWorkspace,
  onSearch,
  notificationControl,
  connection,
  onReconnect,
}: {
  view: AppView;
  theme: 'dark' | 'light';
  workspaces: ShellWorkspace[];
  workspaceId: string;
  features: ShellFeature[];
  featureId?: string | null;
  featureWritable: boolean;
  onWorkspace: (id: string) => void;
  onFeature: (id: string) => void;
  onEditFeature: (
    editor: FeatureEditor,
    name: string,
    description: string,
    status: WorkspaceFeature['status'],
  ) => Promise<boolean>;
  featureError: boolean;
  onNavigate: (view: AppView) => void;
  onCreateWorkspace: () => void;
  onSearch: () => void;
  notificationControl: ReactNode;
  connection: CoreConnection;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<WorkspaceFeature>();
  const [editor, setEditor] = useState<FeatureEditor>();
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState(false);
  const nameOf = (feature: WorkspaceFeature) =>
    featureDisplayName(feature, t('features.defaultName'));

  function begin(action: FeatureOperation, feature?: WorkspaceFeature) {
    setMenu(undefined);
    setEditorError(false);
    setEditor({ action, feature });
  }

  function routeLink(route: keyof typeof routeIcons) {
    const Icon = routeIcons[route];
    const label = t(`shell.views.${route}`);
    return (
      <a
        className="shell-icon"
        href={viewPath(route)}
        aria-current={
          view === route || (route === 'settings' && view === 'agents') ? 'page' : undefined
        }
        aria-label={label}
        title={label}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onNavigate(route);
        }}
      >
        <Icon size={16} aria-hidden="true" />
      </a>
    );
  }

  const createFeatureLabel = t('features.create');
  return (
    <aside id="app-sidebar" className="sidebar">
      <a
        className="shell-brand"
        href={viewPath('studio')}
        aria-current={view === 'studio' ? 'page' : undefined}
        aria-label={t('shell.views.studio')}
        title={t('shell.views.studio')}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onNavigate('studio');
        }}
      >
        <img
          className="shell-brand-logo"
          src={theme === 'dark' ? '/brand/orqst-logo-dark.svg' : '/brand/orqst-logo.svg'}
          alt={t('brand')}
        />
      </a>
      <div className="shell-tree">
        <h2 id="shell-workspaces">{t('features.workspaces')}</h2>
        <nav aria-labelledby="shell-workspaces">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className="shell-tree-row"
              title={workspace.name}
              aria-label={
                workspace.pinned
                  ? t('shell.workspaces.pinnedName', { name: workspace.name })
                  : workspace.name
              }
              aria-current={workspace.id === workspaceId || undefined}
              onClick={() => onWorkspace(workspace.id)}
            >
              <span aria-hidden="true">▣</span>
              <span className="shell-tree-name">{workspace.name}</span>
              <small>{workspace.count}</small>
            </button>
          ))}
          <button
            type="button"
            className="shell-tree-row"
            onClick={onCreateWorkspace}
            aria-label={t('createWorkspace')}
            title={t('createWorkspace')}
          >
            <Plus size={13} aria-hidden="true" />
            <span className="shell-tree-name">{t('createWorkspace')}</span>
          </button>
        </nav>
        <div className="shell-feature-heading">
          <h2 id="shell-features">{t('features.heading')}</h2>
          <button
            type="button"
            className="shell-icon"
            aria-label={createFeatureLabel}
            title={createFeatureLabel}
            disabled={!featureWritable}
            onClick={() => begin('create')}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
        <nav className="shell-feature-list" aria-labelledby="shell-features">
          {features.map(({ feature, count }) => (
            <div
              className="shell-feature-row"
              key={feature.featureId}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu(feature);
              }}
            >
              <button
                type="button"
                className="shell-tree-row"
                title={feature.description || nameOf(feature)}
                aria-label={nameOf(feature)}
                aria-current={feature.featureId === featureId || undefined}
                onClick={() => onFeature(feature.featureId)}
              >
                <span aria-hidden="true">◇</span>
                <span className="shell-tree-name">{nameOf(feature)}</span>
                <small>{count}</small>
              </button>
              <button
                type="button"
                className="shell-icon shell-feature-menu"
                aria-haspopup="dialog"
                aria-label={t('shell.frame.featureOptions', { name: nameOf(feature) })}
                onClick={() => setMenu(feature)}
              >
                ⋯
              </button>
            </div>
          ))}
          <button
            type="button"
            className="shell-tree-row"
            aria-label={createFeatureLabel}
            title={featureWritable ? createFeatureLabel : t('feature.coreRequired')}
            disabled={!featureWritable}
            onClick={() => begin('create')}
          >
            <Plus size={13} aria-hidden="true" />
            <span className="shell-tree-name">{createFeatureLabel}</span>
          </button>
          {featureError && (
            <p className="shell-tree-error" role="alert">
              {t('shell.frame.featureError')}
            </p>
          )}
        </nav>
      </div>
      <footer className="shell-side-footer">
        <nav className="shell-footer-routes" aria-label={t('analytics.navigation')}>
          {routeLink('overview')}
          {routeLink('communication')}
          {routeLink('models')}
          {routeLink('artifacts')}
          {notificationControl}
          {routeLink('settings')}
          <button
            type="button"
            className="shell-icon"
            aria-label={t('shell.palette.title')}
            title={`${t('shell.palette.shortLabel')} (⌘K)`}
            aria-keyshortcuts="Meta+K Control+K"
            aria-haspopup="dialog"
            onClick={onSearch}
          >
            <Search size={16} aria-hidden="true" />
          </button>
        </nav>
        <div className="shell-core">
          <span role="status" data-connection={connection} title={t(`shell.frame.${connection}`)}>
            <span className="shell-core-dot" aria-hidden="true" />
            <span className="shell-core-label">{t(`shell.frame.${connection}`)}</span>
          </span>
          {connection === 'offline' && (
            <button
              type="button"
              onClick={onReconnect}
              title={t('shell.frame.reconnect')}
              aria-label={t('shell.frame.reconnect')}
            >
              ↻
            </button>
          )}
        </div>
      </footer>
      {menu && (
        <Modal
          className="shell-feature-options"
          label={t('shell.frame.featureOptions', { name: nameOf(menu) })}
          onClose={() => setMenu(undefined)}
        >
          <button type="button" disabled={!featureWritable} onClick={() => begin('rename', menu)}>
            {t('shell.frame.rename')}
          </button>
          <button
            type="button"
            disabled={!featureWritable}
            onClick={() => begin('duplicate', menu)}
          >
            {t('shell.frame.duplicate')}
          </button>
          <button
            type="button"
            disabled={!featureWritable || menu.featureId === defaultFeatureId(menu.workspaceId)}
            onClick={() => begin('archive', menu)}
          >
            {t('shell.frame.archive')}
          </button>
          <button type="button" aria-disabled="true" title={t('shell.frame.removeDetail')}>
            {t('shell.frame.remove')}
          </button>
        </Modal>
      )}
      {editor && (
        <Modal
          className="shell-dialog shell-feature-editor"
          label={
            editor.action === 'create' ? createFeatureLabel : t(`shell.frame.${editor.action}`)
          }
          initialFocus={editor.action === 'archive' ? undefined : 'input'}
          onClose={() => {
            if (!saving) setEditor(undefined);
          }}
        >
          <h2>
            {editor.action === 'create' ? createFeatureLabel : t(`shell.frame.${editor.action}`)}
          </h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving || !featureWritable) return;
              const data = new FormData(event.currentTarget);
              const name = String(data.get('name') ?? '').trim();
              setSaving(true);
              setEditorError(false);
              try {
                if (
                  await onEditFeature(
                    editor,
                    name,
                    String(data.get('description') ?? ''),
                    String(data.get('status') ?? 'active') as WorkspaceFeature['status'],
                  )
                )
                  setEditor(undefined);
                else setEditorError(true);
              } finally {
                setSaving(false);
              }
            }}
          >
            {editor.action === 'archive' ? (
              <p>
                {t('shell.frame.archiveConfirm', {
                  name: editor.feature && nameOf(editor.feature),
                })}
              </p>
            ) : (
              <>
                <label>
                  {t('features.name')}
                  <input
                    name="name"
                    required
                    maxLength={48}
                    defaultValue={
                      editor.feature
                        ? editor.action === 'duplicate'
                          ? `${nameOf(editor.feature).slice(0, 46)} 2`
                          : nameOf(editor.feature)
                        : ''
                    }
                  />
                </label>
                <label>
                  {t('features.description')}
                  <textarea
                    name="description"
                    maxLength={2048}
                    defaultValue={editor.feature?.description}
                  />
                </label>
                <label>
                  {t('features.status')}
                  <select name="status" defaultValue={editor.feature?.status ?? 'active'}>
                    {['active', 'planned', 'blocked', 'completed'].map((status) => (
                      <option key={status} value={status}>
                        {t(`features.status_${status}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {editorError && <p role="alert">{t('shell.frame.featureError')}</p>}
            <div className="shell-form-actions">
              <button type="button" disabled={saving} onClick={() => setEditor(undefined)}>
                {t('features.cancel')}
              </button>
              <button type="submit" className="shell-primary" disabled={saving || !featureWritable}>
                {t('features.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </aside>
  );
}
