import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus, Plus, Sparkles, X } from 'lucide-react';
import { Modal } from './Modal';
import type { TerminalProvider } from './TerminalStudio';
import './new-terminal-dialog.css';

export interface CatalogModel {
  id: string;
  /** Optional friendly name; the exact id is always shown too. */
  label?: string;
}

/** One CLI as confirmed by the native catalog; never a guessed capability. */
export interface ProviderCatalog {
  provider: TerminalProvider;
  available: boolean;
  /** Short reason shown when unavailable, already translated by the caller. */
  reason?: string;
  models: CatalogModel[];
}

export interface TerminalRequest {
  provider: TerminalProvider;
  /** `null` = let the CLI use its own default model. */
  model: string | null;
  name: string;
}

interface Props {
  catalog: ProviderCatalog[];
  /** Remaining capacity of the current Feature. */
  max: number;
  onCancel: () => void;
  onConfirm: (requests: TerminalRequest[]) => void;
}

interface Choice {
  provider: TerminalProvider;
  model: string | null;
  name: string;
}

const providerOrder: TerminalProvider[] = ['codex', 'claude', 'opencode', 'shell'];

function firstAvailable(catalog: ProviderCatalog[]): ProviderCatalog | undefined {
  return (
    providerOrder.map((p) => catalog.find((c) => c.provider === p)).find((c) => c?.available) ??
    undefined
  );
}

export function NewTerminalDialog({ catalog, max, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const limit = Math.max(1, Math.min(8, max));
  const initial = firstAvailable(catalog);
  const base: Choice = {
    provider: initial?.provider ?? 'codex',
    model: initial?.models[0]?.id ?? null,
    name: '',
  };
  const [count, setCount] = useState(1);
  const [same, setSame] = useState(true);
  const [shared, setShared] = useState<Choice>(base);
  const [rows, setRows] = useState<Choice[]>(() => Array.from({ length: 8 }, () => ({ ...base })));

  const byProvider = useMemo(() => new Map(catalog.map((c) => [c.provider, c])), [catalog]);
  const choices = same
    ? Array.from({ length: count }, () => ({ ...shared, name: '' }))
    : rows.slice(0, count);
  const valid =
    count >= 1 && choices.every((choice) => byProvider.get(choice.provider)?.available === true);

  const summary = providerOrder
    .map((provider) => ({
      provider,
      n: choices.filter((choice) => choice.provider === provider).length,
    }))
    .filter((entry) => entry.n > 0)
    .map((entry) => `${entry.n} ${t(`terminalStudio.providers.${entry.provider}`)}`)
    .join(' · ');

  const presetLists: TerminalProvider[][] = [
    ['codex', 'codex'],
    ['claude', 'claude'],
    ['codex', 'claude'],
    ['codex', 'claude', 'opencode'],
  ];
  const presets = presetLists
    .filter((list) => list.length <= limit)
    .filter((list) => list.every((provider) => byProvider.get(provider)?.available))
    .map((list) => {
      const counts = providerOrder
        .map((provider) => ({ provider, n: list.filter((p) => p === provider).length }))
        .filter((entry) => entry.n > 0);
      return {
        key: list.join('-'),
        label: counts
          .map((entry) =>
            entry.n > 1
              ? t('terminalStudio.create.times', {
                  count: entry.n,
                  name: t(`terminalStudio.providers.${entry.provider}`),
                })
              : t(`terminalStudio.providers.${entry.provider}`),
          )
          .join(' + '),
        build: () => list.map(pick),
      };
    });

  function pick(provider: TerminalProvider): Choice {
    return { provider, model: byProvider.get(provider)?.models[0]?.id ?? null, name: '' };
  }
  function applyPreset(list: Choice[]) {
    const n = Math.min(list.length, limit);
    setCount(n);
    const uniform = list.every((choice) => choice.provider === list[0]!.provider);
    setSame(uniform);
    if (uniform) setShared(list[0]!);
    setRows((current) => current.map((row, index) => list[index] ?? row));
  }
  function setRow(index: number, patch: Partial<Choice>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const confirm = () => {
    if (!valid) return;
    onConfirm(choices.map((choice) => ({ ...choice, name: choice.name.trim() })));
  };

  return (
    <Modal
      label={t('terminalStudio.create.title')}
      className="ntd"
      initialFocus=".ntd-count-value"
      onClose={onCancel}
    >
      <form
        className="ntd-form"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <header className="ntd-head">
          <div>
            <h2>{t('terminalStudio.create.title')}</h2>
            <p>{t('terminalStudio.create.subtitle')}</p>
          </div>
          <button
            type="button"
            className="ntd-icon"
            onClick={onCancel}
            aria-label={t('terminalStudio.create.cancel')}
          >
            <X size={16} />
          </button>
        </header>

        <section className="ntd-section">
          <h3>{t('terminalStudio.create.howMany')}</h3>
          <div className="ntd-count">
            <button
              type="button"
              className="ntd-step"
              disabled={count <= 1}
              onClick={() => setCount((n) => Math.max(1, n - 1))}
              aria-label={t('terminalStudio.create.fewer')}
            >
              <Minus size={16} />
            </button>
            <output className="ntd-count-value" tabIndex={0} aria-live="polite">
              {count}
            </output>
            <button
              type="button"
              className="ntd-step"
              disabled={count >= limit}
              onClick={() => setCount((n) => Math.min(limit, n + 1))}
              aria-label={t('terminalStudio.create.more')}
            >
              <Plus size={16} />
            </button>
            <div className="ntd-quick" role="group" aria-label={t('terminalStudio.create.howMany')}>
              {[1, 2, 3, 4, 6, 8]
                .filter((n) => n <= limit)
                .map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === count ? 'active' : ''}
                    aria-pressed={n === count}
                    onClick={() => setCount(n)}
                  >
                    {n}
                  </button>
                ))}
            </div>
          </div>
          {max < 8 && (
            <p className="ntd-hint">{t('terminalStudio.create.capacity', { count: limit })}</p>
          )}
          {presets.length > 0 && (
            <div className="ntd-presets">
              <Sparkles size={13} aria-hidden="true" />
              {presets.map((preset) => (
                <button key={preset.key} type="button" onClick={() => applyPreset(preset.build())}>
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </section>

        {count > 1 && (
          <div
            className="ntd-toggle"
            role="radiogroup"
            aria-label={t('terminalStudio.create.setup')}
          >
            <button type="button" role="radio" aria-checked={same} onClick={() => setSame(true)}>
              {t('terminalStudio.create.sameForAll')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!same}
              onClick={() => {
                if (same) setRows((current) => current.map(() => ({ ...shared })));
                setSame(false);
              }}
            >
              {t('terminalStudio.create.eachOwn')}
            </button>
          </div>
        )}

        {same ? (
          <section className="ntd-section">
            <h3>{t('terminalStudio.create.cli')}</h3>
            <div
              className="ntd-providers"
              role="radiogroup"
              aria-label={t('terminalStudio.create.cli')}
            >
              {providerOrder.map((provider) => {
                const entry = byProvider.get(provider);
                if (!entry) return null;
                const selected = shared.provider === provider;
                return (
                  <button
                    key={provider}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!entry.available}
                    className={`ntd-provider ntd-provider-${provider}${selected ? ' active' : ''}`}
                    onClick={() =>
                      setShared({ provider, model: entry.models[0]?.id ?? null, name: '' })
                    }
                  >
                    <span className="ntd-mark" aria-hidden="true" />
                    <span className="ntd-provider-name">
                      {t(`terminalStudio.providers.${provider}`)}
                    </span>
                    <span className="ntd-provider-meta">
                      {!entry.available
                        ? (entry.reason ?? t('terminalStudio.create.unavailable'))
                        : provider === 'shell'
                          ? t('terminalStudio.create.noModel')
                          : t('terminalStudio.create.modelCount', { count: entry.models.length })}
                    </span>
                    {selected && <Check size={14} className="ntd-check" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {shared.provider !== 'shell' && (
              <>
                <h3>{t('terminalStudio.create.model')}</h3>
                <ModelPicker
                  models={byProvider.get(shared.provider)?.models ?? []}
                  value={shared.model}
                  onChange={(model) => setShared({ ...shared, model })}
                />
              </>
            )}
          </section>
        ) : (
          <section className="ntd-section ntd-rows">
            {rows.slice(0, count).map((row, index) => {
              const entry = byProvider.get(row.provider);
              return (
                <div key={index} className="ntd-row">
                  <span className="ntd-row-index">{index + 1}</span>
                  <input
                    className="ntd-input"
                    value={row.name}
                    maxLength={40}
                    placeholder={t('terminalStudio.create.namePlaceholder', { n: index + 1 })}
                    aria-label={t('terminalStudio.create.name', { n: index + 1 })}
                    onChange={(event) => setRow(index, { name: event.target.value })}
                  />
                  <div
                    className="ntd-mini"
                    role="radiogroup"
                    aria-label={t('terminalStudio.create.cli')}
                  >
                    {providerOrder.map((provider) => {
                      const option = byProvider.get(provider);
                      if (!option) return null;
                      return (
                        <button
                          key={provider}
                          type="button"
                          role="radio"
                          aria-checked={row.provider === provider}
                          disabled={!option.available}
                          title={option.available ? undefined : option.reason}
                          className={`ntd-provider-${provider}${row.provider === provider ? ' active' : ''}`}
                          onClick={() =>
                            setRow(index, { provider, model: option.models[0]?.id ?? null })
                          }
                        >
                          <span className="ntd-mark" aria-hidden="true" />
                          {t(`terminalStudio.providers.${provider}`)}
                        </button>
                      );
                    })}
                  </div>
                  {row.provider === 'shell' ? (
                    <span className="ntd-select ntd-none">
                      {t('terminalStudio.create.noModel')}
                    </span>
                  ) : (
                    <select
                      className="ntd-select"
                      value={row.model ?? ''}
                      aria-label={t('terminalStudio.create.model')}
                      onChange={(event) => setRow(index, { model: event.target.value || null })}
                    >
                      {(entry?.models ?? []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label ?? model.id}
                        </option>
                      ))}
                      <option value="">{t('terminalStudio.defaultModel')}</option>
                    </select>
                  )}
                </div>
              );
            })}
          </section>
        )}

        <footer className="ntd-foot">
          <span className="ntd-summary">{summary}</span>
          <button type="button" className="ntd-secondary" onClick={onCancel}>
            {t('terminalStudio.create.cancel')}
          </button>
          <button type="submit" className="ntd-primary" disabled={!valid}>
            <Plus size={15} />
            {t('terminalStudio.create.open', { count })}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: CatalogModel[];
  value: string | null;
  onChange: (model: string | null) => void;
}) {
  const { t } = useTranslation();
  const options = [
    ...models.map((m) => ({ id: m.id as string | null, label: m.label })),
    { id: null, label: undefined },
  ];
  return (
    <div className="ntd-models" role="radiogroup" aria-label={t('terminalStudio.create.model')}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id ?? 'default'}
            type="button"
            role="radio"
            aria-checked={selected}
            className={selected ? 'active' : ''}
            onClick={() => onChange(option.id)}
          >
            <span className="ntd-model-name">
              {option.id === null ? t('terminalStudio.defaultModel') : (option.label ?? option.id)}
            </span>
            {option.id !== null && option.label && (
              <span className="ntd-model-id">{option.id}</span>
            )}
            {option.id === null && (
              <span className="ntd-model-id">{t('terminalStudio.create.defaultHint')}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
