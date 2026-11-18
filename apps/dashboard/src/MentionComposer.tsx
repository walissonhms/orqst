import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Loader2, Send, TriangleAlert, X } from 'lucide-react';
import { DelegateDialog } from './DelegateDialog';
import type { StudioTerminal } from './FeatureStudioStage';

/** Delivery is separate from task execution: accepted never means done. */
export type DeliveryState =
  'queued' | 'accepted' | 'delivery_failed' | 'denied' | 'unsupported' | 'unknown';

export interface MentionSend {
  /** `null` = sent by the user, otherwise the sending terminal. */
  from: string | null;
  to: string[];
  text: string;
}

interface Props {
  initialText?: string;
  terminals: StudioTerminal[];
  /** Reject the whole draft if any mention is ambiguous, outside scope or self-addressed. */
  featureScoped?: boolean;
  recipientLimit?: number;
  /** Terminal the message is sent from, or null for the user. */
  from: string | null;
  onFromChange: (id: string | null) => void;
  onSend: (message: MentionSend) => Promise<DeliveryState>;
  onClose?: () => void;
  autoFocus?: boolean;
}

interface Query {
  start: number;
  text: string;
}

/** Handle used in text: the stable label, e.g. `@T-003`. */
const handleOf = (terminal: StudioTerminal) => `@${terminal.label}`;

/** Ignore code and email addresses; keep qualified tokens intact so they cannot fall back locally. */
function mentionHandles(text: string): string[] {
  const pattern =
    /(`{3,}|~{3,})[\s\S]*?(?:\1|$)|`[^`\n]*`|(?<![\p{L}\p{N}_@.+%-])@([\p{L}\p{N}][\p{L}\p{N}_/-]*)(?![\p{L}\p{N}_@/-])/giu;
  const handles = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    if (match[2]) handles.add(match[2].toLowerCase());
  }
  return [...handles];
}

export function resolveMentions(
  text: string,
  terminals: StudioTerminal[],
  useAliases = false,
): StudioTerminal[] {
  const found = new Map<string, StudioTerminal>();
  for (const handle of mentionHandles(text)) {
    const matches = terminals.filter(
      (candidate) =>
        candidate.label.toLowerCase() === handle ||
        (useAliases && candidate.alias?.toLowerCase() === handle),
    );
    if (matches.length === 1) {
      const terminal = matches[0]!;
      found.set(terminal.id, terminal);
    }
  }
  return [...found.values()];
}

function currentQuery(text: string, caret: number): Query | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return undefined;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return undefined;
  const fragment = before.slice(at + 1);
  if (/\s/.test(fragment)) return undefined;
  return { start: at, text: fragment.toLowerCase() };
}

export function MentionComposer({
  terminals,
  initialText = '',
  featureScoped = false,
  recipientLimit = 8,
  from,
  onFromChange,
  onSend,
  onClose,
  autoFocus,
}: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const sending = useRef(false);
  const [text, setText] = useState(initialText);
  const [query, setQuery] = useState<Query>();
  const [highlight, setHighlight] = useState(0);
  const [state, setState] = useState<DeliveryState | 'sending' | undefined>();

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const sender = terminals.find((terminal) => terminal.id === from);
  const handles = mentionHandles(text);
  const recipients = resolveMentions(text, terminals, featureScoped).filter(
    (terminal) => terminal.id !== from,
  );
  const crossWorkspace = sender
    ? recipients.filter((terminal) => terminal.workspace.id !== sender.workspace.id)
    : [];
  const invalidTarget =
    featureScoped && ((from !== null && !sender) || handles.length !== recipients.length);
  const canSend =
    text.trim().length > 0 &&
    recipients.length > 0 &&
    recipients.length <= recipientLimit &&
    !invalidTarget &&
    state !== 'sending';

  const suggestions = useMemo(() => {
    if (!query) return [];
    return terminals
      .filter((terminal) => terminal.id !== from)
      .filter((terminal) =>
        [
          terminal.label,
          terminal.name,
          ...(featureScoped ? [terminal.alias ?? ''] : []),
          terminal.provider,
          terminal.model ?? '',
          terminal.workspace.name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.text),
      )
      .slice(0, 8);
  }, [query, terminals, from, featureScoped]);

  const pick = (terminal: StudioTerminal) => {
    if (!query) return;
    const caret = input.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, query.start)}${handleOf(terminal)} ${text.slice(caret)}`;
    setText(next);
    setQuery(undefined);
    const position = query.start + handleOf(terminal).length + 1;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!canSend || sending.current) return;
    sending.current = true;
    setQuery(undefined);
    setState('sending');
    try {
      const result = await onSend({ from, to: recipients.map((r) => r.id), text: body });
      setState(result);
      if (result === 'accepted' || result === 'queued') setText('');
    } catch {
      setState('unknown');
    } finally {
      sending.current = false;
    }
  };

  return (
    <div className="mc-root">
      <div className="mc-row">
        <label className="mc-from">
          <span>{t('terminalStudio.mention.from')}</span>
          <select
            value={from ?? ''}
            disabled={state === 'sending'}
            onChange={(event) => onFromChange(event.target.value || null)}
            aria-label={t('terminalStudio.mention.from')}
          >
            <option value="">{t('terminalStudio.mention.you')}</option>
            {terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {terminal.label} · {terminal.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mc-field">
          <AtSign size={14} className="mc-at" aria-hidden="true" />
          <textarea
            ref={input}
            rows={featureScoped ? 3 : 1}
            maxLength={4000}
            value={text}
            disabled={state === 'sending'}
            placeholder={t('terminalStudio.mention.placeholder')}
            aria-label={t('terminalStudio.mention.label')}
            aria-autocomplete="list"
            aria-controls={suggestions.length > 0 ? listId : undefined}
            aria-activedescendant={suggestions.length > 0 ? `${listId}-${highlight}` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setState(undefined);
              setQuery(currentQuery(event.target.value, event.target.selectionStart));
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (suggestions.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  const target = suggestions[highlight] ?? suggestions[0];
                  if (target) pick(target);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery(undefined);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
              if (event.key === 'Escape' && onClose) onClose();
            }}
          />
          {suggestions.length > 0 && (
            <ul id={listId} className="mc-suggest" role="listbox" aria-label={t('mention.targets')}>
              {suggestions.map((terminal, index) => (
                <li
                  key={terminal.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? 'active' : ''}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(terminal);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="ts-label">{terminal.label}</span>
                  <span className="mc-name">{terminal.name}</span>
                  <span
                    className={`ts-provider ts-provider-${terminal.provider}`}
                    aria-hidden="true"
                  />
                  <span className="mc-model">
                    {terminal.model === undefined
                      ? t('mention.modelUnknown')
                      : (terminal.model ?? t('terminalStudio.defaultModel'))}
                  </span>
                  <span className="mc-ws">{terminal.workspace.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="mc-send" disabled={!canSend} onClick={() => void send()}>
          {state === 'sending' ? <Loader2 size={14} className="mc-spin" /> : <Send size={14} />}
          {t(featureScoped ? 'mention.queue' : 'terminalStudio.mention.send')}
        </button>
        {onClose && (
          <button
            type="button"
            className="mc-close"
            onClick={onClose}
            aria-label={t('terminalStudio.mention.close')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="mc-meta" aria-live="polite">
        {recipients.length > 0 ? (
          <span className="mc-to">
            {t('terminalStudio.mention.to')}
            {recipients.map((terminal) => (
              <span key={terminal.id} className="mc-chip">
                <span className="ts-label">{terminal.label}</span>
                {terminal.name}
              </span>
            ))}
          </span>
        ) : (
          <span className="mc-hint">{t('terminalStudio.mention.hint')}</span>
        )}
        {crossWorkspace.length > 0 && (
          <span className="mc-warn">
            <TriangleAlert size={12} aria-hidden="true" />
            {t('terminalStudio.mention.crossWorkspace')}
          </span>
        )}
        {invalidTarget && (
          <span className="mc-warn">
            {from !== null && !sender
              ? t('communication.refused.sender_unassigned')
              : handles.some((handle) => handle.includes('/'))
                ? t('communication.refused.not_permitted', {
                    target: '@' + handles.find((handle) => handle.includes('/')),
                  })
                : t('communication.unknownMention', {
                    target:
                      '@' +
                      handles.find(
                        (handle) =>
                          !recipients.some((terminal) =>
                            [terminal.label, terminal.alias].some(
                              (alias) => alias?.toLowerCase() === handle,
                            ),
                          ),
                      ),
                  })}
          </span>
        )}
        {recipients.length > recipientLimit && (
          <span className="mc-warn">{t('communication.invalidRecipientCount')}</span>
        )}
        {state && state !== 'sending' && (
          <span className={`mc-state mc-state-${state}`}>
            {t(state === 'queued' ? 'mention.queued' : `terminalStudio.mention.state.${state}`)}
          </span>
        )}
      </div>
    </div>
  );
}

export interface FeatureMentionScope {
  workspaceId: string;
  featureId: string;
}

export interface FeatureDelegateProps {
  scope: FeatureMentionScope | null;
  /** Membership from the active Feature's authoritative snapshot only. */
  terminals: StudioTerminal[];
  onSend: (scope: FeatureMentionScope, message: MentionSend) => Promise<DeliveryState>;
  disabled?: boolean;
  openForRecipient?: Ref<(terminalId: string) => void>;
}

/** Breadcrumb action. The host remains responsible for native generation and permissions. */
export function FeatureDelegate(props: FeatureDelegateProps) {
  return (
    <FeatureDelegateAction
      key={JSON.stringify(props.scope && [props.scope.workspaceId, props.scope.featureId])}
      {...props}
    />
  );
}

function FeatureDelegateAction({
  scope,
  terminals,
  onSend,
  disabled,
  openForRecipient,
}: FeatureDelegateProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [dispatch, setDispatch] = useState<{
    generation: number;
    recipients: string[];
    senders: string[];
    otherFeatures: boolean;
  }>();
  const members = terminals.filter((terminal) => terminal.workspace.id === scope?.workspaceId);
  const available =
    !!scope &&
    members.some(({ provider }) => provider !== 'antigravity' && provider !== 'shell') &&
    !disabled;

  async function openDelegate(terminalId?: string) {
    if (!scope || !available || opening) return;
    setOpening(true);
    setRecipient(terminalId);
    setDispatch(undefined);
    try {
      const native = window.orqstFeatures;
      const snapshot = (
        await native?.request({
          contractVersion: 1,
          generation: 0,
          action: 'snapshot',
        })
      )?.snapshot;
      if (
        snapshot?.workspace.id === scope.workspaceId &&
        snapshot.activeFeatureId === scope.featureId
      ) {
        const details = (
          await native?.request({
            contractVersion: 1,
            generation: snapshot.generation,
            action: 'inspector',
            command: { kind: 'read', featureId: scope.featureId },
          })
        )?.inspector;
        if (details?.status === 'ok' && details.featureId === scope.featureId)
          setDispatch({
            generation: snapshot.generation,
            recipients: details.recipients,
            senders: details.senders,
            otherFeatures: snapshot.features.some(
              (feature) => feature.featureId !== scope.featureId && feature.status !== 'archived',
            ),
          });
      }
    } catch {
      // The existing owner-only composer path still checks the active Feature at submission.
    } finally {
      setOpen(true);
      setOpening(false);
    }
  }

  useImperativeHandle(openForRecipient, () => (terminalId) => void openDelegate(terminalId));

  const defaultSender =
    members.find(
      (terminal) =>
        terminal.id !== recipient &&
        terminal.orchestrator &&
        dispatch?.senders.includes(terminal.id),
    ) ??
    members.find(
      (terminal) =>
        terminal.id !== recipient && terminal.active && dispatch?.senders.includes(terminal.id),
    );
  return (
    <>
      <button
        type="button"
        className="mc-delegate"
        aria-haspopup="dialog"
        disabled={!available || opening}
        title={available ? undefined : t('mention.unavailable')}
        onClick={() => void openDelegate()}
      >
        <span aria-hidden="true">↗</span> {t('mention.delegate')}
      </button>
      {open && scope && (
        <DelegateDialog
          terminals={
            dispatch
              ? members.filter(
                  ({ id, provider }) =>
                    dispatch.recipients.includes(id) || provider === 'antigravity',
                )
              : members
          }
          from={defaultSender?.id}
          to={recipient}
          senders={dispatch?.senders ?? []}
          otherFeatures={dispatch?.otherFeatures}
          onClose={() => setOpen(false)}
          onSend={async (from, to, text) => {
            if (!available) return t('communication.refused.unavailable');
            if (from && dispatch) {
              const reply = await window.orqstFeatures?.request({
                action: 'inspector',
                contractVersion: 1,
                generation: dispatch.generation,
                command: {
                  kind: 'send',
                  featureId: scope.featureId,
                  targetFeatureId: scope.featureId,
                  from,
                  to: [to],
                  text,
                  task: true,
                },
              });
              if (reply?.inspector?.status === 'queued') return undefined;
              if (reply?.inspector?.status === 'refused')
                return t('communication.refused.' + reply.inspector.code, {
                  target: '@' + (members.find(({ id }) => id === to)?.label ?? ''),
                });
              return t('communication.refused.unavailable');
            }
            const result = await onSend(scope, { from, to: [to], text });
            if (result === 'queued' || result === 'accepted') return undefined;
            return t(`terminalStudio.mention.state.${result}`);
          }}
        />
      )}
    </>
  );
}
