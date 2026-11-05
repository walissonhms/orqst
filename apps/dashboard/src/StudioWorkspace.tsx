import { useEffect, useRef, useState } from 'react';
import type { FeaturePreparationRequest } from '@orqst/protocol';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X } from 'lucide-react';
import { FeatureWorkspace } from './FeatureWorkspace.js';
import { TauriStudioPreparation } from './TauriStudioPreparation.js';

/** One viewport shell; preparation never replaces or remounts the workspace. */
export function StudioWorkspace({
  onOverview,
  preparationRequest,
  onPreparationHandled,
  workspaces = [],
  workspaceId = '',
  onWorkspace,
}: {
  onOverview: () => void;
  preparationRequest?: FeaturePreparationRequest;
  onPreparationHandled?: () => void;
  workspaces?: ReadonlyArray<{ id: string; name: string }>;
  workspaceId?: string;
  onWorkspace?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const preparation = useRef<HTMLDialogElement>(null);
  const [visited, setVisited] = useState(false);
  const [context, setContext] = useState<{ workspaceId: string; featureId: string | null }>({
    workspaceId,
    featureId: null,
  });
  const native =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  function openPreparation(scope: { workspaceId: string; featureId: string | null }) {
    setContext(scope);
    setVisited(true);
    preparation.current?.showModal();
  }
  useEffect(() => {
    if (!preparationRequest) return;
    // The native sender already checked exact source/document, current scope and focus.
    // Catalog and Open still perform their independent current-scope/native review checks.
    openPreparation(preparationRequest);
    onPreparationHandled?.();
  }, [preparationRequest, onPreparationHandled]);
  return (
    <div className="studio-workspace">
      <FeatureWorkspace
        workspaces={workspaces}
        workspaceId={workspaceId}
        onWorkspace={onWorkspace}
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
          <h2 id="studio-preparation-title">{t('studio.tauri.openTitle')}</h2>
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
            <TauriStudioPreparation native={native} context={context} />
            <p className="studio-boundary">{t('studio.grantsHelp')}</p>
          </section>
        )}
      </dialog>
    </div>
  );
}
