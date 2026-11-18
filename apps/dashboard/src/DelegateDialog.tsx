import { useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import type { StudioTerminal } from './TerminalStudio';

export const providerLabels: Record<StudioTerminal['provider'], string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
  shell: 'Shell',
};

export function DelegateDialog({
  terminals,
  from: initialFrom,
  to: initialTo,
  otherFeatures,
  senders,
  onSend,
  onClose,
}: {
  terminals: StudioTerminal[];
  from?: string | null;
  to?: string;
  otherFeatures?: boolean;
  senders?: readonly string[];
  onSend: (from: string | null, to: string, text: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const searchId = useId();
  const messageId = useId();
  const sending = useRef(false);
  const [from, setFrom] = useState(initialFrom ?? null);
  const [to, setTo] = useState(initialTo ?? '');
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [outside, setOutside] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const relay = terminals.filter(
    ({ provider }) => provider !== 'antigravity' && provider !== 'shell',
  );
  const options = outside
    ? []
    : relay.filter(
        (terminal) =>
          terminal.id !== from &&
          [
            terminal.label,
            terminal.name,
            '@' + (terminal.alias ?? terminal.label),
            providerLabels[terminal.provider],
            terminal.model ?? '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      );
  const destination = options.find(({ id }) => id === to);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!destination || !text.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const failure = await onSend(from, destination.id, text.trim());
      if (failure) setError(failure);
      else onClose();
    } catch {
      setError(t('communication.refused.unavailable'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return createPortal(
    <Modal
      label={t('mention.delegate')}
      initialFocus='input[type="search"]'
      className="mc-dialog delegate-dialog"
      onClose={() => {
        if (!sending.current) onClose();
      }}
    >
      <form data-native-overlay="" onSubmit={(event) => void submit(event)}>
        <h2>{t('mention.delegate')}</h2>
        <label>
          {t('terminalStudio.mention.from')}
          <select
            value={from ?? ''}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value;
              setFrom(id || null);
              if (to === id) setTo('');
            }}
          >
            <option value="">{t('communication.owner')}</option>
            {relay
              .filter(({ id }) => !senders || senders.includes(id))
              .map((terminal) => (
                <option key={terminal.id} value={terminal.id}>
                  {terminal.label} · {terminal.name}
                </option>
              ))}
          </select>
        </label>
        <div className="delegate-picker">
          <label htmlFor={searchId}>{t('communication.to')}</label>
          {otherFeatures && (
            <button
              type="button"
              className="delegate-other"
              aria-pressed={outside}
              disabled={busy}
              onClick={() => {
                setOutside(!outside);
                setTo('');
                setError('');
              }}
            >
              {t(outside ? 'communication.thisFeature' : 'communication.otherFeature')}
            </button>
          )}
          {!outside && (
            <input
              type="search"
              id={searchId}
              value={query}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('communication.searchTerminal')}
            />
          )}
        </div>
        {outside ? (
          <p className="delegate-hint">{t('communication.crossFeatureUnavailable')}</p>
        ) : (
          <fieldset className="delegate-options" aria-label={t('communication.to')}>
            {options.map((terminal) => (
              <label key={terminal.id}>
                <input
                  type="radio"
                  name={searchId}
                  value={terminal.id}
                  checked={terminal.id === to}
                  disabled={busy}
                  onChange={() => setTo(terminal.id)}
                />
                <span>
                  <strong>{terminal.label}</strong> {terminal.name}
                  <small>
                    @{terminal.alias ?? terminal.label} · {providerLabels[terminal.provider]}
                    {terminal.model ? ' · ' + terminal.model : ''}
                  </small>
                </span>
              </label>
            ))}
            {!options.length && <p className="delegate-hint">{t('communication.noTargets')}</p>}
          </fieldset>
        )}
        {terminals.some(({ provider }) => provider === 'antigravity') && (
          <p className="delegate-hint">{t('communication.antigravity')}</p>
        )}
        <label htmlFor={messageId}>
          {t('communication.message')}
          <textarea
            id={messageId}
            rows={3}
            value={text}
            maxLength={4000}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        {destination && (
          <p className="delegate-hint">
            {t('communication.policy', { target: destination.label })}
          </p>
        )}
        {error && (
          <p role="alert" className="delegate-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!destination || !text.trim() || busy}
          >
            {t('terminalStudio.mention.send')}
          </button>
        </footer>
      </form>
    </Modal>,
    document.body,
  );
}
