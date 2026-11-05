import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Loader2, Send, TriangleAlert, X } from 'lucide-react';
import type { StudioTerminal } from './TerminalStudio';

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
  terminals: StudioTerminal[];
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

/** Find `@…` mentions in the text and resolve them to terminals by exact label. */
export function resolveMentions(text: string, terminals: StudioTerminal[]): StudioTerminal[] {
  const found = new Map<string, StudioTerminal>();
  for (const match of text.matchAll(/@([A-Za-z]-\d{3})\b/g)) {
    const terminal = terminals.find(
      (candidate) => candidate.label.toLowerCase() === match[1]!.toLowerCase(),
    );
    if (terminal) found.set(terminal.id, terminal);
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
  from,
  onFromChange,
  onSend,
  onClose,
  autoFocus,
}: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState<Query>();
  const [highlight, setHighlight] = useState(0);
  const [state, setState] = useState<DeliveryState | 'sending' | undefined>();

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const sender = terminals.find((terminal) => terminal.id === from);
  const recipients = resolveMentions(text, terminals).filter((terminal) => terminal.id !== from);
  const crossWorkspace = sender
    ? recipients.filter((terminal) => terminal.workspace.id !== sender.workspace.id)
    : [];

  const suggestions = useMemo(() => {
    if (!query) return [];
    return terminals
      .filter((terminal) => terminal.id !== from)
      .filter((terminal) =>
        [
          terminal.label,
          terminal.name,
          terminal.provider,
          terminal.model ?? '',
          terminal.workspace.name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.text),
      )
      .slice(0, 8);
  }, [query, terminals, from]);

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
    if (!body || recipients.length === 0 || state === 'sending') return;
    setState('sending');
    try {
      const result = await onSend({ from, to: recipients.map((r) => r.id), text: body });
      setState(result);
      if (result === 'accepted' || result === 'queued') setText('');
    } catch {
      setState('unknown');
    }
  };

  return (
    <div className="mc-root">
      <div className="mc-row">
        <label className="mc-from">
          <span>{t('terminalStudio.mention.from')}</span>
          <select
            value={from ?? ''}
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
            rows={1}
            value={text}
            placeholder={t('terminalStudio.mention.placeholder')}
            aria-label={t('terminalStudio.mention.label')}
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            onChange={(event) => {
              setText(event.target.value);
              setState(undefined);
              setQuery(currentQuery(event.target.value, event.target.selectionStart));
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (suggestions.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  pick(suggestions[highlight]!);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
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
            <ul className="mc-suggest" role="listbox">
              {suggestions.map((terminal, index) => (
                <li
                  key={terminal.id}
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
                    {terminal.model ?? t('terminalStudio.defaultModel')}
                  </span>
                  <span className="mc-ws">{terminal.workspace.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="mc-send"
          disabled={!text.trim() || recipients.length === 0 || state === 'sending'}
          onClick={() => void send()}
        >
          {state === 'sending' ? <Loader2 size={14} className="mc-spin" /> : <Send size={14} />}
          {t('terminalStudio.mention.send')}
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
        {state && state !== 'sending' && (
          <span className={`mc-state mc-state-${state}`}>
            {t(`terminalStudio.mention.state.${state}`)}
          </span>
        )}
      </div>
    </div>
  );
}
