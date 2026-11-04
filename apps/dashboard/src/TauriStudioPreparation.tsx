import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2, Terminal } from 'lucide-react';
import type { TauriStudio, TauriStudioRequest, TauriStudioSnapshot } from '@orqst/protocol';

/** Native setup only; the existing wizard owns paths, consent and opening. */
export function TauriStudioPreparation({ native }: { native?: TauriStudio }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TauriStudioSnapshot>();
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const request = useCallback(
    async (input: TauriStudioRequest) => {
      if (!native || inFlight.current) return;
      const token = ++sequence.current;
      if (input.action !== 'snapshot') {
        inFlight.current = true;
        setBusy(true);
        setNotice('');
      }
      try {
        const reply = await native.request(input);
        // Opening can deliberately move native focus and revoke the old generation.
        // Read current capabilities after a snapshot-less reply; never repeat the mutation.
        const current =
          input.action !== 'snapshot' && !reply.snapshot
            ? await native.request({ action: 'snapshot' })
            : reply;
        if (!active.current || sequence.current !== token) return;
        setSnapshot(current.snapshot);
        setNotice(reply.status === 'ok' ? '' : reply.status);
      } catch {
        if (active.current && sequence.current === token) setNotice('unavailable');
      } finally {
        if (input.action !== 'snapshot') inFlight.current = false;
        if (active.current && sequence.current === token) setBusy(false);
      }
    },
    [native],
  );
  useEffect(() => {
    active.current = true;
    const refresh = () => void request({ action: 'snapshot' });
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active.current = false;
      sequence.current++;
      window.removeEventListener('focus', refresh);
    };
  }, [request]);
  const disabled = busy || !snapshot || snapshot.busy;
  const stage = !snapshot
    ? 'unavailable'
    : snapshot.selectionLocked
      ? 'locked'
      : snapshot.canReview
        ? 'prepared'
        : snapshot.canCreate
          ? 'empty'
          : 'blocked';
  return (
    <>
      <div className="studio-section-title">
        <Terminal size={20} />
        <h2 id="studio-setup-title">{t('studio.setupTitle')}</h2>
        <span className="studio-state">{t(`studio.tauri.state_${stage}`)}</span>
      </div>
      <p>{t('studio.tauri.setupHelp')}</p>
      {notice && (
        <p className="notice" role="status">
          {t(notice === 'denied' ? 'studio.tauri.denied' : `studio.${notice}`)}
        </p>
      )}
      <div className="studio-members">
        <label>
          {t('studio.tauri.provider')}
          <select
            aria-label={t('studio.tauri.provider')}
            disabled={disabled || !snapshot?.canCreate}
            value={provider}
            onChange={(event) => setProvider(event.target.value === 'claude' ? 'claude' : 'codex')}
          >
            <option value="codex">{t('managedTerminal.createProvider_codex')}</option>
            <option value="claude">{t('managedTerminal.createProvider_claude')}</option>
          </select>
        </label>
        <label>
          {t('studio.tauri.count')}
          <select
            aria-label={t('studio.tauri.count')}
            disabled={disabled || !snapshot?.canCreate}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="studio-actions">
        <button
          className="button primary"
          disabled={disabled || !snapshot?.canCreate}
          onClick={() =>
            snapshot &&
            void request({ action: 'create', generation: snapshot.generation, provider, count })
          }
        >
          <FileCheck2 size={16} />
          {t('studio.tauri.prepare')}
        </button>
        <button
          className="button"
          disabled={disabled || !snapshot?.canReview}
          onClick={() =>
            snapshot && void request({ action: 'review', generation: snapshot.generation })
          }
        >
          <FileCheck2 size={16} />
          {t('studio.continueReview')}
        </button>
        <button
          className="button"
          disabled={!native || busy}
          onClick={() => void request({ action: 'snapshot' })}
        >
          {t('studio.refresh')}
        </button>
      </div>
      <p className="studio-next" role="status" aria-busy={busy || snapshot?.busy}>
        {busy
          ? t('studio.reviewing')
          : t(`studio.tauri.next_${stage}`, { count: snapshot?.count ?? 0 })}
      </p>
    </>
  );
}
