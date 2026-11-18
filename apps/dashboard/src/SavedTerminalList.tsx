import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EndedTerminalList } from './EndedTerminalList.js';
import type { EndedTerminal } from './terminal-lifecycle.js';

interface Props {
  members: readonly {
    id: string;
    closed: boolean;
    confirmedExit?: boolean;
    released?: boolean;
    displayId?: string;
    provider?: EndedTerminal['provider'];
    name?: string;
  }[];
  onReopen?: (terminalId: string) => void;
  onRemove?: (terminalId: string) => void;
}

/** Presentation only. A saved ID conveys no authority or proof of process state. */
export function SavedTerminalList({ members, onReopen, onRemove }: Props) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const visible = members.filter(({ id }) => !hidden.has(id));
  const hiddenCount = members.length - visible.length;
  if (!members.length) return null;
  return (
    <section className="saved-terminal-list" aria-label={t('features.savedTerminals.title')}>
      <p>{t('features.savedTerminals.title')}</p>
      {visible.length > 0 && (
        <>
          <EndedTerminalList
            terminals={visible.map(
              ({ id, confirmedExit, released, displayId, provider, name }) => ({
                terminalId: id,
                displayId,
                provider,
                name,
                released,
                disposition: confirmedExit ? 'exit_confirmed' : 'uncertain',
              }),
            )}
            onRemove={onRemove ? ({ terminalId }) => onRemove(terminalId) : undefined}
            onReopen={onReopen ? ({ terminalId }) => onReopen(terminalId) : undefined}
            onHide={({ terminalId }) => {
              setHidden((ids) => new Set([...ids, terminalId]));
            }}
          />
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
