import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X } from 'lucide-react';
import { FeatureWorkspace } from './FeatureWorkspace.js';
import { Studio } from './Studio.js';

/** One viewport shell; preparation never replaces or remounts the workspace. */
export function StudioWorkspace({ onOverview }: { onOverview: () => void }) {
  const { t } = useTranslation();
  const preparation = useRef<HTMLDialogElement>(null);
  function openPreparation() {
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
        <Studio preparationOnly />
      </dialog>
    </div>
  );
}
