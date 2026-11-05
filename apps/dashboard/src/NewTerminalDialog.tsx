import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Crown, Minus, Plus, Sparkles, X } from 'lucide-react';
import { Modal } from './Modal';
import { workspaceHue, type TerminalProvider } from './TerminalStudio';
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
  /** ORQST account profiles for this CLI; login always happens in the CLI itself. */
  accounts?: { id: string; label: string; state: 'ready' | 'limited' | 'signed_out' | 'unknown' }[];
}

export interface WorkspaceOption {
  id: string;
  name: string;
  /** Shown as a hint, e.g. the project path. */
  detail?: string;
}

export interface TerminalRequest {
  workspaceId: string;
  provider: TerminalProvider;
  /** `null` = let the CLI use its own default model. */
  model: string | null;
  /** `null` = the CLI's default profile. */
  accountId: string | null;
  name: string;
  /** Label this terminal as the orchestrator (descriptive only). */
  orchestrator: boolean;
}

interface Props {
  catalog: ProviderCatalog[];
  workspaces: WorkspaceOption[];
  /** Workspace preselected when the dialog opens (usually the current one). */
  initialWorkspaceId?: string;
  /** Remaining capacity of the current Feature. */
  max: number;
  onCancel: () => void;
  onConfirm: (requests: TerminalRequest[]) => void;
}

interface Choice {
  workspaceId: string;
  provider: TerminalProvider;
  model: string | null;
  accountId: string | null;
  name: string;
}

const providerOrder: TerminalProvider[] = ['codex', 'claude', 'opencode', 'shell'];

function firstAvailable(catalog: ProviderCatalog[]): ProviderCatalog | undefined {
  return (
    providerOrder.map((p) => catalog.find((c) => c.provider === p)).find((c) => c?.available) ??
    undefined
  );
}

function defaultAccount(entry: ProviderCatalog | undefined): string | null {
  const list = entry?.accounts ?? [];
  return (
    (list.find((a) => a.state === 'ready') ?? list.find((a) => a.state !== 'signed_out'))?.id ??
    null
  );
}

export function NewTerminalDialog({
  catalog,
  workspaces,
  initialWorkspaceId,
  max,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const limit = Math.max(1, Math.min(8, max));
  const initial = firstAvailable(catalog);
  const firstWorkspace =
    workspaces.find((workspace) => workspace.id === initialWorkspaceId)?.id ??
    workspaces[0]?.id ??
    '';
  const [targets, setTargets] = useState<string[]>(firstWorkspace ? [firstWorkspace] : []);
  const base: Choice = {
    workspaceId: firstWorkspace,
    provider: initial?.provider ?? 'codex',
    model: initial?.models[0]?.id ?? null,
    accountId: defaultAccount(initial),
    name: '',
  };
  const [count, setCount] = useState(1);
  const [same, setSame] = useState(true);
  /** Index of the new terminal labelled orchestrator, or -1. */
  const [lead, setLead] = useState(-1);
  const [shared, setShared] = useState<Choice>(base);
  const [rows, setRows] = useState<Choice[]>(() => Array.from({ length: 8 }, () => ({ ...base })));

  const byProvider = useMemo(() => new Map(catalog.map((c) => [c.provider, c])), [catalog]);
  // Same setup: `count` terminals in EACH selected workspace. Each own: one row per terminal.
  const choices = same
    ? targets.flatMap((workspaceId) =>
        Array.from({ length: count }, () => ({ ...shared, workspaceId, name: '' })),
      )
    : rows.slice(0, count);
  const total = choices.length;
  const overCapacity = total > max;
  const valid =
    total >= 1 &&
    !overCapacity &&
    choices.every(
      (choice) =>
        byProvider.get(choice.provider)?.available === true &&
        workspaces.some((workspace) => workspace.id === choice.workspaceId),
    );
  const nameOf = (id: string) => workspaces.find((workspace) => workspace.id === id)?.name ?? '?';
  const toggleTarget = (id: string) =>
    setTargets((current) =>
      current.includes(id)
        ? current.length > 1
          ? current.filter((entry) => entry !== id)
          : current
        : [...current, id],
    );

  const summary = providerOrder
    .map((provider) => ({
      provider,
      n: choices.filter((choice) => choice.provider === provider).length,
    }))
    .filter((entry) => entry.n > 0)
    .map((entry) => `${entry.n} ${t(`terminalStudio.providers.${entry.provider}`)}`)
    .join(' · ');
  const workspaceCount = new Set(choices.map((choice) => choice.workspaceId)).size;

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
    return {
      workspaceId: targets[0] ?? firstWorkspace,
      provider,
      model: byProvider.get(provider)?.models[0]?.id ?? null,
      accountId: defaultAccount(byProvider.get(provider)),
      name: '',
    };
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
    onConfirm(
      choices.map((choice) => ({
        workspaceId: choice.workspaceId,
        provider: choice.provider,
        model: choice.model,
        accountId: choice.accountId,
        name: choice.name.trim(),
        orchestrator: choices.indexOf(choice) === lead,
      })),
    );
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

        {workspaces.length > 0 && (
          <section className="ntd-section">
            <h3>{t('terminalStudio.create.where')}</h3>
            <div
              className="ntd-workspaces"
              role="group"
              aria-label={t('terminalStudio.create.where')}
            >
              {workspaces.map((workspace) => {
                const selected = targets.includes(workspace.id);
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    aria-pressed={selected}
                    className={selected ? 'active' : ''}
                    style={{ '--ts-ws': workspaceHue(workspace.id) } as React.CSSProperties}
                    title={workspace.detail}
                    onClick={() => toggleTarget(workspace.id)}
                  >
                    <span className="ts-ws-dot" aria-hidden="true" />
                    <span className="ntd-ws-name">{workspace.name}</span>
                    {selected && <Check size={13} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {same && targets.length > 1 && (
              <p className="ntd-hint">
                {t('terminalStudio.create.perWorkspace', { count, workspaces: targets.length })}
              </p>
            )}
          </section>
        )}

        <section className="ntd-section">
          <h3>
            {same && targets.length > 1
              ? t('terminalStudio.create.howManyEach')
              : t('terminalStudio.create.howMany')}
          </h3>
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

        {(count > 1 || targets.length > 1) && (
          <div
            className="ntd-toggle"
            role="radiogroup"
            aria-label={t('terminalStudio.create.setup')}
          >
            <button
              type="button"
              role="radio"
              aria-checked={same}
              onClick={() => {
                // Back to one setup: the count is per workspace again.
                if (!same)
                  setCount(Math.max(1, Math.min(limit, Math.round(count / targets.length))));
                setSame(true);
              }}
            >
              {t('terminalStudio.create.sameForAll')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!same}
              onClick={() => {
                if (same)
                  setRows(
                    choices.concat(Array.from({ length: 8 }, () => ({ ...shared }))).slice(0, 8),
                  );
                if (same) setCount(Math.min(8, Math.max(1, choices.length)));
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
                      setShared({
                        ...shared,
                        provider,
                        model: entry.models[0]?.id ?? null,
                        accountId: defaultAccount(entry),
                        name: '',
                      })
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
            {(byProvider.get(shared.provider)?.accounts?.length ?? 0) > 1 && (
              <>
                <h3>{t('terminalStudio.create.account')}</h3>
                <AccountPicker
                  accounts={byProvider.get(shared.provider)!.accounts!}
                  value={shared.accountId}
                  onChange={(accountId) => setShared({ ...shared, accountId })}
                />
              </>
            )}
          </section>
        ) : (
          <section className="ntd-section ntd-rows">
            {rows.slice(0, count).map((row, index) => {
              const entry = byProvider.get(row.provider);
              return (
                <div key={index} className={`ntd-row${lead === index ? ' ntd-lead' : ''}`}>
                  <button
                    type="button"
                    className={`ntd-row-index${lead === index ? ' active' : ''}`}
                    aria-pressed={lead === index}
                    title={t('terminalStudio.create.makeOrchestrator')}
                    aria-label={t('terminalStudio.create.makeOrchestratorN', { n: index + 1 })}
                    onClick={() => setLead((current) => (current === index ? -1 : index))}
                  >
                    {lead === index ? <Crown size={12} /> : index + 1}
                  </button>
                  <select
                    className="ntd-select ntd-ws-select"
                    value={row.workspaceId}
                    aria-label={t('terminalStudio.create.workspaceFor', { n: index + 1 })}
                    onChange={(event) => setRow(index, { workspaceId: event.target.value })}
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
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
                            setRow(index, {
                              provider,
                              model: option.models[0]?.id ?? null,
                              accountId: defaultAccount(option),
                            })
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

        {total > 1 && (
          <label className="ntd-lead-toggle">
            <input
              type="checkbox"
              checked={lead >= 0}
              onChange={(event) => setLead(event.target.checked ? 0 : -1)}
            />
            <Crown size={14} aria-hidden="true" />
            <span>
              {same
                ? t('terminalStudio.create.firstIsOrchestrator')
                : lead >= 0
                  ? t('terminalStudio.create.orchestratorIs', { n: lead + 1 })
                  : t('terminalStudio.create.pickOrchestrator')}
              <small>{t('terminalStudio.orchestratorHint')}</small>
            </span>
          </label>
        )}

        <footer className="ntd-foot">
          <span className={`ntd-summary${overCapacity ? ' ntd-over' : ''}`}>
            {overCapacity
              ? t('terminalStudio.create.overCapacity', { count: max })
              : workspaceCount > 1
                ? t('terminalStudio.create.summaryAcross', {
                    summary,
                    count: workspaceCount,
                  })
                : `${summary} · ${nameOf(choices[0]?.workspaceId ?? '')}`}
          </span>
          <button type="button" className="ntd-secondary" onClick={onCancel}>
            {t('terminalStudio.create.cancel')}
          </button>
          <button type="submit" className="ntd-primary" disabled={!valid}>
            <Plus size={15} />
            {t('terminalStudio.create.open', { count: total })}
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

function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: NonNullable<ProviderCatalog['accounts']>;
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ntd-accounts" role="radiogroup" aria-label={t('terminalStudio.create.account')}>
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          role="radio"
          aria-checked={value === account.id}
          disabled={account.state === 'signed_out'}
          className={value === account.id ? 'active' : ''}
          onClick={() => onChange(account.id)}
        >
          <span className={`pm-account-state pm-state-${account.state}`} aria-hidden="true" />
          <span className="ntd-account-name">{account.label}</span>
          <span className="ntd-account-state">{t(`terminalStudio.account.${account.state}`)}</span>
        </button>
      ))}
    </div>
  );
}
