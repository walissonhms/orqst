import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Folder, Grid2X2, List, Pin, Plus, Search } from 'lucide-react';
import type { Snapshot } from '@orqst/protocol';
import type { ShellPreferences } from './shell-preferences';
import { maxWorkspacePins, type useWorkspacePins } from './workspace-pins';

export function Workspaces({
  snapshot,
  activeId,
  layout,
  sort,
  onLayout,
  onSort,
  onOpen,
  onAnalytics,
  onCreate,
  pins,
}: {
  snapshot: Snapshot;
  pins: ReturnType<typeof useWorkspacePins>;
  activeId: string;
  layout: ShellPreferences['workspaceLayout'];
  sort: ShellPreferences['workspaceSort'];
  onLayout: (value: ShellPreferences['workspaceLayout']) => void;
  onSort: (value: ShellPreferences['workspaceSort']) => void;
  onOpen: (id: string) => void;
  onAnalytics: (id: string) => void;
  onCreate: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const pinFilter = useRef<HTMLButtonElement>(null);
  const locale = i18n.resolvedLanguage ?? 'en-US';
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const records = snapshot.workspaces
    .map((workspace) => {
      const sessions = snapshot.sessions.filter((session) => session.workspaceId === workspace.id);
      const lastActivity = sessions.reduce(
        (latest, session) => Math.max(latest, Date.parse(session.lastActivity)),
        0,
      );
      return { workspace, sessions, lastActivity };
    })
    .filter(({ workspace }) => !pinnedOnly || pins.pins.includes(workspace.id))
    .filter(({ workspace }) =>
      `${workspace.name} ${workspace.path}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(pins.pins.includes(b.workspace.id)) - Number(pins.pins.includes(a.workspace.id)) ||
        (sort === 'recent' ? b.lastActivity - a.lastActivity : 0) ||
        a.workspace.name.localeCompare(b.workspace.name, locale),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t('readOnly')}</span>
          <h1>{t('shell.views.workspaces')}</h1>
          <p>{t('shell.workspaces.description')}</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} />
          {t('createWorkspace')}
        </button>
      </div>
      <section className="panel workspace-directory" aria-label={t('shell.views.workspaces')}>
        <div className="panel-heading workspace-controls">
          <label className="search-box">
            <Search size={15} />
            <input
              aria-label={t('shell.workspaces.search')}
              placeholder={t('shell.workspaces.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            ref={pinFilter}
            className="button workspace-pin-filter"
            aria-pressed={pinnedOnly}
            onClick={() => setPinnedOnly((value) => !value)}
          >
            <Pin size={15} aria-hidden="true" />
            {t('shell.workspaces.pinnedOnly')}
          </button>
          <button
            className="text-button"
            disabled={!pins.pins.length}
            onClick={() => {
              pins.clearPins();
              setAnnouncement(t('shell.workspaces.clearedPins'));
              pinFilter.current?.focus();
            }}
          >
            {t('shell.workspaces.clearPins')}
          </button>
          <label className="workspace-sort">
            {t('shell.workspaces.sort')}
            <select
              value={sort}
              onChange={(event) => onSort(event.target.value === 'name' ? 'name' : 'recent')}
            >
              <option value="recent">{t('shell.workspaces.recent')}</option>
              <option value="name">{t('workspaceName')}</option>
            </select>
          </label>
          <div className="workspace-layout" role="group" aria-label={t('shell.workspaces.layout')}>
            <button
              className="icon-button"
              aria-label={t('shell.workspaces.grid')}
              aria-pressed={layout === 'grid'}
              onClick={() => onLayout('grid')}
            >
              <Grid2X2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={t('shell.workspaces.list')}
              aria-pressed={layout === 'list'}
              onClick={() => onLayout('list')}
            >
              <List size={17} />
            </button>
          </div>
        </div>
        <p className="panel-footer">{t('shell.workspaces.pinScope')}</p>
        {pins.storageUnavailable && (
          <p className="panel-footer" role="status">
            {t('shell.workspaces.pinStorageUnavailable')}
          </p>
        )}
        {pins.pins.length >= maxWorkspacePins && (
          <p className="panel-footer">
            {t('shell.workspaces.pinLimit', { count: maxWorkspacePins })}
          </p>
        )}
        <p className="sr-only" role="status">
          {announcement}
        </p>
        <div className={`workspace-cards workspace-${layout}`}>
          {records.map(({ workspace, sessions, lastActivity }) => (
            <article
              className={`workspace-card ${activeId === workspace.id ? 'workspace-current' : ''}`}
              key={workspace.id}
            >
              <div className="workspace-card-heading">
                <Folder size={20} />
                <h2>{workspace.name}</h2>
                <button
                  className="icon-button workspace-pin"
                  aria-label={t('shell.workspaces.pin', { name: workspace.name })}
                  title={t(
                    pins.pins.includes(workspace.id)
                      ? 'shell.workspaces.unpin'
                      : 'shell.workspaces.pin',
                    { name: workspace.name },
                  )}
                  aria-pressed={pins.pins.includes(workspace.id)}
                  disabled={
                    !pins.pins.includes(workspace.id) && pins.pins.length >= maxWorkspacePins
                  }
                  onClick={() => {
                    const wasPinned = pins.pins.includes(workspace.id);
                    pins.togglePin(workspace.id);
                    setAnnouncement(
                      t(wasPinned ? 'shell.workspaces.unpinned' : 'shell.workspaces.pinned', {
                        name: workspace.name,
                      }),
                    );
                    if (pinnedOnly && wasPinned) pinFilter.current?.focus();
                  }}
                >
                  <Pin
                    size={17}
                    aria-hidden="true"
                    fill={pins.pins.includes(workspace.id) ? 'currentColor' : 'none'}
                  />
                </button>
                {activeId === workspace.id && (
                  <span className="subtle-label">{t('activeWorkspace')}</span>
                )}
              </div>
              <code className="workspace-path">{workspace.path}</code>
              <dl>
                <div>
                  <dt>{t('sessions')}</dt>
                  <dd>{number.format(sessions.length)}</dd>
                </div>
                <div>
                  <dt>{t('attention')}</dt>
                  <dd>
                    {number.format(
                      sessions.filter((session) =>
                        ['waiting_for_user', 'failed'].includes(session.status),
                      ).length,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('lastActivity')}</dt>
                  <dd>
                    {lastActivity ? (
                      <time dateTime={new Date(lastActivity).toISOString()}>
                        {date.format(lastActivity)}
                      </time>
                    ) : (
                      t('unknown')
                    )}
                  </dd>
                </div>
              </dl>
              <div className="workspace-card-actions">
                <button className="button" onClick={() => onOpen(workspace.id)}>
                  {t('shell.workspaces.open')}
                  <ArrowUpRight size={14} />
                </button>
                <button className="text-button" onClick={() => onAnalytics(workspace.id)}>
                  {t('analytics.title')}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!records.length && (
          <p className="empty-copy">
            {t(
              pinnedOnly
                ? 'shell.workspaces.noPinnedMatches'
                : snapshot.workspaces.length
                  ? 'shell.workspaces.noMatches'
                  : 'shell.workspaces.empty',
            )}
          </p>
        )}
        {pinnedOnly && !records.length && (
          <button
            className="button workspace-pin-recovery"
            onClick={() => {
              setPinnedOnly(false);
              setQuery('');
              pinFilter.current?.focus();
            }}
          >
            {t('allWorkspaces')}
          </button>
        )}
        <p className="panel-footer">{t('shell.workspaces.localNote')}</p>
      </section>
    </>
  );
}
