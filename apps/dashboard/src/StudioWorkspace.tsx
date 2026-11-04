import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X } from 'lucide-react';
import { FeatureWorkspace } from './FeatureWorkspace.js';
import { TauriStudioPreparation } from './TauriStudioPreparation.js';

/** One viewport shell; preparation never replaces or remounts the workspace. */
export function StudioWorkspace({ onOverview }: { onOverview: () => void }) {
  const { t } = useTranslation();
  const preparation = useRef<HTMLDialogElement>(null);
  const [visited, setVisited] = useState(false);
  const native =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  function openPreparation() {
    setVisited(true);
    preparation.current?.showModal();
  }
  return (
    <div className="studio-workspace">
      <FeatureWorkspace
        navigation={
          <button
            className="studio-overview"
            aria-label={t('shell.views.overview')}
            title={t('shell.views.overview')}
            onClick={onOverview}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        }
        onPrepare={openPreparation}
      />
      <dialog
        className="studio-preparation-dialog"
        ref={preparation}
        aria-labelledby="studio-preparation-title"
      >
        <div className="studio-preparation-heading">
          <h2 id="studio-preparation-title">{t('studio.setupTitle')}</h2>
          <button
            className="icon-button"
            aria-label={t('close')}
            onClick={() => preparation.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {visited && (
          <section className="panel studio-setup" aria-labelledby="studio-setup-title">
            {!native && <p className="notice">{t('studio.tauri.unavailable')}</p>}
            <TauriStudioPreparation native={native} />
            <p className="studio-boundary">{t('studio.grantsHelp')}</p>
          </section>
        )}
      </dialog>
    </div>
  );
}
