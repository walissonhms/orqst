import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionModelHistoryResult, SessionView } from '@orqst/protocol';
import { fetchSessionModelHistory } from './model-history';

export function ModelHistory({
  session,
  cursor,
  online,
}: {
  session: SessionView;
  cursor: number;
  online: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SessionModelHistoryResult>();
  const [failed, setFailed] = useState(false);
  const latestCursor = useRef(cursor);
  latestCursor.current = cursor;
  useEffect(() => {
    setResult(undefined);
    setFailed(false);
    if (!open || !online) return;
    let active = true;
    let controller: AbortController | undefined;
    let lastCursor: number | undefined;
    const refresh = async () => {
      if (controller || lastCursor === latestCursor.current) return;
      const readingCursor = latestCursor.current;
      const request = new AbortController();
      controller = request;
      const deadline = setTimeout(() => request.abort(), 3000);
      setResult(undefined);
      setFailed(false);
      try {
        const reading = await fetchSessionModelHistory(session.id, request.signal);
        if (reading.availability === 'available' && reading.value.adapter !== session.adapter)
          throw new Error('Invalid model history adapter');
        if (active && !request.signal.aborted) {
          lastCursor = readingCursor;
          setResult(reading);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        clearTimeout(deadline);
        controller = undefined;
      }
    };
    void refresh();
    // Snapshots never reset this clock. At most one request per five seconds,
    // only while expanded/connected; closing or changing session cancels the generation.
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
      controller?.abort();
    };
  }, [session.id, session.adapter, open, online]);
  const value = result?.availability === 'available' ? result.value : undefined;
  return (
    <details
      className="model-history"
      onToggle={(event) => {
        setResult(undefined);
        setFailed(false);
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>{t('modelHistory.title')}</summary>
      {open && (
        <>
          <p className="fine-print">{t('modelHistory.limits')}</p>
          <p className="fine-print">{t('modelHistory.timeNote')}</p>
          <p className="fine-print">{t('modelHistory.privacy')}</p>
          {!online ? (
            <p>{t('modelHistory.offline')}</p>
          ) : failed ? (
            <p role="status">{t('modelHistory.failed')}</p>
          ) : !result ? (
            <p role="status">{t('modelHistory.loading')}</p>
          ) : result.availability === 'unavailable' ? (
            <p role="status">{t(`modelHistory.unavailable.${result.reason}`)}</p>
          ) : null}
          {online && !failed && value && (
            <>
              {value.entries.every((entry) => entry.model === null) && (
                <p>{t('modelHistory.allUnrecorded')}</p>
              )}
              <ol>
                {value.entries.map((entry) => (
                  <li key={entry.sequence}>
                    <code>{entry.model ?? t('modelObservation.notRecorded')}</code>
                    <p className="fine-print">
                      {t('modelHistory.eventTime')}{' '}
                      <time dateTime={entry.normalizedEventAt}>
                        {new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en-US', {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        }).format(new Date(entry.normalizedEventAt))}
                      </time>
                    </p>
                    <p className="fine-print">
                      {t('modelHistory.provenance', { sequence: entry.sequence })}{' '}
                      <code>{entry.source.recordType}</code>
                      <br />
                      <code>{entry.source.hash}</code>
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </details>
  );
}
