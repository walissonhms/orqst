import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeaturePreparationRequest } from '@orqst/protocol';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X } from 'lucide-react';
import { FeatureWorkspace } from './FeatureWorkspace.js';
import { TauriStudioPreparation } from './TauriStudioPreparation.js';
import { NativeTerminalCreator } from './NativeTerminalCreator.js';
import { Modal } from './Modal.js';

export interface StudioCreationScope {
  workspaceId: string;
  featureId: string | null;
  /** Display metadata from the active Feature snapshot. */
  featureName?: string;
  workspaceName?: string;
}

/** Preparation is an overlay on the retained Feature workspace. */
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
  const native =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  const [creation, setCreation] = useState<{
    scope: StudioCreationScope;
    advanced: boolean;
  }>();
  const trigger = useRef<HTMLElement | null>(null);
  const advancedPending = useRef(false);
  const advancedStarted = useRef(false);
  const handled = useRef<FeaturePreparationRequest | undefined>(undefined);
  const openPreparation = useCallback(
    (scope: StudioCreationScope) => {
      if (trigger.current) return;
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      setCreation({ scope, advanced: !native });
    },
    [native],
  );

  function closePreparation(possibleStart = false) {
    if (advancedPending.current) return;
    const opener = trigger.current;
    trigger.current = null;
    advancedStarted.current = false;
    setCreation(undefined);
    if (!possibleStart) window.dispatchEvent(new Event('orqst-terminal-creator-closed'));
    requestAnimationFrame(() => {
      if (opener?.isConnected && !trigger.current) opener.focus();
    });
  }

  useEffect(() => {
    if (!preparationRequest || handled.current === preparationRequest) return;
    // The native sender validated the source and scope. Catalog and Open independently
    // verify the current scope and native review.
    handled.current = preparationRequest;
    openPreparation(preparationRequest);
    onPreparationHandled?.();
  }, [preparationRequest, onPreparationHandled, openPreparation]);

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
      {native && creation && !creation.advanced && (
        <NativeTerminalCreator
          native={native}
          workspace={{
            id: creation.scope.workspaceId,
            name:
              creation.scope.workspaceName ??
              workspaces.find((workspace) => workspace.id === creation.scope.workspaceId)?.name ??
              t('studio.create.workspaceUnknown'),
          }}
          featureId={creation.scope.featureId}
          featureName={creation.scope.featureName}
          onAdvanced={() => setCreation({ ...creation, advanced: true })}
          onClose={closePreparation}
        />
      )}
      {creation?.advanced && (
        <Modal
          className="studio-preparation-dialog"
          label={t('studio.tauri.openTitle')}
          onClose={() => closePreparation(advancedStarted.current)}
        >
          <div className="studio-preparation-heading">
            <h2>{t('studio.tauri.openTitle')}</h2>
            <button
              className="icon-button"
              aria-label={t('close')}
              onClick={() => closePreparation(advancedStarted.current)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <section className="panel studio-setup" aria-labelledby="studio-setup-title">
            {!native && <p className="notice">{t('studio.tauri.unavailable')}</p>}
            <TauriStudioPreparation
              native={native}
              context={creation.scope}
              onReviewPending={(pending) => {
                advancedPending.current = pending;
                if (pending) advancedStarted.current = true;
              }}
            />
            <p className="studio-boundary">{t('studio.grantsHelp')}</p>
          </section>
        </Modal>
      )}
    </div>
  );
}
