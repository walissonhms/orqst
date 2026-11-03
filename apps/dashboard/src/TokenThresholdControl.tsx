import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function TokenThresholdControl({
  onChange,
}: {
  onChange: (value: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (invalid) input.current?.focus();
  }, [invalid]);
  return (
    <details className="live-token-threshold-control">
      <summary>{t('liveMetrics.threshold.configure')}</summary>
      <p className="fine-print" id={`${id}-help`}>
        {t('liveMetrics.threshold.help')}
      </p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(draft);
          if (!/^[0-9]{1,16}$/.test(draft) || !Number.isSafeInteger(value) || value < 1) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          setDraft(String(value));
          onChange(value);
        }}
      >
        <label htmlFor={id}>{t('liveMetrics.threshold.label')}</label>
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="numeric"
          maxLength={16}
          value={draft}
          aria-invalid={invalid}
          aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
        />
        <button className="button" type="submit">
          {t('liveMetrics.threshold.apply')}
        </button>
        <button
          className="button"
          type="button"
          onClick={() => {
            setDraft('');
            setInvalid(false);
            onChange(undefined);
          }}
        >
          {t('liveMetrics.threshold.clear')}
        </button>
      </form>
      {invalid && (
        <p className="notice" id={`${id}-error`}>
          {t('liveMetrics.threshold.invalid')}
        </p>
      )}
    </details>
  );
}
