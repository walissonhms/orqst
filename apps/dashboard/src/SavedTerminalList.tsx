import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  members: readonly { id: string; closed: boolean }[];
  onReopen?: () => void;
}

/** Presentation only. A saved ID conveys no authority or proof of process state. */
export function SavedTerminalList({ members, onReopen }: Props) {
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
          <ul>
            {visible.map(({ id, closed }) => (
              <li key={id}>
                <code title={id}>{id.slice(0, 8)}</code>{' '}
                {t(closed ? 'features.savedTerminals.closed' : 'features.savedTerminals.detached')}{' '}
                <button type="button" onClick={() => setHidden((ids) => new Set([...ids, id]))}>
                  {t('features.savedTerminals.hide')}
                </button>
              </li>
            ))}
          </ul>
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
