import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const HeaderActionsContext = createContext<HTMLDivElement | null>(null);

/** Route-local actions occupy the shared header while their route is mounted. */
export function RouteHeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(HeaderActionsContext);
  return target ? createPortal(children, target) : null;
}

export type CoreConnection = 'connecting' | 'connected' | 'offline';

export function AppShell({
  sidebar,
  breadcrumb,
  subtitle,
  headerActions,
  connection,
  onReconnect,
  loading,
  studio,
  children,
  overlays,
}: {
  sidebar: ReactNode;
  breadcrumb: string;
  subtitle: string;
  headerActions?: ReactNode;
  connection: CoreConnection;
  onReconnect: () => void;
  loading: boolean;
  studio: boolean;
  children: ReactNode;
  overlays?: ReactNode;
}) {
  const { t } = useTranslation();
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSkeleton(true), 200);
    return () => window.clearTimeout(timer);
  }, [loading]);

  return (
    <div className={`app-shell${studio ? ' studio-shell' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {t('shell.skip')}
      </a>
      {sidebar}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span aria-hidden="true">◈</span>
            <strong title={breadcrumb}>{breadcrumb}</strong>
            <span className="shell-subtitle" aria-hidden="true">
              ·
            </span>
            <span className="shell-subtitle">{subtitle}</span>
          </div>
          <div className="topbar-actions" ref={setActionsTarget}>
            {headerActions}
          </div>
        </header>
        {connection === 'offline' && (
          <div className="shell-offline" role="status">
            <span>{t('shell.frame.disconnected')}</span>
            <button type="button" onClick={onReconnect}>
              {t('shell.frame.retry')}
            </button>
          </div>
        )}
        <HeaderActionsContext.Provider value={actionsTarget}>
          <main id="main-content" tabIndex={-1} aria-busy={loading || undefined}>
            {loading && showSkeleton && (
              <div className="shell-skeleton" role="status" aria-label={t('shell.loading')}>
                <div />
                <div />
                <div />
              </div>
            )}
            {children}
          </main>
        </HeaderActionsContext.Provider>
      </div>
      {overlays}
    </div>
  );
}
