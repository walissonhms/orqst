import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EndedTerminalList } from './EndedTerminalList.js';
import type { EndedTerminal } from './terminal-lifecycle.js';

interface Props {
  members: readonly {
    id: string;
    closed: boolean;
    confirmedExit?: boolean;
    displayId?: string;
    provider?: EndedTerminal['provider'];
  }[];
  onReopen?: () => void;
}

/** Presentation only. A saved ID conveys no authority or proof of process state. */
export function SavedTerminalList({ members, onReopen }: Props) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [inspected, setInspected] = useState<string>();
  const visible = members.filter(({ id }) => !hidden.has(id));
  const hiddenCount = members.length - visible.length;
  if (!members.length) return null;
  return (
    <section className="saved-terminal-list" aria-label={t('features.savedTerminals.title')}>
      <p>{t('features.savedTerminals.title')}</p>
      {visible.length > 0 && (
        <>
          <EndedTerminalList
            terminals={visible.map(({ id, confirmedExit, displayId, provider }) => ({
              terminalId: id,
              displayId,
              provider,
              disposition: confirmedExit ? 'exit_confirmed' : 'uncertain',
            }))}
            onInspect={({ terminalId }) => setInspected(terminalId)}
            onHide={({ terminalId }) => {
              setHidden((ids) => new Set([...ids, terminalId]));
              if (inspected === terminalId) setInspected(undefined);
            }}
          />
          {inspected && (
            <p role="status">
              <code>{inspected}</code> {t('features.savedTerminals.detached')}
            </p>
          )}
          {onReopen && (
            <button type="button" onClick={onReopen}>
              {t('features.savedTerminals.reopen')}
            </button>
          )}
        </>
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() =>
            setHidden((ids) => {
              const next = new Set(ids);
              for (const { id } of members) next.delete(id);
              return next;
            })
          }
        >
          {t('features.savedTerminals.show', { count: hiddenCount })}
        </button>
      )}
    </section>
  );
}
