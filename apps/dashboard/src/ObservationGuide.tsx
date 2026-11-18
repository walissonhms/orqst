import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { CliDiscovery } from './Agents';

const onboardedKey = 'orqst.onboarding.v1';

export function needsOnboarding() {
  try {
    return localStorage.getItem(onboardedKey) !== 'done';
  } catch {
    return true;
  }
}

export function ObservationGuide({
  canCreateWorkspace,
  workspaceName,
  onStart,
  onClose,
}: {
  canCreateWorkspace: boolean;
  workspaceName?: string;
  onStart: (path: string | undefined, skip: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function finish(folder?: string, skip = false) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onStart(folder, skip);
      try {
        localStorage.setItem(onboardedKey, 'done');
      } catch {
        // The current run can still continue to Studio.
      }
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canCreateWorkspace && path.trim()) void finish(path.trim());
    else if (workspaceName) void finish();
  }
  return (
    <Modal
      label={t('screens.onboarding.title')}
      className="spec-onboarding shell-dialog"
      initialFocus=".spec-onboarding-title"
      onClose={() => void finish(undefined, true)}
    >
      <form className="spec-screen" onSubmit={submit}>
        <h1 className="spec-onboarding-title" tabIndex={-1}>
          {t('screens.onboarding.title')}
        </h1>
        <section className="spec-panel">
          <h2>{t('screens.onboarding.detected')}</h2>
          <CliDiscovery />
        </section>
        <label className="spec-field">
          {t('screens.onboarding.folder')}
          <input
            value={path}
            maxLength={4096}
            onChange={(event) => setPath(event.target.value)}
            disabled={!canCreateWorkspace || busy}
            placeholder={canCreateWorkspace ? undefined : (workspaceName ?? '—')}
          />
        </label>
        {failed && <p role="alert">{t('screens.onboarding.failed')}</p>}
        <div className="spec-actions">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => void finish(undefined, true)}
          >
            {t('screens.onboarding.skip')}
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || (!workspaceName && (!canCreateWorkspace || !path.trim()))}
          >
            {t('screens.onboarding.start')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
