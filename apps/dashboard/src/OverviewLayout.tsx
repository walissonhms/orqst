import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Modal } from './Modal';
import {
  defaultOverviewPreferences,
  moveOverviewPanel,
  type OverviewPanel,
  type OverviewPreferences,
} from './overview-preferences';

export function OverviewPanels({
  preferences,
  panels,
  onCustomize,
}: {
  preferences: OverviewPreferences;
  panels: Record<OverviewPanel, ReactNode>;
  onCustomize: () => void;
}) {
  const { t } = useTranslation();
  const visible = preferences.order.filter((panel) => !preferences.hidden.includes(panel));
  const [primary, ...secondary] = visible;
  if (!primary)
    return (
      <section className="panel overview-empty" aria-label={t('overviewLayout.title')}>
        <p>{t('overviewLayout.empty')}</p>
        <button className="button" onClick={onCustomize}>
          {t('overviewLayout.title')}
        </button>
      </section>
    );
  return (
    <div className={`overview-panels ${secondary.length ? '' : 'overview-panels-single'}`}>
      <div className="overview-primary" data-overview-panel={primary}>
        {panels[primary]}
      </div>
      {secondary.length > 0 && (
        <div className="overview-secondary">
          {secondary.map((panel) => (
            <div key={panel} data-overview-panel={panel}>
              {panels[panel]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OverviewLayoutEditor({
  preferences,
  onChange,
  storageUnavailable,
  onClose,
}: {
  preferences: OverviewPreferences;
  onChange: (value: OverviewPreferences) => void;
  storageUnavailable: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLOListElement>(null);
  function move(panel: OverviewPanel, direction: -1 | 1) {
    const next = moveOverviewPanel(preferences, panel, direction);
    if (next === preferences) return;
    onChange(next);
    // Keep focus on the moved row even when its move button becomes disabled.
    list.current?.querySelector<HTMLInputElement>(`#overview-visible-${panel}`)?.focus();
    setAnnouncement(
      t('overviewLayout.moved', {
        panel: t(panel),
        position: next.order.indexOf(panel) + 1,
        count: next.order.length,
      }),
    );
  }
  return (
    <Modal
      label={t('overviewLayout.title')}
      className="panel shell-dialog overview-layout-dialog"
      initialFocus=".overview-layout-close"
      onClose={onClose}
    >
      <div className="panel-heading">
        <h2>{t('overviewLayout.title')}</h2>
        <button
          className="icon-button overview-layout-close"
          aria-label={t('close')}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="overview-layout-body">
        <p id="overview-layout-help">{t('overviewLayout.help')}</p>
        {storageUnavailable && (
          <p className="notice" role="status">
            {t('overviewLayout.storageUnavailable')}
          </p>
        )}
        <ol ref={list} className="overview-layout-list" aria-describedby="overview-layout-help">
          {preferences.order.map((panel, index) => (
            <li key={panel}>
              <label>
                <input
                  id={`overview-visible-${panel}`}
                  type="checkbox"
                  checked={!preferences.hidden.includes(panel)}
                  onChange={(event) => {
                    onChange({
                      ...preferences,
                      hidden: event.target.checked
                        ? preferences.hidden.filter((item) => item !== panel)
                        : [...preferences.hidden, panel],
                    });
                  }}
                />
                <span>{t(panel)}</span>
              </label>
              <div className="overview-move-controls">
                <button
                  className="icon-button"
                  aria-label={t('overviewLayout.moveUp', { panel: t(panel) })}
                  disabled={index === 0}
                  onClick={() => move(panel, -1)}
                >
                  <ArrowUp size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t('overviewLayout.moveDown', { panel: t(panel) })}
                  disabled={index === preferences.order.length - 1}
                  onClick={() => move(panel, 1)}
                >
                  <ArrowDown size={17} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <p className="fine-print">{t('overviewLayout.scope')}</p>
        <div className="overview-layout-actions">
          <button
            className="button"
            onClick={() => {
              onChange(defaultOverviewPreferences);
              setAnnouncement(t('overviewLayout.restored'));
            }}
          >
            {t('overviewLayout.reset')}
          </button>
          <button className="button primary" onClick={onClose}>
            {t('overviewLayout.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
