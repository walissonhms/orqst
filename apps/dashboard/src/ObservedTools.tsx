import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredEvent } from '@orqst/protocol';
import { observedToolLimits, observedTools, toolDisplayText } from './observed-tools';

function EvidenceText({
  value,
  limit,
  reading = false,
}: {
  value: string;
  limit?: number;
  reading?: boolean;
}) {
  const { t } = useTranslation();
  const display = toolDisplayText(value, limit);
  return (
    <>
      <pre dir="ltr" className={reading ? 'reading-content' : undefined}>
        {display.text}
      </pre>
      {display.truncated && <p className="fine-print">{t('observedTools.truncated')}</p>}
    </>
  );
}

export function ObservedTools({
  events,
  sessionId,
  online,
  failed,
  hasOlder,
  onOlder,
}: {
  events: StoredEvent[];
  sessionId: string;
  online: boolean;
  failed: boolean;
  hasOlder: boolean;
  onOlder: () => void;
}) {
  const { t } = useTranslation();
  const projection = useMemo(() => observedTools(events, sessionId), [events, sessionId]);
  return (
    <section className="observed-tools" aria-label={t('observedTools.title')}>
      <h3>{t('observedTools.title')}</h3>
      <p className="fine-print">{t('observedTools.boundary')}</p>
      <p className="fine-print">{t('observedTools.coverage', observedToolLimits)}</p>
      <p className="fine-print">{t('observedTools.controls')}</p>
      {!online && <p role="status">{t('observedTools.offline')}</p>}
      {failed && <p role="status">{t('observedTools.failed')}</p>}
      {projection.limited && <p role="status">{t('observedTools.limited')}</p>}
      {projection.invalid && <p role="status">{t('observedTools.invalid')}</p>}
      {!projection.groups.length && <p>{t('observedTools.empty')}</p>}
      {projection.groups.map((group) => (
        <article key={group.records[0]!.id}>
          <h4>{t(group.paired ? 'observedTools.paired' : 'observedTools.unpaired')}</h4>
          {group.records.map((event) => (
            <div className="observed-tool-record" key={event.id}>
              <p>
                {t(
                  event.type === 'agent.tool.started'
                    ? 'observedTools.invocation'
                    : 'observedTools.output',
                )}{' '}
                <time dateTime={event.timestamp}>{event.timestamp}</time>
              </p>
              {event.payload.name !== undefined && (
                <EvidenceText value={event.payload.name} limit={200} />
              )}
              {!event.payload.text ? (
                <p>{t('observedTools.noText')}</p>
              ) : (
                <EvidenceText value={event.payload.text} reading />
              )}
              <details className="source-detail">
                <summary>{t('source')}</summary>
                <p>{t('observedTools.sourceNote', { sequence: event.sequence })}</p>
                <EvidenceText value={event.source.file} limit={500} />
                <p>
                  {t('observedTools.position', {
                    line: event.source.line,
                    offset: event.source.offset,
                  })}
                </p>
                <EvidenceText value={event.source.recordType} limit={100} />
                <EvidenceText value={event.source.hash} limit={128} />
                <p>{t('correlation')}</p>
                <EvidenceText
                  value={JSON.stringify({
                    turnId: event.correlation.turnId ?? null,
                    callId: event.correlation.callId ?? null,
                  })}
                  limit={500}
                />
              </details>
            </div>
          ))}
        </article>
      ))}
      {hasOlder && !projection.limited && (
        <button className="button history-button" onClick={onOlder}>
          {t('loadMore')}
        </button>
      )}
    </section>
  );
}
