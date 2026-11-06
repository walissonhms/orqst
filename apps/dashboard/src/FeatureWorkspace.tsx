import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  FeatureNativeRequest,
  FeatureNativeSnapshot,
  FeatureCanvasEvidence,
  WorkspaceFeature,
} from '@orqst/protocol';
import './feature-workspace.css';
import {
  dockGeneration,
  dockPanes,
  workspacePanes,
  type DockPane,
  type WorkspacePane,
} from './feature-workspace-dock.js';
import { TerminalWorkspaceBar, type PaneCommand } from './TerminalWorkspaceBar.js';
import {
  featureNoticeAfterSnapshot,
  featureNoticeContext,
  type FeatureNoticeContext,
} from './feature-notice.js';
import { FeaturePermissions } from './FeaturePermissions.js';
import { quitBlocked, type QuitBlocked } from './quit-notice.js';
import { FeatureCanvas } from './FeatureCanvas.js';
import { CanvasSessionList, CanvasStatusBar } from './FeatureCanvasSummary.js';
import { canvasMembers } from './feature-canvas.js';
import { TerminalStudio } from './TerminalStudio.js';
import { AccountLimits } from './AccountLimits.js';
import { parseAccountLimits, type AccountLimit, type LimitCaps } from './account-limits-model.js';
import {
  arrangeRequest,
  nativeChrome,
  studioTerminals,
  type NativePaneLayout,
} from './studio-native.js';
import type { ArrangementMode } from './terminal-arrangement.js';

type Action = FeatureNativeRequest extends infer R
  ? R extends FeatureNativeRequest
    ? Omit<R, 'contractVersion' | 'generation'>
    : never
  : never;

/** Shared native chrome/Studio metadata UI. Terminals remain retained native documents. */
export function FeatureWorkspace({
  nativeWorkspace = false,
  navigation,
  onPrepare,
  workspaces = [],
  workspaceId = '',
  onWorkspace,
}: {
  nativeWorkspace?: boolean;
  navigation?: ReactNode;
  onPrepare?: (context: { workspaceId: string; featureId: string | null }) => void;
  workspaces?: ReadonlyArray<{ id: string; name: string }>;
  workspaceId?: string;
  onWorkspace?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const [snapshot, setSnapshot] = useState<FeatureNativeSnapshot>();
  const [evidence, setEvidence] = useState<FeatureCanvasEvidence>();
  // Provider-reported limits only; the panel stays hidden until the host reports some.
  const [limits, setLimits] = useState<AccountLimit[]>([]);
  const [limitsOpen, setLimitsOpen] = useState(false);
  /** Last refused native frame, shown so a hidden terminal is never silent. */
  const [arrangeIssue, setArrangeIssue] = useState('');
  // Proven pair communication only; events older than the view are history, not new effects.
  const [communication, setCommunication] = useState<
    {
      id: string;
      from: string;
      to: string;
      kind: 'message' | 'delegation' | 'result';
      at: number;
    }[]
  >([]);
  const [openedAt] = useState(() => Date.now() - 10_000);
  const messages = useMemo(
    () =>
      communication
        .filter((event) => event.at >= openedAt)
        .map(({ id, from, to, kind }) => ({ id, from, to, kind })),
    [communication, openedAt],
  );
  const lastMention = useRef<{ id: string; outcomes: { delivery: string }[] } | null>(null);
  const [limitPrefs, setLimitPrefs] = useState<{ shown?: string[]; caps: LimitCaps }>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('orqst.accountLimits') ?? 'null') as {
        shown?: unknown;
        caps?: { warn?: unknown; critical?: unknown };
      } | null;
      const warn = Number(raw?.caps?.warn);
      const critical = Number(raw?.caps?.critical);
      return {
        ...(Array.isArray(raw?.shown)
          ? { shown: raw.shown.filter((id): id is string => typeof id === 'string') }
          : {}),
        caps:
          warn >= 1 && warn < critical && critical <= 100
            ? { warn, critical }
            : { warn: 60, critical: 85 },
      };
    } catch {
      return { caps: { warn: 60, critical: 85 } };
    }
  });
  const saveLimitPrefs = (next: { shown?: string[]; caps: LimitCaps }) => {
    setLimitPrefs(next);
    try {
      localStorage.setItem('orqst.accountLimits', JSON.stringify(next));
    } catch {
      // The choice still applies to this window.
    }
  };
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<FeatureNativeRequest['action'] | null>(null);
  const [notice, setNotice] = useState('');
  const [dock, setDock] = useState<DockPane[]>([]);
  const [dockEpoch, setDockEpoch] = useState(0);
  const [panes, setPanes] = useState<WorkspacePane[]>([]);
  // The new Studio is the default everywhere; the summary Canvas opens only on request.
  const [nativeCanvas, setNativeCanvas] = useState(false);
  const [wantsCanvas, setWantsCanvas] = useState(false);
  const canvas = wantsCanvas && (!nativeWorkspace || nativeCanvas);
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [renamePane, setRenamePane] = useState<{
    slot: number;
    terminalId: string;
    name: string;
  } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const [quitWait, setQuitWait] = useState<QuitBlocked | null>(null);
  const [quitFence, setQuitFence] = useState(false);
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
  const noticeContext = useRef<FeatureNoticeContext | null>(null);
  const selected = snapshot?.features.find(
    (feature) => feature.featureId === snapshot.activeFeatureId,
  );
  const assigned = snapshot?.features.flatMap((feature) => feature.terminalIds) ?? [];
  const unassigned = snapshot?.slots.filter((slot) => !assigned.includes(slot.terminalId)) ?? [];
  const members = selected ? selected.terminalIds : unassigned.map((slot) => slot.terminalId);
  const available = snapshot?.slots.filter((slot) => members.includes(slot.terminalId)) ?? [];
  const canvasAgents = useMemo(
    () => canvasMembers(snapshot, panes, evidence, now),
    [snapshot, panes, evidence, now],
  );
  const canvasGroups = useMemo(
    () => [
      { id: selected?.featureId ?? 'unassigned', name: selected?.name ?? t('features.unassigned') },
    ],
    [selected, t],
  );

  const studio = !canvas && (nativeWorkspace || !!native);
  const hasSnapshot = !!snapshot;
  const leftCanvas = useRef(false);
  const canvasShown = useRef(false);
  const restoreTimer = useRef<number>(undefined);
  canvasShown.current = !!nativeWorkspace && nativeCanvas && !wantsCanvas;
  useEffect(() => () => window.clearTimeout(restoreTimer.current), []);
  useEffect(() => {
    // Native may present the old summary canvas first; the Studio needs live terminal views.
    if (!canvasShown.current) {
      leftCanvas.current = false;
      window.clearTimeout(restoreTimer.current);
      return;
    }
    const first = snapshot?.slots.find((slot) => members.includes(slot.terminalId));
    if (!first || leftCanvas.current) return;
    leftCanvas.current = true;
    // A restore changes the native presentation, which ends a new terminal's pending
    // opening. Native leaves the canvas by itself when it presents a new terminal, so wait
    // briefly and restore only if the canvas is still shown.
    restoreTimer.current = window.setTimeout(() => {
      if (!canvasShown.current) return;
      void request({
        action: 'pane',
        slot: first.slot,
        terminalId: first.terminalId,
        command: 'restore',
      });
    }, 1500);
  });
  const terminals = useMemo(
    () => (studio ? studioTerminals(snapshot, panes, evidence, now) : []),
    [studio, snapshot, panes, evidence, now],
  );
  // Full-window terminals like the preview; the Feature panel opens on request.
  const [immersive, setImmersive] = useState(() => {
    try {
      return localStorage.getItem('orqst.studio.panel') !== 'open';
    } catch {
      return true;
    }
  });
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;
  const arranging = useRef<{ layout: NativePaneLayout[]; mode: ArrangementMode } | null>(null);
  const arrangeRef = useRef<(layout: NativePaneLayout[], mode: ArrangementMode) => void>(undefined);
  const arrangeRetry = useRef<{ timer?: number; attempt: number }>({ attempt: 0 });
  // Read through a ref: a new terminals array (clock tick, dock event) must not
  // re-create arrange, or the resend effect below would loop with native dock events.
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;
  /** Send the Studio geometry to native views; the bridge keeps only the latest frame. */
  const arrange = useCallback(
    (layout: NativePaneLayout[], mode: ArrangementMode) => {
      arranging.current = { layout, mode };
      const live = current.current;
      if (!native?.arrange || !live) return;
      const resendLatest = (delay: number) => {
        window.clearTimeout(arrangeRetry.current.timer);
        arrangeRetry.current.timer = window.setTimeout(() => {
          const latest = arranging.current;
          if (latest) arrangeRef.current?.(latest.layout, latest.mode);
        }, delay);
      };
      const send = (snapshotNow: FeatureNativeSnapshot, retry: boolean) => {
        // Viewport and members are read at send time, next to the request they describe.
        const chrome = nativeChrome(immersiveRef.current, window.innerWidth);
        const viewport = {
          width: window.innerWidth - chrome.sidebar,
          height: window.innerHeight - chrome.top - chrome.bottom,
        };
        const memberIds = snapshotNow.slots
          .filter((slot) =>
            terminalsRef.current.some((terminal) => terminal.id === slot.terminalId),
          )
          .map((slot) => slot.terminalId);
        return native.arrange!({
          ...arrangeRequest(snapshotNow, memberIds, layout, mode, viewport, chrome),
          contractVersion: 1,
          generation: snapshotNow.generation,
        })
          .then((reply) => {
            if (reply.status === 'ok') {
              window.clearTimeout(arrangeRetry.current.timer);
              arrangeRetry.current.attempt = 0;
              setArrangeIssue('');
              return;
            }
            // Native keeps one frame per 16 ms: resend the latest one shortly after.
            if (reply.status === 'busy') return resendLatest(40);
            // A newer generation hides the views until a matching frame: resend with it.
            if (retry && reply.snapshot && reply.snapshot.generation !== snapshotNow.generation) {
              current.current = reply.snapshot;
              setSnapshot(reply.snapshot);
              void send(reply.snapshot, false);
              return;
            }
            setArrangeIssue(reply.status);
            // Members, presentation or focus may have changed (a new terminal, a resize, a
            // native dialog). Re-read the snapshot so the Studio renders the current members,
            // then keep resending the latest frame with a growing delay.
            if (retry && native) {
              void native
                .request({
                  contractVersion: 1,
                  generation: snapshotNow.generation,
                  action: 'snapshot',
                })
                .then((fresh) => {
                  if (!fresh.snapshot) return;
                  current.current = fresh.snapshot;
                  setSnapshot(fresh.snapshot);
                })
                .catch(() => undefined);
            }
            // Bounded: after 8 timed retries only focus, a click or a new generation resend.
            const attempt = arrangeRetry.current.attempt;
            if (attempt >= 8) return;
            arrangeRetry.current.attempt = attempt + 1;
            resendLatest([300, 600, 1200, 2500, 5000][Math.min(attempt, 4)]!);
          })
          .catch(() => {
            setArrangeIssue('unavailable');
            resendLatest(2500);
          });
      };
      void send(live, true);
    },
    [native],
  );
  arrangeRef.current = arrange;
  useEffect(() => () => window.clearTimeout(arrangeRetry.current.timer), []);
  // Native hides terminal views on every new generation until a matching frame arrives,
  // so the last arrangement is sent again whenever the generation changes.
  // Two counters can hide the views: the metadata generation and the native layout fence
  // (published with the terminal dock state). A change in either resends the frame.
  const generation = snapshot?.generation;
  useEffect(() => {
    if (generation === undefined || !arranging.current) return;
    arrange(arranging.current.layout, arranging.current.mode);
  }, [generation, dockEpoch, arrange]);
  // Native refuses a frame while this document lacks keyboard focus ('denied').
  // Resend the latest frame as soon as focus or a click comes back here.
  useEffect(() => {
    if (!arrangeIssue) return;
    const resend = () => {
      const latest = arranging.current;
      if (latest) arrangeRef.current?.(latest.layout, latest.mode);
    };
    window.addEventListener('focus', resend);
    window.addEventListener('pointerdown', resend, true);
    return () => {
      window.removeEventListener('focus', resend);
      window.removeEventListener('pointerdown', resend, true);
    };
  }, [arrangeIssue]);

  useEffect(() => {
    try {
      localStorage.setItem('orqst.studio.panel', immersive ? 'closed' : 'open');
    } catch {
      // Storage may be unavailable; the choice still applies to this window.
    }
    if (arranging.current) arrange(arranging.current.layout, arranging.current.mode);
    // Only the panel choice triggers a resend; layout changes report themselves.
  }, [immersive]);

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
        if (reply.canvas) setEvidence(reply.canvas);
        if (reply.accountLimits) setLimits(parseAccountLimits(reply.accountLimits.accounts));
        if (reply.mention) lastMention.current = reply.mention;
        if (reply.communication) setCommunication(reply.communication.events);
        if (reply.snapshot) {
          current.current = reply.snapshot;
          setSnapshot(reply.snapshot);
        }
        if (reply.status !== 'ok') {
          noticeContext.current = featureNoticeContext(
            current.current,
            current.current?.activeFeatureId ?? null,
          );
          setNotice(reply.status);
        }
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
        const context = noticeContext.current;
        if (context) setNotice((value) => featureNoticeAfterSnapshot(value, context, incoming));
      }
    };
    window.addEventListener('orqst-feature-state', update);
    return () => {
      live.current = false;
      window.removeEventListener('orqst-feature-state', update);
    };
  }, [request]);
  useEffect(() => {
    // Native and Studio views keep asking: the first read can arrive before the host is
    // ready, and without a snapshot no layout reaches the native terminal views.
    if (!(canvas || nativeWorkspace || studio) || !native) return;
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(
      () => {
        void request({ action: 'snapshot' });
      },
      hasSnapshot ? 4000 : 1500,
    );
    void request({ action: 'snapshot' });
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [canvas, native, request, nativeWorkspace, studio, hasSnapshot]);
  useEffect(() => {
    const blocked = (event: Event) =>
      setQuitWait(quitBlocked((event as CustomEvent<unknown>).detail));
    const fenced = (event: Event) =>
      setQuitFence(Boolean((event as CustomEvent<{ fence?: boolean }>).detail?.fence));
    window.addEventListener('orqst-quit-blocked', blocked);
    window.addEventListener('orqst-terminal-fence', fenced);
    return () => {
      window.removeEventListener('orqst-quit-blocked', blocked);
      window.removeEventListener('orqst-terminal-fence', fenced);
    };
  }, []);
  useEffect(() => {
    if (editor) input.current?.focus();
  }, [editor]);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setDock(dockPanes(detail));
      setDockEpoch(dockGeneration(detail));
      setPanes(workspacePanes(detail));
      if (nativeWorkspace) {
        const shown = (detail as { canvas?: boolean } | null)?.canvas === true;
        setNativeCanvas(shown);
        if (!shown) setWantsCanvas(false);
      }
    };
    window.addEventListener('orqst-terminal-dock', update);
    return () => window.removeEventListener('orqst-terminal-dock', update);
  }, [nativeWorkspace]);
  useEffect(() => {
    if (renamePane) renameInput.current?.focus();
  }, [renamePane?.slot]);

  function paneCommand(slot: number, command: PaneCommand) {
    const member = available.find((entry) => entry.slot === slot);
    if (member) void request({ action: 'pane', slot, terminalId: member.terminalId, command });
  }
  function editPane(slot: number) {
    const member = available.find((entry) => entry.slot === slot);
    if (member)
      setRenamePane({
        slot,
        terminalId: member.terminalId,
        name: panes.find((pane) => pane.slot === slot)?.label ?? '',
      });
  }
  function movePane(slot: number, beforeSlot: number) {
    const member = available.find((entry) => entry.slot === slot);
    const target = available.find((entry) => entry.slot === beforeSlot);
    if (member && target)
      void request({
        action: 'movePane',
        slot,
        terminalId: member.terminalId,
        beforeSlot,
        beforeTerminalId: target.terminalId,
      });
  }

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
  const canPrepare =
    !!onPrepare || (nativeWorkspace && !!native?.showPreparationDrawer && !!snapshot);
  async function prepare() {
    if (working.current) return;
    if (onPrepare) {
      onPrepare({
        workspaceId: snapshot?.workspace.id ?? workspaceId,
        featureId: snapshot?.activeFeatureId ?? null,
      });
      return;
    }
    if (!nativeWorkspace || !native?.showPreparationDrawer || !snapshot) return;
    working.current = true;
    setBusy(true);
    setNotice('');
    try {
      const reply = await native.showPreparationDrawer({
        contractVersion: 1,
        generation: snapshot.generation,
        workspaceId: snapshot.workspace.id,
        featureId: snapshot.activeFeatureId,
        expectedRevision: snapshot.view.revision,
      });
      if (live.current && reply.status !== 'ok') setNotice(reply.status);
    } catch {
      if (live.current) setNotice('unavailable');
    } finally {
      working.current = false;
      if (live.current) setBusy(false);
    }
  }
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key.toLowerCase() === 'n' && canPrepare) {
        event.preventDefault();
        void prepare();
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  });
  return (
    <section
      className={`feature-workspace${nativeWorkspace ? ' feature-native' : ''}${canvas ? ' feature-canvas-mode' : ''}${studio && immersive ? ' studio-immersive' : ''}`}
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
        ) : workspaces.length > 0 ? (
          <label className="feature-project feature-project-select">
            <span>{t('features.workspace')}</span>
            <select
              aria-label={t('features.workspace')}
              value={workspaceId}
              onChange={(event) => onWorkspace?.(event.target.value)}
            >
              <option value="">{t('features.choose')}</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="canvas-search">
          <span>
            {t('canvas.search')} <kbd>⌘K</kbd>
          </span>
          <input
            ref={searchInput}
            aria-label={t('canvas.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="feature-create"
          disabled={busy || !canPrepare}
          onClick={() => void prepare()}
        >
          ＋ {t('canvas.newSession')} <kbd>⌘N</kbd>
        </button>
        <CanvasSessionList
          agents={canvasAgents}
          query={search}
          busy={busy || quitFence}
          onOpen={(agent) => paneCommand(agent.slot, 'focus')}
        />
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
                aria-label={t('features.description')}
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
                aria-label={t('features.status')}
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
          {notice === 'unavailable' && studio && !snapshot
            ? t('terminalStudio.noTerminalsYet')
            : notice
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
        {nativeWorkspace &&
          renamePane &&
          available.some((entry) => entry.terminalId === renamePane.terminalId) && (
            <form
              className="feature-pane-editor"
              onSubmit={(event) => {
                event.preventDefault();
                const editing = renamePane;
                void request({ action: 'renamePane', ...editing }).then((result) => {
                  if (result === 'ok') setRenamePane((value) => (value === editing ? null : value));
                });
              }}
            >
              <label>
                {t('managedTerminal.displayName')}
                <input
                  ref={renameInput}
                  value={renamePane.name}
                  maxLength={48}
                  required
                  onChange={(event) => setRenamePane({ ...renamePane, name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setRenamePane(null);
                  }}
                />
              </label>
              <button disabled={busy} type="submit">
                {t('managedTerminal.rename')}
              </button>{' '}
              <button type="button" onClick={() => setRenamePane(null)}>
                {t('features.cancel')}
              </button>
            </form>
          )}
        {nativeWorkspace && (
          <details className="feature-permissions-disclosure">
            <summary>{t('features.permissions.title')}</summary>
            <FeaturePermissions snapshot={snapshot} feature={selected} />
          </details>
        )}
      </aside>
      <header className="feature-topbar">
        {navigation}
        <strong title={selected?.featureId}>
          {snapshot?.workspace.name ??
            workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
            t('features.workspace')}{' '}
          / {selected?.name ?? t('features.unassigned')}
        </strong>
        <div>
          <button
            ref={editTrigger}
            aria-label={t('features.edit')}
            disabled={busy || !selected}
            onClick={() => selected && openEditor(selected)}
            title={t('features.edit')}
          >
            ⋯
          </button>
          <button
            aria-pressed={canvas}
            disabled={busy || !native || !snapshot}
            onClick={() => {
              if (canvas) {
                setWantsCanvas(false);
                if (nativeWorkspace && available[0]) paneCommand(available[0].slot, 'restore');
                return;
              }
              setWantsCanvas(true);
              if (nativeWorkspace) void request({ action: 'canvas' });
            }}
          >
            {t('canvas.title')}
          </button>
          {!studio && (
            <>
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
            </>
          )}
          <button disabled title={t('features.delegationUnavailable')}>
            ↗ {t('features.delegate')}
          </button>
          <button
            disabled={busy || !canPrepare}
            onClick={() => void prepare()}
            title={t(canPrepare ? 'studio.setupTitle' : 'features.creationUnavailable')}
          >
            ＋ {t('features.terminal')}
          </button>
        </div>
      </header>
      {studio ? (
        <div className="feature-studio">
          <TerminalStudio
            storageKey={`orqst.studio.${snapshot?.workspace.id ?? 'none'}.${selected?.featureId ?? 'unassigned'}`}
            terminals={terminals}
            messages={messages}
            renderBody={(terminal) =>
              nativeWorkspace ? (
                <div className="ts-hole" aria-hidden="true" />
              ) : (
                <div className="ts-open">
                  <button
                    type="button"
                    disabled={busy || quitFence}
                    onClick={() => {
                      const slot = snapshot?.slots.find(
                        (entry) => entry.terminalId === terminal.id,
                      );
                      if (slot) paneCommand(slot.slot, 'focus');
                    }}
                  >
                    {t('terminalStudio.openTerminal')}
                  </button>
                  <span>{terminal.lastActivity ?? t('terminalStudio.noActivity')}</span>
                </div>
              )
            }
            onNewTerminal={canPrepare ? () => void prepare() : undefined}
            {...(studio
              ? {
                  toolbarStart: (
                    <>
                      {navigation}
                      <button
                        type="button"
                        className="ts-panel-toggle"
                        aria-pressed={!immersive}
                        title={t(
                          immersive ? 'terminalStudio.showPanel' : 'terminalStudio.hidePanel',
                        )}
                        aria-label={t(
                          immersive ? 'terminalStudio.showPanel' : 'terminalStudio.hidePanel',
                        )}
                        onClick={() => setImmersive((value) => !value)}
                      >
                        {immersive ? '☰' : '⟨'}
                      </button>
                    </>
                  ),
                  toolbarScopes:
                    immersive && snapshot ? (
                      <nav className="ts-features" aria-label={t('features.heading')}>
                        {snapshot.features.map((feature) => (
                          <button
                            key={feature.featureId}
                            type="button"
                            className={
                              snapshot.activeFeatureId === feature.featureId ? 'active' : ''
                            }
                            aria-pressed={snapshot.activeFeatureId === feature.featureId}
                            disabled={busy}
                            title={feature.description || feature.name}
                            onClick={() =>
                              void request({
                                action: 'select',
                                featureId: feature.featureId,
                                expectedRevision: snapshot.view.revision,
                              })
                            }
                          >
                            {feature.name}
                            <small>{feature.terminalIds.length}</small>
                          </button>
                        ))}
                        {(unassigned.length > 0 || !snapshot.features.length) && (
                          <button
                            type="button"
                            className={!snapshot.activeFeatureId ? 'active' : ''}
                            aria-pressed={!snapshot.activeFeatureId}
                            disabled={busy}
                            onClick={() =>
                              void request({
                                action: 'select',
                                featureId: null,
                                expectedRevision: snapshot.view.revision,
                              })
                            }
                          >
                            {t('features.unassigned')}
                            <small>{unassigned.length}</small>
                          </button>
                        )}
                      </nav>
                    ) : undefined,
                }
              : {})}
            emptyHint={
              !snapshot ? (
                <span className="ts-loading">
                  {notice ? t(`features.${notice}`) : t('features.loading')}
                </span>
              ) : selected && unassigned.length > 0 ? (
                <button
                  type="button"
                  className="ts-ghost"
                  disabled={busy}
                  onClick={() =>
                    void request({
                      action: 'select',
                      featureId: null,
                      expectedRevision: snapshot.view.revision,
                    })
                  }
                >
                  {t('terminalStudio.showUnassigned', { count: unassigned.length })}
                </button>
              ) : undefined
            }
            toolbarEnd={
              <>
                {arrangeIssue && (
                  <span className="ts-arrange-issue" role="status">
                    {arrangeIssue === 'denied'
                      ? t('terminalStudio.arrangeFocus')
                      : t('terminalStudio.arrangeIssue', { status: arrangeIssue })}
                  </span>
                )}
                {limits.length > 0 ? (
                  <AccountLimits
                    accounts={limits}
                    shown={limitPrefs.shown ?? limits.slice(0, 4).map((entry) => entry.id)}
                    caps={limitPrefs.caps}
                    now={now}
                    source={t('accountLimits.sourceApp')}
                    onShownChange={(shown) => saveLimitPrefs({ ...limitPrefs, shown })}
                    onCapsChange={(caps) => saveLimitPrefs({ ...limitPrefs, caps })}
                    onOpenChange={setLimitsOpen}
                    onRefresh={(accountId) =>
                      void request({ action: 'accountLimits', command: 'refresh', accountId })
                    }
                    onToggleLock={(accountId) =>
                      void request({
                        action: 'accountLimits',
                        command: limits.find((entry) => entry.id === accountId)?.locked
                          ? 'unlock'
                          : 'lock',
                        accountId,
                      })
                    }
                  />
                ) : null}
              </>
            }
            // Hide from view only: the process keeps running (Hide ≠ Stop ≠ Terminate).
            onClose={() => 'minimize' as const}
            onMention={async ({ from, to, text }) => {
              // v1 records the attempt; no structured route exists yet, so nothing is delivered.
              lastMention.current = null;
              const status = await request({
                action: 'mention',
                from: from ? { kind: 'terminal', terminalId: from } : { kind: 'user' },
                to,
                text,
              });
              // Set by request() when the reply carries the recorded mention.
              const recorded = lastMention.current as {
                outcomes: { delivery: string }[];
              } | null;
              const outcomes = recorded?.outcomes;
              if (status !== 'ok' || !outcomes) return 'unknown';
              return outcomes.some((outcome) => outcome.delivery === 'denied')
                ? 'denied'
                : 'unsupported';
            }}
            {...(nativeWorkspace
              ? {
                  native: {
                    onLayout: arrange,
                    overlayOpen: !!editor || !!renamePane || quitFence || limitsOpen,
                  },
                }
              : {})}
            onOrchestratorChange={(terminalId) =>
              selected &&
              void request({
                action: 'update',
                featureId: selected.featureId,
                input: {
                  expectedRevision: selected.revision,
                  orchestratorTerminalId: terminalId,
                },
              })
            }
          />
        </div>
      ) : (
        <>
          {canvas ? (
            <nav
              className="feature-terminalbar canvas-feature-tabs"
              aria-label={t('features.heading')}
            >
              {snapshot?.features.map((feature) => (
                <button
                  key={feature.featureId}
                  className={snapshot.activeFeatureId === feature.featureId ? 'active' : ''}
                  aria-pressed={snapshot.activeFeatureId === feature.featureId}
                  disabled={busy}
                  onClick={() =>
                    void request({
                      action: 'select',
                      featureId: feature.featureId,
                      expectedRevision: snapshot.view.revision,
                    })
                  }
                >
                  {feature.name}
                  {canvasAgents.some(
                    (agent) =>
                      agent.featureId === feature.featureId &&
                      agent.session?.status === 'waiting_for_user',
                  ) && (
                    <span
                      className="canvas-attention-dot"
                      aria-label={t('canvas.needs', { count: 1 })}
                    />
                  )}
                </button>
              ))}
              <button
                className={!selected ? 'active' : ''}
                disabled={busy || !snapshot}
                aria-pressed={!selected}
                onClick={() =>
                  snapshot &&
                  void request({
                    action: 'select',
                    featureId: null,
                    expectedRevision: snapshot.view.revision,
                  })
                }
              >
                {t('features.unassigned')}
              </button>
            </nav>
          ) : nativeWorkspace ? (
            <TerminalWorkspaceBar
              panes={panes.filter((pane) => available.some((entry) => entry.slot === pane.slot))}
              busy={busy || quitFence}
              onCommand={paneCommand}
              onRename={editPane}
              onMove={movePane}
              onPrepare={canPrepare ? () => void prepare() : undefined}
            />
          ) : (
            <div className="feature-terminalbar" />
          )}
          <div className="feature-surface">
            {canvas ? (
              <FeatureCanvas
                key={selected?.featureId ?? 'unassigned'}
                agents={canvasAgents.filter((agent) =>
                  agent.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                )}
                groups={canvasGroups}
                busy={busy || quitFence}
                onOpen={(agent) => paneCommand(agent.slot, 'focus')}
                onPrepare={canPrepare ? () => void prepare() : undefined}
              />
            ) : canPrepare && !available.length ? (
              <div className="feature-empty">
                <h1>{t('studio.setupTitle')}</h1>
                <p>{t('features.noUnassigned')}</p>
                <button disabled={busy} onClick={() => void prepare()}>
                  {t('studio.prepareTerminals')}
                </button>
              </div>
            ) : !available.length ? (
              <p>
                {t(
                  selected
                    ? selected.terminalIds.length
                      ? 'features.noAvailableMembers'
                      : 'features.empty'
                    : 'features.noUnassigned',
                )}
              </p>
            ) : null}
            {!canvas && !nativeWorkspace && available.length > 0 && (
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
            {canvas ? (
              <CanvasStatusBar agents={canvasAgents} connected={!!snapshot && !notice && !busy} />
            ) : nativeWorkspace && dock.length > 0 ? (
              <div className="feature-dock" role="region" aria-label={t('features.dockLabel')}>
                <span className="feature-dock-label">{t('features.dockLabel')}</span>
                {dock
                  .filter((pane) => available.some((entry) => entry.slot === pane.slot))
                  .map((pane) => (
                    <button
                      key={pane.slot}
                      type="button"
                      disabled={busy || quitFence}
                      onClick={() => void window.orqstTerminalDock?.restore(pane.slot, dockEpoch)}
                      title={t('features.dockRestore', { name: pane.label })}
                    >
                      ▣ {pane.label}
                    </button>
                  ))}
              </div>
            ) : (
              <span>{t('features.members', { count: members.length })}</span>
            )}
            <span>
              {t(snapshot?.layoutSaved ? 'features.layoutSaved' : 'features.layoutUnsaved')}
            </span>
          </footer>
        </>
      )}
      {(quitWait || quitFence) && (
        <div className="quit-blocked" role="alert">
          <strong>{t(quitFence ? 'quitBlocked.fence' : 'quitBlocked.title')}</strong>
          {quitWait && (
            <>
              <span>{t(`quitBlocked.${quitWait.reason}`)}</span>
              {quitWait.uncertain.length > 0 && (
                <ul>
                  {quitWait.uncertain.map((entry) => (
                    <li key={entry.slot}>{`${entry.slot}: ${entry.reason}`}</li>
                  ))}
                </ul>
              )}
              <span>{t('quitBlocked.retry')}</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
