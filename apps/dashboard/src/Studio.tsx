import { FeatureWorkspace } from './FeatureWorkspace.js';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Columns2, FileCheck2, FolderOpen, ShieldCheck, Terminal } from 'lucide-react';
import type { StudioRequest, StudioSnapshot } from '@orqst/protocol';

/** Navigation/preparation only. All choices and grants stay in the existing native flow. */
export function Studio({ preparationOnly = false }: { preparationOnly?: boolean }) {
  const { t } = useTranslation();
  const native = window.orqstStudio?.contractVersion === 1 ? window.orqstStudio : undefined;
  const desktop = !!window.orqstManagedAgents || navigator.userAgent.includes(' ORQSTDesktop/0.1');
  const [snapshot, setSnapshot] = useState<StudioSnapshot>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!native) return;
    let active = true;
    void native
      .request({ action: 'snapshot' })
      .then((reply) => {
        if (!active) return;
        if (reply.snapshot) setSnapshot(reply.snapshot);
        else setNotice(reply.status === 'ok' ? 'unavailable' : reply.status);
      })
      .catch(() => {
        if (active) setNotice('unavailable');
      });
    return () => {
      active = false;
    };
  }, [native]);
  async function request(action: StudioRequest['action']) {
    if (!native || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const reply = await native.request({ action });
      if (reply.snapshot) setSnapshot(reply.snapshot);
      if (reply.status !== 'ok') setNotice(reply.status);
    } catch {
      setNotice('unavailable');
    } finally {
      setBusy(false);
    }
  }
  const disabled = !native || !snapshot || busy || snapshot.busy;
  const stage = !snapshot
    ? 'unavailable'
    : snapshot.opened
      ? 'opened'
      : snapshot.count
        ? 'reviewed'
        : snapshot.prepared
          ? 'prepared'
          : snapshot.canCreate
            ? 'empty'
            : 'blocked';
  return (
    <section className="studio-page" aria-labelledby="studio-title">
      {!preparationOnly && window.orqstFeatures && <FeatureWorkspace />}
      <header className="studio-heading">
        <div>
          <p className="studio-eyebrow">{t('studio.eyebrow')}</p>
          <h1 id="studio-title">{t('shell.views.studio')}</h1>
          <p>{t('studio.intro')}</p>
        </div>
        <span className="studio-scope">
          <ShieldCheck size={16} />
          {t('studio.local')}
        </span>
      </header>
      {!native && (
        <p className="notice" role="status">
          {t(desktop ? 'studio.oldDesktop' : 'studio.desktopOnly')}
          {import.meta.env.DEV && !desktop && (
            <>
              {' '}
              <a href="/preview/terminals.html">{t('studio.layoutPreview')}</a>
            </>
          )}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t(`studio.${notice}`)}
        </p>
      )}
      <div className="studio-workbench">
        <section
          className="panel studio-setup"
          aria-labelledby="studio-setup-title"
          aria-busy={busy}
        >
          <div className="studio-section-title">
            <Terminal size={20} />
            <h2 id="studio-setup-title">{t('studio.setupTitle')}</h2>
            <span className="studio-state">{t(`studio.state_${stage}`)}</span>
          </div>
          <p>{t('studio.setupHelp')}</p>
          <div className="studio-members" aria-label={t('studio.preset')}>
            <div>
              <span className="studio-slot">A</span>
              <div>
                <strong>Codex</strong>
                <small>{t('studio.providerCandidate')}</small>
              </div>
            </div>
            <ArrowRight size={18} aria-hidden="true" />
            <div>
              <span className="studio-slot">B</span>
              <div>
                <strong>OpenCode</strong>
                <small>{t('studio.providerCandidate')}</small>
              </div>
            </div>
          </div>
          <div className="studio-actions">
            {snapshot?.prepared && !snapshot.count && (
              <button
                className="button primary"
                disabled={disabled || !snapshot.canSelect}
                onClick={() => void request('resumeReview')}
              >
                <FileCheck2 size={16} />
                {t('studio.continueReview')}
              </button>
            )}

            <button
              className={`button ${snapshot?.count || snapshot?.prepared ? '' : 'primary'}`}
              disabled={disabled || !snapshot?.canCreate || snapshot.limit < 2}
              onClick={() => void request('createMixed')}
            >
              <FileCheck2 size={16} />
              {t('studio.prepareMixed')}
            </button>
            <button
              className="button"
              disabled={disabled || !snapshot?.count || (!snapshot.opened && !snapshot.canSelect)}
              onClick={() => void request('open')}
            >
              <Columns2 size={16} />
              {t(snapshot?.opened ? 'studio.return' : 'studio.open')}
            </button>
          </div>
          <p className="studio-next" role="status">
            {busy
              ? t('studio.reviewing')
              : t(`studio.next_${stage}`, { count: snapshot?.count ?? 0 })}
          </p>
          {snapshot && snapshot.limit < 2 && <p className="notice">{t('studio.capacityOne')}</p>}
          <details className="studio-advanced">
            <summary>{t('studio.otherOptions')}</summary>
            <div className="studio-actions">
              <button
                className="button"
                disabled={disabled || !snapshot?.canCreate}
                onClick={() => void request('create')}
              >
                {t('studio.createOther')}
              </button>
              <button
                className="button"
                disabled={disabled || !snapshot?.canSelect}
                onClick={() => void request('select')}
              >
                <FolderOpen size={16} />
                {t('studio.select')}
              </button>
              <button
                className="button"
                disabled={!native || busy}
                onClick={() => void request('snapshot')}
              >
                {t('studio.refresh')}
              </button>
            </div>
            <p>{t('studio.advancedHelp')}</p>
          </details>
        </section>
        <aside className="panel studio-guide" aria-labelledby="studio-guide-title">
          <h2 id="studio-guide-title">{t('studio.guideTitle')}</h2>
          <ol>
            {['prepare', 'open', 'start'].map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <div>
                  <strong>{t(`studio.step_${step}`)}</strong>
                  <p>{t(`studio.step_${step}_help`)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="studio-boundary">{t('studio.boundary')}</p>
        </aside>
      </div>
      <section className="studio-capabilities" aria-label={t('studio.capabilities')}>
        <p>
          <Columns2 size={18} />
          <span>
            <strong>{t('studio.layoutTitle')}</strong>
            {t('studio.layoutHelp')}
          </span>
        </p>
        <p>
          <ShieldCheck size={18} />
          <span>
            <strong>{t('studio.grantsTitle')}</strong>
            {t('studio.grantsHelp')}
          </span>
        </p>
      </section>
    </section>
  );
}
