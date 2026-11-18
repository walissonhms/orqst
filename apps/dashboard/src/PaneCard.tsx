import type { ComponentProps, PointerEventHandler, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaneCardState, StudioTerminal } from './FeatureStudioStage';

interface Props extends ComponentProps<'article'> {
  terminal: StudioTerminal;
  state?: PaneCardState;
  canonical: boolean;
  orchestrator: boolean;
  statusIcon: ReactNode;
  legacyMetadata?: ReactNode;
  actions: ReactNode;
  onHeaderPointerDown: PointerEventHandler<HTMLDivElement>;
  onHeaderDoubleClick: () => void;
}

/** React owns the card chrome. The body can host a retained native PTY. */
export function PaneCard({
  terminal,
  state = 'unknown',
  canonical,
  orchestrator,
  statusIcon,
  legacyMetadata,
  actions,
  onHeaderPointerDown,
  onHeaderDoubleClick,
  children,
  ...article
}: Props) {
  const { t, i18n } = useTranslation();
  const provider = t(`terminalStudio.providers.${terminal.provider}`);
  const stateText = t(`studio.pane.state.${state}`);
  const description = [
    terminal.alias && `@${terminal.alias.replace(/^@/, '')}`,
    terminal.model,
    terminal.cwd,
  ]
    .filter(Boolean)
    .join(' · ');
  const total = terminal.tokens?.total;
  const showName =
    terminal.name.toLowerCase() !== provider.toLowerCase() &&
    terminal.name.replace(/^@/, '').toLowerCase() !== terminal.label.toLowerCase();

  return (
    <article {...article}>
      <div
        className="ts-head"
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={onHeaderDoubleClick}
      >
        {canonical ? (
          <span
            className={`ts-status-dot ts-status-dot-${state}`}
            role="img"
            aria-label={stateText}
            title={stateText}
          />
        ) : (
          statusIcon
        )}
        <span className="ts-cli" title={showName ? undefined : description || undefined}>
          {provider}
        </span>
        {orchestrator && (
          <span className="ts-role" title={t('terminalStudio.orchestratorHint')}>
            <span aria-hidden="true">★</span> {t('studio.pane.pilot')}
          </span>
        )}
        <span className="ts-label">{terminal.label}</span>
        {showName && (
          <span className="ts-name" title={description || undefined}>
            {terminal.name}
          </span>
        )}
        {canonical && (
          <>
            <span className="ts-card-model" title={terminal.model ?? undefined}>
              {terminal.model ?? '—'}
            </span>
            <span className="ts-card-tokens" title={t('terminalStudio.menu.total')}>
              {total === undefined
                ? '—'
                : new Intl.NumberFormat(i18n.language, {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(total)}
            </span>
          </>
        )}
        {legacyMetadata}
        {actions}
      </div>
      {children}
    </article>
  );
}
