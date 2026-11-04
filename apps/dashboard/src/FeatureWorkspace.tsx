import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  FeatureNativeRequest,
  FeatureNativeSnapshot,
  WorkspaceFeature,
} from '@orqst/protocol';
import './feature-workspace.css';

type Action = FeatureNativeRequest extends infer R
  ? R extends FeatureNativeRequest
    ? Omit<R, 'contractVersion' | 'generation'>
    : never
  : never;

/** Shared native chrome/Studio metadata UI. Terminals remain retained native documents. */
export function FeatureWorkspace({ nativeWorkspace = false }: { nativeWorkspace?: boolean }) {
  const { t } = useTranslation();
  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const [snapshot, setSnapshot] = useState<FeatureNativeSnapshot>();
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<FeatureNativeRequest['action'] | null>(null);
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<WorkspaceFeature | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<WorkspaceFeature['status']>('planned');
  const [assignSlot, setAssignSlot] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const working = useRef(false);
  const editorVersion = useRef(0);
  const current = useRef<FeatureNativeSnapshot | undefined>(undefined);
  const selected = snapshot?.features.find(
    (feature) => feature.featureId === snapshot.activeFeatureId,
  );
  const assigned = snapshot?.features.flatMap((feature) => feature.terminalIds) ?? [];
  const unassigned = snapshot?.slots.filter((slot) => !assigned.includes(slot.terminalId)) ?? [];
  const members = selected ? selected.terminalIds : unassigned.map((slot) => slot.terminalId);
  const available = snapshot?.slots.filter((slot) => members.includes(slot.terminalId)) ?? [];

  const request = useCallback(
    async (action: Action) => {
      if (!native || working.current) return;
      working.current = true;
      setBusy(true);
      setOperation(action.action);
      setNotice('');
      try {
        const reply = await native.request({
          ...action,
          contractVersion: 1,
          generation: current.current?.generation ?? 0,
        } as FeatureNativeRequest);
        if (!live.current) return;
        if (reply.snapshot) {
          current.current = reply.snapshot;
          setSnapshot(reply.snapshot);
        }
        if (reply.status !== 'ok') setNotice(reply.status);
        return reply.status;
      } catch {
        if (live.current) setNotice('unavailable');
        return 'unavailable';
      } finally {
        working.current = false;
        if (live.current) {
          setBusy(false);
          setOperation(null);
        }
      }
    },
    [native],
  );

  useEffect(() => {
    live.current = true;
    void request({ action: 'snapshot' });
    const update = (event: Event) => {
      const incoming = (event as CustomEvent<FeatureNativeSnapshot>).detail;
      // The native client validates this event before dispatching it. Older ACKs are inert.
      if (!current.current || incoming.generation >= current.current.generation) {
        current.current = incoming;
        setSnapshot(incoming);
      }
    };
    window.addEventListener('orqst-feature-state', update);
    return () => {
      live.current = false;
      window.removeEventListener('orqst-feature-state', update);
    };
  }, [request]);
  useEffect(() => {
    if (editor) input.current?.focus();
  }, [editor]);

  function openEditor(feature: WorkspaceFeature | 'new') {
    editorVersion.current++;
    setEditor(feature);
    setName(feature === 'new' ? '' : feature.name);
    setDescription(feature === 'new' ? '' : feature.description);
    setStatus(feature === 'new' ? 'planned' : feature.status);
  }
  function closeEditor() {
    editorVersion.current++;
    const isNew = editor === 'new';
    setEditor(null);
    (isNew ? createTrigger : editTrigger).current?.focus();
  }
  async function save() {
    if (!editor) return;
    const version = editorVersion.current;
    const result = await request(
      editor === 'new'
        ? { action: 'create', input: { name: name.trim(), description, status } }
        : {
            action: 'update',
            featureId: editor.featureId,
            input: { name: name.trim(), description, status, expectedRevision: editor.revision },
          },
    );
    if (result === 'ok' && version === editorVersion.current) closeEditor();
  }
  const unavailable = !native || !snapshot;
  return (
    <section
      className={`feature-workspace${nativeWorkspace ? ' feature-native' : ''}`}
      aria-label={t('features.workspace')}
      aria-busy={busy}
    >
      <aside className="feature-sidebar">
        <div className="feature-brand">
          <img
            src={nativeWorkspace ? 'orqst-features://local/logo.svg' : '/brand/orqst-logo-dark.svg'}
            alt={t('brand')}
            width={117}
            height={36}
          />
        </div>
        <h2>{t('features.workspaces')}</h2>
        {snapshot ? (
          <div className="feature-project" title={snapshot.workspace.id}>
            ▣ <strong>{snapshot.workspace.name}</strong>
            <small>{snapshot.features.length}</small>
          </div>
        ) : (
          <p className="feature-help">{t('features.unavailable')}</p>
        )}
        <h2>{t('features.heading')}</h2>
        <nav aria-label={t('features.heading')}>
          {snapshot?.features.map((feature) => (
            <button
              key={feature.featureId}
              className={feature.featureId === snapshot.activeFeatureId ? 'active' : ''}
              aria-current={feature.featureId === snapshot.activeFeatureId ? 'page' : undefined}
              disabled={busy}
              title={`${feature.description}\n${t(`features.status_${feature.status}`)} · ${feature.featureId}`}
              onClick={() => {
                closeEditor();
                void request({
                  action: 'select',
                  featureId: feature.featureId,
                  expectedRevision: snapshot.view.revision,
                });
              }}
            >
              <span aria-hidden="true">◇</span>
              <span>{feature.name}</span>
              <small>{feature.terminalIds.length}</small>
            </button>
          ))}
          {snapshot && (
            <button
              disabled={busy}
              className={snapshot.activeFeatureId === null ? 'active' : ''}
              aria-current={snapshot.activeFeatureId === null ? 'page' : undefined}
              onClick={() => {
                closeEditor();
                void request({
                  action: 'select',
                  featureId: null,
                  expectedRevision: snapshot.view.revision,
                });
              }}
            >
              <span aria-hidden="true">·</span>
              <span>{t('features.unassigned')}</span>
              <small>{unassigned.length}</small>
            </button>
          )}
        </nav>
        <button
          ref={createTrigger}
          className="feature-create"
          disabled={busy || unavailable}
          onClick={() => openEditor('new')}
        >
          ＋ {t('features.create')}
        </button>
        {editor && (
          <form
            className="feature-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.stopPropagation();
                closeEditor();
              }
            }}
          >
            <h3>{t(editor === 'new' ? 'features.create' : 'features.edit')}</h3>
            <label>
              {t('features.name')}
              <input
                ref={input}
                required
                maxLength={48}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              {t('features.description')}
              <textarea
                maxLength={2048}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              {t('features.status')}
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as WorkspaceFeature['status'])}
                disabled={busy}
              >
                {(['planned', 'active', 'blocked', 'completed', 'archived'] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`features.status_${value}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <div className="feature-form-actions">
              <button type="button" disabled={busy} onClick={closeEditor}>
                {t('features.cancel')}
              </button>
              <button type="submit" disabled={busy || !name.trim()}>
                {t(busy ? 'features.saving' : 'features.save')}
              </button>
            </div>
          </form>
        )}
        {selected && !editor && (
          <div className="feature-members">
            <p>{t('features.members', { count: selected.terminalIds.length })}</p>
            <p>{t('features.available', { count: available.length })}</p>
            {selected.terminalIds.length > available.length && (
              <p>
                {t('features.missing', { count: selected.terminalIds.length - available.length })}
              </p>
            )}
            {unassigned.length > 0 && selected.status !== 'archived' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (assignSlot)
                    void request({
                      action: 'assign',
                      featureId: selected.featureId,
                      slot: Number(assignSlot),
                      expectedRevision: selected.revision,
                    }).then((result) => {
                      if (result === 'ok') setAssignSlot('');
                    });
                }}
              >
                <label>
                  {t('features.assign')}
                  <select
                    value={assignSlot}
                    disabled={busy}
                    onChange={(event) => setAssignSlot(event.target.value)}
                  >
                    <option value="">{t('features.choose')}</option>
                    {unassigned.map((slot) => (
                      <option key={slot.terminalId} value={String(slot.slot)}>
                        {slot.slot + 1} · {t(`shell.adapters.${slot.provider}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy || !assignSlot}>{t('features.addMember')}</button>
              </form>
            )}
          </div>
        )}
        <div className="feature-feedback" role="status" aria-live="polite">
          {notice
            ? t(`features.${notice}`)
            : busy
              ? t(
                  operation === 'snapshot'
                    ? 'features.loading'
                    : operation === 'select'
                      ? 'features.switching'
                      : 'features.saving',
                )
              : snapshot && !snapshot.layoutSaved
                ? t('features.layoutUnsaved')
                : ''}
        </div>
        <button
          className="feature-refresh"
          disabled={busy || !native}
          onClick={() => void request({ action: 'snapshot' })}
        >
          {t('features.refresh')}
        </button>
      </aside>
      <header className="feature-topbar">
        <strong title={selected?.featureId}>
          {snapshot?.workspace.name ?? t('features.workspace')} /{' '}
          {selected?.name ?? t('features.unassigned')}
        </strong>
        <div>
          <button
            ref={editTrigger}
            disabled={busy || !selected}
            onClick={() => selected && openEditor(selected)}
            title={t('features.edit')}
          >
            ⋯
          </button>
          <button
            disabled={busy || !available.length}
            onClick={() => void request({ action: 'organize', command: 'columns-2' })}
          >
            ▦ {t('features.grid')}
          </button>
          <button
            disabled={busy || !available.length}
            onClick={() => void request({ action: 'organize', command: 'show-all' })}
          >
            ↺ {t('features.restore')}
          </button>
          <button disabled title={t('features.delegationUnavailable')}>
            ↗ {t('features.delegate')}
          </button>
          <button disabled title={t('features.creationUnavailable')}>
            ＋ {t('features.terminal')}
          </button>
        </div>
      </header>
      <div className="feature-surface">
        {!available.length && (
          <p>
            {t(
              selected
                ? selected.terminalIds.length
                  ? 'features.noAvailableMembers'
                  : 'features.empty'
                : 'features.noUnassigned',
            )}
          </p>
        )}
        {!nativeWorkspace && available.length > 0 && (
          <div>
            <p>{t('features.nativeView')}</p>
            <ul>
              {available.map((slot) => (
                <li key={slot.terminalId}>
                  <strong>
                    {slot.slot + 1} · {t(`shell.adapters.${slot.provider}`)}
                  </strong>{' '}
                  <code>{slot.terminalId}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="feature-bottom">
        <span>{t('features.members', { count: members.length })}</span>
        <span>{t('features.metadataOnly')}</span>
      </footer>
    </section>
  );
}
