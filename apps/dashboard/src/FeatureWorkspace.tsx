import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Bell, Folder, Search, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  defaultFeatureId,
  featureDisplayName,
  type FeatureNativeRequest,
  type FeatureDashboardDestination,
  type FeatureNativeReply,
  type FeatureNativeSnapshot,
  type FeatureCanvasEvidence,
  type WorkspaceFeature,
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
import { StructuredAgents } from './StructuredAgents.js';
import { quitBlocked, type QuitBlocked } from './quit-notice.js';
import { FeatureCanvas } from './FeatureCanvas.js';
import { CanvasSessionList, CanvasStatusBar } from './FeatureCanvasSummary.js';
import { canvasMembers } from './feature-canvas.js';
import { TerminalStudio, type StudioLayoutControls } from './TerminalStudio.js';
import { AccountLimits } from './AccountLimits.js';
import { FeatureDelegate, type FeatureDelegateProps, type MentionSend } from './MentionComposer.js';
import type { StudioCreationScope } from './StudioWorkspace.js';
import { parseAccountLimits, type AccountLimit, type LimitCaps } from './account-limits-model.js';
import {
  arrangeRequest,
  studioTerminals,
  nativeChrome,
  type NativePaneLayout,
} from './studio-native.js';
import type { ArrangementMode } from './terminal-arrangement.js';

type Action = FeatureNativeRequest extends infer R
  ? R extends FeatureNativeRequest
    ? Omit<R, 'contractVersion' | 'generation'>
    : never
  : never;

function featureScopeKey(snapshot: FeatureNativeSnapshot | undefined, workspaceId = '') {
  return JSON.stringify([snapshot?.workspace.id ?? workspaceId, snapshot?.activeFeatureId]);
}

/** Shared native chrome/Studio metadata UI. Terminals remain retained native documents. */
export function FeatureWorkspace({
  nativeWorkspace = false,
  navigation,
  toolbarUtilities,
  onPrepare,
  workspaces = [],
  workspaceId = '',
}: {
  nativeWorkspace?: boolean;
  navigation?: ReactNode;
  toolbarUtilities?: ReactNode;
  onPrepare?: (context: StudioCreationScope) => void;
  workspaces?: ReadonlyArray<{ id: string; name: string }>;
  workspaceId?: string;
  onWorkspace?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const [snapshot, setSnapshot] = useState<FeatureNativeSnapshot>();
  const [evidence, setEvidence] = useState<FeatureCanvasEvidence>();
  // Provider-reported limits only; the panel stays hidden until the host reports some.
  const [limits, setLimits] = useState<AccountLimit[]>([]);
  const [, setLimitsOpen] = useState(false);
  /** Last refused native frame, shown so a hidden terminal is never silent. */
  const [arrangeIssue, setArrangeIssue] = useState('');
  const [closeIssue, setCloseIssue] = useState(false);
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
  const [notice, setNotice] = useState('');
  const [dock, setDock] = useState<DockPane[]>([]);
  const [dockEpoch, setDockEpoch] = useState(0);
  const [panes, setPanes] = useState<WorkspacePane[]>([]);
  // The new Studio is the default everywhere; the summary Canvas opens only on request.
  const [nativeCanvas, setNativeCanvas] = useState(false);
  const [wantsCanvas, setWantsCanvas] = useState(false);
  const canvasIntent = useRef(wantsCanvas);
  canvasIntent.current = wantsCanvas;
  const canvas = wantsCanvas && (!nativeWorkspace || nativeCanvas);
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const scopeTree = useRef<HTMLElement>(null);
  const [coreState, setCoreState] = useState<'connecting' | 'online' | 'unavailable'>(
    native ? 'connecting' : 'unavailable',
  );
  const [renamePane, setRenamePane] = useState<{
    slot: number;
    terminalId: string;
    name: string;
  } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const [quitWait, setQuitWait] = useState<QuitBlocked | null>(null);
  // Native announces Quit as soon as it starts closing the owned terminals.
  const [quitClosing, setQuitClosing] = useState(false);
  const [quitFence, setQuitFence] = useState(false);
  const [editor, setEditor] = useState<WorkspaceFeature | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<WorkspaceFeature['status']>('planned');
  const [assignSlot, setAssignSlot] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnEditorFocus = useRef<'create' | 'edit' | null>(null);
  const live = useRef(true);
  const working = useRef(false);
  // When the shared latch was taken; a request without an answer for 20 s releases it.
  const workingSince = useRef(0);
  const latchBusy = () => working.current && Date.now() - workingSince.current < 20_000;
  // New terminal feedback that snapshot polling does not clear.
  const [prepareIssue, setPrepareIssue] = useState('');
  const preparing = useRef(false);
  // While the New terminal dialog shows in the main document, this hidden document must not
  // resend frames: an accepted frame resumes the native views over the dialog.
  const drawerOpenAt = useRef(0);
  const drawerOpen = () => drawerOpenAt.current > 0 && Date.now() - drawerOpenAt.current < 60_000;
  const editorVersion = useRef(0);
  const current = useRef<FeatureNativeSnapshot | undefined>(undefined);
  const noticeContext = useRef<FeatureNoticeContext | null>(null);
  const acceptSnapshot = useCallback((incoming: FeatureNativeSnapshot) => {
    if (current.current && incoming.generation < current.current.generation) return false;
    current.current = incoming;
    setSnapshot(incoming);
    setCoreState('online');
    return true;
  }, []);
  const selected = snapshot?.features.find(
    (feature) => feature.featureId === snapshot.activeFeatureId,
  );
  const assigned = snapshot?.features.flatMap((feature) => feature.terminalIds) ?? [];
  const unassigned =
    snapshot?.slots.filter((slot) => !slot.closed && !assigned.includes(slot.terminalId)) ?? [];
  const members = selected ? selected.terminalIds : unassigned.map((slot) => slot.terminalId);
  const available =
    snapshot?.slots.filter((slot) => !slot.closed && members.includes(slot.terminalId)) ?? [];
  const displayFeatureName = useCallback(
    (feature: Pick<WorkspaceFeature, 'workspaceId' | 'featureId' | 'name'>) =>
      featureDisplayName(feature, t('features.defaultName')),
    [t],
  );
  const canvasAgents = useMemo(
    () => canvasMembers(snapshot, panes, evidence, now),
    [snapshot, panes, evidence, now],
  );
  const canvasGroups = useMemo(
    () => [
      {
        id: selected?.featureId ?? 'unassigned',
        name: selected ? displayFeatureName(selected) : t('features.unassigned'),
      },
    ],
    [selected, displayFeatureName, t],
  );
  const moveTargets = useMemo(() => {
    if (!snapshot) return [];
    const eligible = snapshot.features
      .filter((feature) => feature.status !== 'archived' && feature.terminalIds.length < 8)
      .map((feature) => ({
        id: feature.featureId,
        name: displayFeatureName(feature),
        expectedRevision: feature.revision,
      }));
    if (eligible.length > 0) return eligible;
    const defaultId = defaultFeatureId(snapshot.workspace.id);
    const existingDefault = snapshot.features.find((feature) => feature.featureId === defaultId);
    if (existingDefault && existingDefault.terminalIds.length >= 8) return [];
    return [
      {
        id: defaultId,
        name: existingDefault ? displayFeatureName(existingDefault) : t('features.defaultName'),
        expectedRevision: existingDefault?.revision ?? 1,
      },
    ];
  }, [snapshot, displayFeatureName, t]);

  const studio = !canvas && (nativeWorkspace || !!native);
  const [structuredFeature, setStructuredFeature] = useState<string>();
  const structured = nativeWorkspace ? window.orqstStructuredAgents : undefined;
  const structuredOpen =
    !!selected &&
    selected.status !== 'archived' &&
    structuredFeature === selected.featureId &&
    !!structured &&
    !!snapshot;

  const hasSnapshot = !!snapshot;
  const terminals = useMemo(
    () => (studio ? studioTerminals(snapshot, panes, evidence, now) : []),
    [studio, snapshot, panes, evidence, now],
  );
  const measuredTerminals = terminals.flatMap(({ tokens }) =>
    tokens?.total === undefined ? [] : [tokens.total],
  );
  const featureTokens = measuredTerminals.reduce((sum, total) => sum + total, 0);
  const scopeKey = featureScopeKey(snapshot, workspaceId);
  const studioRef = useRef<HTMLDivElement>(null);
  const layoutControls = useRef<StudioLayoutControls>(null);
  const focusedTerminals = useRef(new Map<string, string>());
  const arranging = useRef<{
    layout: NativePaneLayout[];
    mode: ArrangementMode;
    scope: string;
  } | null>(null);
  const arrangeRef =
    useRef<(layout: NativePaneLayout[], mode: ArrangementMode, scope: string) => void>(undefined);
  const arrangeRetry = useRef<{ timer?: number; attempt: number }>({ attempt: 0 });
  // Read through a ref: a new terminals array (clock tick, dock event) must not
  // re-create arrange, or the resend effect below would loop with native dock events.
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;
  /** Send the Studio geometry to native views; the bridge keeps only the latest frame. */
  const arrange = useCallback(
    (layout: NativePaneLayout[], mode: ArrangementMode, frameScope: string) => {
      const snapshot = current.current;
      if (!native?.arrange || !snapshot || drawerOpen() || canvasIntent.current) return;
      if (featureScopeKey(snapshot) !== frameScope) return;
      const submitted = { layout, mode, scope: frameScope };
      arranging.current = submitted;
      const resendLatest = (delay: number) => {
        window.clearTimeout(arrangeRetry.current.timer);
        arrangeRetry.current.timer = window.setTimeout(() => {
          const latest = arranging.current;
          if (latest && latest.scope === frameScope)
            arrangeRef.current?.(latest.layout, latest.mode, latest.scope);
        }, delay);
      };
      const send = (snapshotNow: FeatureNativeSnapshot) => {
        // Viewport and members are read at send time, next to the request they describe.
        if (featureScopeKey(snapshotNow) !== frameScope) return;
        const chrome = nativeChrome(false, window.innerWidth, 'v6');
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
            if (
              !live.current ||
              arranging.current !== submitted ||
              featureScopeKey(current.current) !== frameScope
            )
              return;
            if (reply.status === 'ok') {
              window.clearTimeout(arrangeRetry.current.timer);
              arrangeRetry.current.attempt = 0;
              setArrangeIssue('');
              return;
            }
            // Native keeps one frame per 16 ms: resend the latest one shortly after.
            if (reply.status === 'busy') return resendLatest(40);
            // A newer generation hides the views until a matching frame: resend with it.
            if (
              reply.snapshot &&
              reply.snapshot.generation > snapshotNow.generation &&
              acceptSnapshot(reply.snapshot)
            )
              return;
            setArrangeIssue(reply.status);
            // Members, presentation or focus may have changed (a new terminal, a resize, a
            // native dialog). Re-read the snapshot so the Studio renders the current members,
            // then keep resending the latest frame with a growing delay.
            if (native) {
              void native
                .request({
                  contractVersion: 1,
                  generation: snapshotNow.generation,
                  action: 'snapshot',
                })
                .then((fresh) => {
                  if (fresh.snapshot) acceptSnapshot(fresh.snapshot);
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
            if (!live.current || arranging.current !== submitted) return;
            setArrangeIssue('unavailable');
            if (arrangeRetry.current.attempt < 8) {
              arrangeRetry.current.attempt++;
              resendLatest(2500);
            }
          });
      };
      void send(snapshot);
    },
    [native, acceptSnapshot],
  );
  arrangeRef.current = arrange;
  useEffect(() => () => window.clearTimeout(arrangeRetry.current.timer), []);
  // Native hides terminal views on every new generation until a matching frame arrives,
  // so the last arrangement is sent again whenever the generation changes.
  // Two counters can hide the views: the metadata generation and the native layout fence
  // (published with the terminal dock state). A change in either resends the frame.
  const generation = snapshot?.generation;
  useEffect(() => {
    const latest = arranging.current;
    if (generation === undefined || !latest || latest.scope !== scopeKey || !studio) return;
    arrange(latest.layout, latest.mode, latest.scope);
  }, [generation, dockEpoch, arrange, scopeKey, studio]);
  // A new terminal joined while the dialog was open: its frame brings the views back.
  const memberCount = snapshot?.slots.length ?? 0;
  const lastMemberCount = useRef(memberCount);
  useEffect(() => {
    if (memberCount > lastMemberCount.current && drawerOpenAt.current) {
      drawerOpenAt.current = 0;
      const latest = arranging.current;
      if (latest) arrangeRef.current?.(latest.layout, latest.mode, latest.scope);
    }
    lastMemberCount.current = memberCount;
  }, [memberCount]);
  // The dialog closed and native shows this document again (or the owner is back in it).
  useEffect(() => {
    const back = () => {
      if (!drawerOpenAt.current || document.visibilityState === 'hidden') return;
      drawerOpenAt.current = 0;
      const latest = arranging.current;
      if (latest) arrangeRef.current?.(latest.layout, latest.mode, latest.scope);
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pointerdown', back, true);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pointerdown', back, true);
    };
  }, []);
  // Native refuses a frame while this document lacks keyboard focus ('denied').
  // Resend the latest frame as soon as focus or a click comes back here.
  useEffect(() => {
    if (!arrangeIssue) return;
    const resend = () => {
      const latest = arranging.current;
      if (latest) arrangeRef.current?.(latest.layout, latest.mode, latest.scope);
    };
    window.addEventListener('focus', resend);
    window.addEventListener('pointerdown', resend, true);
    return () => {
      window.removeEventListener('focus', resend);
      window.removeEventListener('pointerdown', resend, true);
    };
  }, [arrangeIssue]);

  const request = useCallback(
    async (action: Action, onAccepted?: (reply: FeatureNativeReply) => void) => {
      if (!native || latchBusy()) return;
      working.current = true;
      workingSince.current = Date.now();
      setBusy(true);
      if (action.action !== 'snapshot') setNotice('');
      const readsLimits = ['accountLimits', 'snapshot', 'canvas'].includes(action.action);
      try {
        const reply = await native.request({
          ...action,
          contractVersion: 1,
          generation: current.current?.generation ?? 0,
        } as FeatureNativeRequest);
        if (!live.current) return;
        if (reply.canvas) setEvidence(reply.canvas);
        if (
          reply.accountLimits ||
          action.action === 'accountLimits' ||
          ((action.action === 'snapshot' || action.action === 'canvas') && reply.status === 'ok')
        )
          setLimits(parseAccountLimits(reply.accountLimits?.accounts));
        if (reply.communication) setCommunication(reply.communication.events);
        const accepted = reply.snapshot && acceptSnapshot(reply.snapshot);
        if (action.action === 'snapshot' && reply.status === 'unavailable')
          setCoreState('unavailable');
        if (reply.status === 'ok' && accepted) onAccepted?.(reply);
        if (
          reply.status !== 'ok' &&
          reply.status !== 'cancelled' &&
          action.action !== 'snapshot' &&
          !(action.action === 'pane' && action.command === 'close')
        ) {
          noticeContext.current = featureNoticeContext(
            current.current,
            current.current?.activeFeatureId ?? null,
          );
          setNotice(reply.status);
        }
        return reply.status;
      } catch {
        if (live.current) {
          if (readsLimits) setLimits([]);
          if (action.action === 'snapshot') setCoreState('unavailable');
          else setNotice('unavailable');
        }
        return 'unavailable';
      } finally {
        working.current = false;
        if (live.current) {
          setBusy(false);
        }
      }
    },
    [native, acceptSnapshot],
  );

  // The main document receives the creator's cancel event after native suspended the
  // sibling webviews. Keep that presentation recovery separate from scope switches.
  useEffect(() => {
    if (nativeWorkspace) return;
    const closed = () => {
      const activePane = panes.find((pane) => pane.active);
      const target = available.find((slot) => slot.slot === activePane?.slot) ?? available[0];
      if (target)
        void request({
          action: 'pane',
          slot: target.slot,
          terminalId: target.terminalId,
          command: 'restore',
        });
    };
    window.addEventListener('orqst-terminal-creator-closed', closed);
    return () => window.removeEventListener('orqst-terminal-creator-closed', closed);
  });

  useEffect(() => {
    live.current = true;
    void request({ action: 'snapshot' });
    const update = (event: Event) => {
      const incoming = (event as CustomEvent<FeatureNativeSnapshot>).detail;
      // The native client validates this event before dispatching it. Older ACKs are inert.
      if (acceptSnapshot(incoming)) {
        const context = noticeContext.current;
        if (context) setNotice((value) => featureNoticeAfterSnapshot(value, context, incoming));
      }
    };
    window.addEventListener('orqst-feature-state', update);
    return () => {
      live.current = false;
      window.removeEventListener('orqst-feature-state', update);
    };
  }, [request, acceptSnapshot]);
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
    const blocked = (event: Event) => {
      setQuitClosing(false);
      setQuitWait(quitBlocked((event as CustomEvent<unknown>).detail));
    };
    const fenced = (event: Event) => {
      const fence = Boolean((event as CustomEvent<{ fence?: boolean }>).detail?.fence);
      if (!fence) setQuitClosing(false);
      setQuitFence(fence);
    };
    const closing = () => {
      setQuitWait(null);
      setQuitClosing(true);
    };
    window.addEventListener('orqst-quit-blocked', blocked);
    window.addEventListener('orqst-terminal-fence', fenced);
    window.addEventListener('orqst-quit-closing', closing);
    return () => {
      window.removeEventListener('orqst-quit-blocked', blocked);
      window.removeEventListener('orqst-terminal-fence', fenced);
      window.removeEventListener('orqst-quit-closing', closing);
    };
  }, []);
  useEffect(() => {
    if (editor) input.current?.focus();
  }, [editor]);
  useEffect(() => {
    if (editor || busy || !returnEditorFocus.current) return;
    (returnEditorFocus.current === 'create' ? createTrigger : editTrigger).current?.focus();
    returnEditorFocus.current = null;
  }, [editor, busy]);

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

  async function moveUnassignedTerminal(terminalId: string, featureId: string) {
    const member = unassigned.find((entry) => entry.terminalId === terminalId);
    const target = moveTargets.find((entry) => entry.id === featureId);
    if (!member || !target) return;
    const status = await request({
      action: 'assign',
      featureId: target.id,
      slot: member.slot,
      expectedRevision: target.expectedRevision,
    });
    const next = current.current;
    if (status !== 'ok' || !next || next.activeFeatureId !== null) return;
    const nextAssigned = new Set(next.features.flatMap((entry) => entry.terminalIds));
    const remainingUnassigned = next.slots.some(
      (entry) => !entry.closed && !nextAssigned.has(entry.terminalId),
    );
    if (!remainingUnassigned) {
      await request({
        action: 'select',
        featureId: target.id,
        expectedRevision: next.view.revision,
      });
    }
  }
  const [focusScope, setFocusScope] = useState<{ featureId: string | null; workspace?: boolean }>();
  useEffect(() => {
    if (!focusScope || busy) return;
    if (snapshot?.activeFeatureId !== focusScope.featureId) {
      setFocusScope(undefined);
      return;
    }
    const terminalId = focusedTerminals.current.get(scopeKey);
    const target =
      terminalId &&
      studioRef.current?.querySelector<HTMLElement>(
        `.ts-body[data-terminal-id="${CSS.escape(terminalId)}"] .ts-open button`,
      );
    const scope = focusScope.workspace
      ? '[data-managed-workspace]'
      : '[data-feature-scope][aria-current="true"]';
    (target || scopeTree.current?.querySelector<HTMLElement>(scope))?.focus();
    setFocusScope(undefined);
  }, [busy, focusScope, scopeKey, snapshot?.activeFeatureId]);

  async function selectScope(featureId: string | null, workspace = false) {
    const latest = current.current;
    if (!latest) return false;
    if (latest.activeFeatureId !== featureId) {
      const result = await request({
        action: 'select',
        featureId,
        expectedRevision: latest.view.revision,
      });
      if (result !== 'ok') return false;
      setPrepareIssue('');
      setCloseIssue(false);
    }
    setWantsCanvas(false);
    setFocusScope({ featureId, workspace });
    return true;
  }

  function openEditor(feature: WorkspaceFeature | 'new') {
    editorVersion.current++;
    setEditor(feature);
    setName(feature === 'new' ? '' : displayFeatureName(feature));
    setDescription(feature === 'new' ? '' : feature.description);
    setStatus(feature === 'new' ? 'planned' : feature.status);
  }
  function closeEditor() {
    editorVersion.current++;
    returnEditorFocus.current = editor === 'new' ? 'create' : 'edit';
    setEditor(null);
  }
  async function save() {
    if (!editor || !canWrite) return;
    const version = editorVersion.current;
    const before = current.current;
    const input = { name: name.trim(), description, status };
    let created: string | undefined;
    const result = await request(
      editor === 'new'
        ? { action: 'create', input }
        : {
            action: 'update',
            featureId: editor.featureId,
            input: { ...input, expectedRevision: editor.revision },
          },
      ({ snapshot: after }) => {
        if (
          editor !== 'new' ||
          !before ||
          !after ||
          before.workspace.id !== after.workspace.id ||
          before.view.revision !== after.view.revision
        )
          return;
        const known = new Set(before.features.map(({ featureId }) => featureId));
        const matches = after.features.filter(
          (feature) =>
            !known.has(feature.featureId) &&
            feature.name === input.name &&
            feature.description === input.description &&
            feature.status === input.status,
        );
        if (matches.length === 1) created = matches[0]?.featureId;
      },
    );
    if (result === 'ok' && version === editorVersion.current) {
      closeEditor();
      if (created) await selectScope(created);
    }
  }
  const canWrite = coreState === 'online' && !!snapshot && !quitFence;
  const canPrepare =
    !quitFence &&
    selected?.status !== 'archived' &&
    (!!onPrepare || (canWrite && nativeWorkspace && !!native?.showPreparationDrawer));
  // The New terminal dialog has its own latch: snapshot polling must not refuse the click.
  async function prepare() {
    if (preparing.current) {
      setPrepareIssue('busy');
      return;
    }
    setPrepareIssue('');
    if (onPrepare) {
      onPrepare({
        workspaceId: snapshot?.workspace.id ?? workspaceId,
        featureId: snapshot?.activeFeatureId ?? null,
        workspaceName: snapshot?.workspace.name,
        featureName: selected ? displayFeatureName(selected) : undefined,
      });
      return;
    }
    if (!nativeWorkspace || !native?.showPreparationDrawer || !snapshot) {
      setPrepareIssue('unavailable');
      return;
    }
    preparing.current = true;
    setNotice('');
    try {
      const reply = await native.showPreparationDrawer({
        contractVersion: 1,
        generation: snapshot.generation,
        workspaceId: snapshot.workspace.id,
        featureId: snapshot.activeFeatureId,
        expectedRevision: snapshot.view.revision,
      });
      if (live.current && reply.status === 'ok') drawerOpenAt.current = Date.now();
      if (live.current && reply.status !== 'ok') {
        setNotice(reply.status);
        setPrepareIssue(reply.status);
      }
    } catch {
      if (live.current) {
        setNotice('unavailable');
        setPrepareIssue('unavailable');
      }
    } finally {
      preparing.current = false;
    }
  }
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'k' && canvas) {
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
  const workspaceCatalog = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  if (snapshot) workspaceCatalog.set(snapshot.workspace.id, snapshot.workspace);
  async function openDashboard(destination: FeatureDashboardDestination) {
    if (!snapshot || !native?.showDashboard || preparing.current || quitFence) return;
    preparing.current = true;
    setPrepareIssue('');
    try {
      const reply = await native.showDashboard({
        contractVersion: 1,
        generation: snapshot.generation,
        workspaceId: snapshot.workspace.id,
        featureId: snapshot.activeFeatureId,
        expectedRevision: snapshot.view.revision,
        destination,
      });
      if (reply.status !== 'ok') setPrepareIssue('navigationUnavailable');
    } catch {
      setPrepareIssue('navigationUnavailable');
    } finally {
      preparing.current = false;
    }
  }
  const dashboardEntries = [
    ['overview', 'shell.views.overview', Activity],
    ['workspaces', 'shell.views.workspaces', Folder],
    ['settings', 'shell.views.settings', Settings2],
    ['search', 'shell.palette.title', Search],
    ['notifications', 'notifications', Bell],
  ] as const;
  const nativeNavigation = nativeWorkspace && native?.showDashboard && (
    <nav aria-label={t('analytics.navigation')} className="studio-route-links">
      {dashboardEntries.map(([destination, key, Icon]) => (
        <button
          key={destination}
          type="button"
          className="icon-button feature-nav-control"
          aria-label={t(key)}
          title={t(key)}
          disabled={!snapshot || quitFence}
          onClick={() => void openDashboard(destination)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
  const gridReason = t('feature.noLayout');
  const mentionScope =
    snapshot && selected
      ? { workspaceId: snapshot.workspace.id, featureId: selected.featureId }
      : null;
  const sendMention: FeatureDelegateProps['onSend'] = async (scope, { from, to, text }) => {
    const latest = current.current;
    const feature = latest?.features.find(({ featureId }) => featureId === scope.featureId);
    if (
      !latest ||
      latest.workspace.id !== scope.workspaceId ||
      latest.activeFeatureId !== scope.featureId ||
      !feature ||
      feature.status === 'archived' ||
      quitFence ||
      coreState !== 'online'
    )
      return 'denied';
    const members = new Set(
      latest.slots
        .filter((slot) => !slot.closed && feature.terminalIds.includes(slot.terminalId))
        .map((slot) => slot.terminalId),
    );
    if (
      !to.length ||
      new Set(to).size !== to.length ||
      to.some((id) => !members.has(id)) ||
      (from && !members.has(from))
    )
      return 'denied';

    let outcomes: NonNullable<FeatureNativeReply['mention']>['outcomes'] | undefined;
    const status = await request(
      {
        action: 'mention',
        from: from ? { kind: 'terminal', terminalId: from } : { kind: 'user' },
        to,
        text,
      },
      (reply) => {
        if (
          reply.snapshot?.workspace.id === scope.workspaceId &&
          reply.snapshot.activeFeatureId === scope.featureId
        )
          outcomes = reply.mention?.outcomes;
      },
    );
    if (status === 'denied') return 'denied';
    if (
      status !== 'ok' ||
      !outcomes ||
      outcomes.length !== to.length ||
      new Set(outcomes.map(({ terminalId }) => terminalId)).size !== to.length ||
      outcomes.some(({ terminalId }) => !to.includes(terminalId))
    )
      return 'unknown';
    if (outcomes.every(({ delivery }) => delivery === 'queued')) return 'queued';
    if (outcomes.every(({ delivery }) => delivery === 'denied')) return 'denied';
    if (outcomes.every(({ delivery }) => delivery === 'unsupported')) return 'unsupported';
    return 'unknown';
  };
  const prepareReason = t(
    selected?.status === 'archived' ? 'feature.archived' : 'features.creationUnavailable',
  );
  const breadcrumb = (
    <strong className="feature-crumb" title={selected?.featureId}>
      <span aria-hidden="true">◈ </span>
      {snapshot?.workspace.name ??
        workspaceCatalog.get(workspaceId)?.name ??
        t('features.workspace')}
      {selected ? ` / ${displayFeatureName(selected)}` : ''}
    </strong>
  );
  const layoutActions = (onGrid: () => void, onRestore: () => void) => (
    <>
      <button
        type="button"
        className="feature-action feature-grid"
        aria-disabled={!available.length || busy || quitFence}
        title={!available.length ? gridReason : undefined}
        onClick={() => {
          if (available.length && !busy && !quitFence) onGrid();
        }}
      >
        <span aria-hidden="true">▦ </span>
        {t('features.grid')}
      </button>
      <button
        type="button"
        className="feature-action feature-restore"
        aria-disabled={!available.length || busy || quitFence}
        title={!available.length ? t('feature.noRestore') : undefined}
        onClick={() => {
          if (available.length && !busy && !quitFence) onRestore();
        }}
      >
        <span aria-hidden="true">↺ </span>
        {t('features.restore')}
      </button>
    </>
  );
  const actions = (
    <>
      <FeatureDelegate
        scope={mentionScope}
        terminals={terminals}
        onSend={sendMention}
        disabled={!canWrite || selected?.status === 'archived'}
      />
      <button
        type="button"
        className="feature-action feature-add-terminal"
        aria-disabled={!canPrepare}
        onClick={() => {
          if (canPrepare) void prepare();
        }}
        title={canPrepare ? t('studio.setupTitle') : prepareReason}
      >
        {t('feature.addTerminal')}
      </button>
    </>
  );
  return (
    <section
      className={`feature-workspace${nativeWorkspace ? ' feature-native' : ''}${canvas ? ' feature-canvas-mode' : ''}`}
      aria-label={t('features.workspace')}
    >
      <aside className="feature-sidebar" ref={scopeTree}>
        <div className="feature-brand">
          <img
            src={nativeWorkspace ? 'orqst-features://local/logo.svg' : '/brand/orqst-logo-dark.svg'}
            alt={t('brand')}
            width={117}
            height={36}
          />
        </div>
        <div className="feature-tree">
          <h2 id="feature-workspaces-heading">{t('features.workspaces')}</h2>
          <nav aria-labelledby="feature-workspaces-heading">
            {[...workspaceCatalog.values()].map((workspace) => {
              const managed = workspace.id === snapshot?.workspace.id;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className="feature-scope"
                  data-managed-workspace={managed || undefined}
                  aria-current={managed || undefined}
                  aria-disabled={!managed || !canWrite || busy}
                  title={
                    managed
                      ? workspace.name
                      : t('feature.workspace.unmanaged', { name: workspace.name })
                  }
                  onClick={() => {
                    if (managed && canWrite && !busy) void selectScope(null, true);
                  }}
                >
                  <span>{workspace.name}</span>
                  <small>{managed ? snapshot.features.length : '—'}</small>
                </button>
              );
            })}
            <button
              type="button"
              className="feature-create"
              aria-disabled="true"
              title={t('feature.workspace.creationUnavailable')}
            >
              {t('feature.workspace.create')}
            </button>
          </nav>
          <h2 id="feature-tree-heading">{t('features.heading')}</h2>
          <nav aria-labelledby="feature-tree-heading">
            {snapshot?.features.map((feature) => {
              const label = displayFeatureName(feature);
              return (
                <button
                  key={feature.featureId}
                  type="button"
                  className="feature-scope"
                  data-feature-scope={feature.featureId}
                  aria-current={snapshot.activeFeatureId === feature.featureId || undefined}
                  aria-disabled={!canWrite || busy}
                  title={
                    feature.status === 'archived'
                      ? t('feature.archivedName', { name: label })
                      : feature.description || label
                  }
                  onClick={() => {
                    if (canWrite && !busy) void selectScope(feature.featureId);
                  }}
                >
                  <span>
                    {label}
                    {feature.status === 'archived' && ' · ' + t('features.status_archived')}
                  </span>
                  <small>{feature.terminalIds.length}</small>
                </button>
              );
            })}
            {snapshot && unassigned.length > 0 && (
              <button
                type="button"
                className="feature-scope"
                data-feature-scope="unassigned"
                aria-current={snapshot.activeFeatureId === null || undefined}
                aria-disabled={!canWrite || busy}
                onClick={() => {
                  if (canWrite && !busy) void selectScope(null);
                }}
              >
                <span>{t('features.unassigned')}</span>
                <small>{unassigned.length}</small>
              </button>
            )}
            <button
              type="button"
              ref={createTrigger}
              className="feature-create"
              aria-disabled={busy || !canWrite}
              title={canWrite ? undefined : t('feature.coreRequired')}
              onClick={() => {
                if (canWrite && !busy) openEditor('new');
              }}
            >
              ＋ {t('features.create')}
            </button>
          </nav>
          {canvas && (
            <>
              <label className="canvas-search">
                <span>
                  {t('canvas.search')} <kbd>⌘K</kbd>
                </span>
                <input
                  ref={searchInput}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <CanvasSessionList
                agents={canvasAgents}
                query={search}
                busy={busy || quitFence}
                onOpen={(agent) => paneCommand(agent.slot, 'focus')}
              />
            </>
          )}
          {editor && (
            <form
              className="feature-editor"
              aria-label={t(editor === 'new' ? 'features.create' : 'features.edit')}
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
                  {(editor === 'new'
                    ? ['planned', 'active', 'blocked', 'completed']
                    : ['planned', 'active', 'blocked', 'completed', 'archived']
                  ).map((value) => (
                    <option key={value} value={value}>
                      {t(`features.status_${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="feature-form-actions">
                <button type="button" disabled={busy} onClick={closeEditor}>
                  {t('features.cancel')}
                </button>
                <button type="submit" disabled={busy || !canWrite || !name.trim()}>
                  {t(busy ? 'features.saving' : 'features.save')}
                </button>
              </div>
            </form>
          )}
          {(notice ||
            prepareIssue ||
            closeIssue ||
            arrangeIssue ||
            (snapshot && !snapshot.layoutSaved)) && (
            <div className="feature-feedback" role="status">
              {notice && <p>{t(`features.${notice}`)}</p>}
              {prepareIssue && prepareIssue !== notice && <p>{t(`features.${prepareIssue}`)}</p>}
              {closeIssue && <p>{t('terminalStudio.closeTerminal.unconfirmed')}</p>}
              {arrangeIssue && (
                <p>
                  {t(
                    arrangeIssue === 'denied'
                      ? 'terminalStudio.arrangeFocus'
                      : 'terminalStudio.arrangeIssue',
                    { status: arrangeIssue },
                  )}
                </p>
              )}
              {snapshot && !snapshot.layoutSaved && <p>{t('features.layoutUnsaved')}</p>}
            </div>
          )}
          {nativeWorkspace &&
            renamePane &&
            available.some((entry) => entry.terminalId === renamePane.terminalId) && (
              <form
                className="feature-pane-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  const editing = renamePane;
                  void request({ action: 'renamePane', ...editing }).then((result) => {
                    if (result === 'ok')
                      setRenamePane((value) => (value === editing ? null : value));
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
          {snapshot && (
            <details className="feature-permissions-disclosure">
              <summary>{t('feature.options')}</summary>
              <button
                ref={editTrigger}
                type="button"
                disabled={busy || !canWrite || !selected || !!editor}
                onClick={() => selected && openEditor(selected)}
              >
                {t('features.edit')}
              </button>
              <button
                type="button"
                aria-pressed={canvas}
                disabled={busy || !canWrite}
                onClick={() => {
                  setWantsCanvas(!canvas);
                  if (!canvas && nativeWorkspace)
                    void request({ action: 'canvas' }).then((result) => {
                      if (result !== 'ok') setWantsCanvas(false);
                    });
                }}
              >
                {t('canvas.title')}
              </button>
              {structured && (
                <button
                  type="button"
                  disabled={busy || !canWrite || selected?.status === 'archived'}
                  onClick={() => {
                    if (selected) {
                      setStructuredFeature(selected.featureId);
                      return;
                    }
                    const featureId = defaultFeatureId(snapshot.workspace.id);
                    void selectScope(featureId).then((accepted) => {
                      if (accepted) setStructuredFeature(featureId);
                    });
                  }}
                >
                  {t('structuredAgents.title')}
                </button>
              )}
              {selected && !editor && (
                <div className="feature-members">
                  <p>{t('features.members', { count: selected.terminalIds.length })}</p>
                  <p>{t('features.available', { count: available.length })}</p>
                  {selected.terminalIds.length > available.length && (
                    <p>
                      {t('features.missing', {
                        count: selected.terminalIds.length - available.length,
                      })}
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
              {nativeWorkspace && <FeaturePermissions snapshot={snapshot} feature={selected} />}
            </details>
          )}
        </div>
        {(navigation || nativeNavigation) && (
          <div className="feature-navigation">{navigation ?? nativeNavigation}</div>
        )}
        <footer className="feature-core" role="status" data-state={coreState}>
          <span aria-hidden="true">●</span> {t(`feature.core.${coreState}`)}
        </footer>
      </aside>
      {structuredOpen && (
        <StructuredAgents
          key={selected.featureId}
          client={structured}
          scope={{ workspaceId: snapshot.workspace.id, featureId: selected.featureId }}
          featureName={displayFeatureName(selected)}
          onClose={() => setStructuredFeature(undefined)}
        />
      )}
      {!studio && (
        <header className="feature-topbar">
          {breadcrumb}
          {toolbarUtilities}
          {layoutActions(
            () => void request({ action: 'organize', command: 'columns-2' }),
            () => void request({ action: 'organize', command: 'show-all' }),
          )}
          {actions}
        </header>
      )}
      {studio ? (
        <div
          className="feature-studio"
          ref={studioRef}
          onFocusCapture={(event) => {
            if (!(event.target instanceof HTMLElement)) return;
            const id = event.target
              .closest('.ts-pane')
              ?.querySelector<HTMLElement>('.ts-body[data-terminal-id]')?.dataset.terminalId;
            if (id) focusedTerminals.current.set(scopeKey, id);
          }}
        >
          <TerminalStudio
            key={scopeKey}
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
            emptyHint={
              !snapshot ? (
                <span className="ts-loading">{t(`feature.core.${coreState}`)}</span>
              ) : selected?.status === 'archived' ? (
                <span>{t('feature.archived')}</span>
              ) : undefined
            }
            v6={{
              featureName: selected ? displayFeatureName(selected) : t('features.unassigned'),
              layoutControlsRef: layoutControls,
              ...(nativeWorkspace && canWrite && selected?.status !== 'archived'
                ? {
                    onRename: (id: string) => {
                      const slot = available.find(({ terminalId }) => terminalId === id);
                      if (slot) editPane(slot.slot);
                    },
                  }
                : {}),
            }}
            toolbarStart={breadcrumb}
            toolbarEnd={
              <>
                {toolbarUtilities}
                {layoutActions(
                  () => layoutControls.current?.toggleGrid(),
                  () => layoutControls.current?.restore(),
                )}
                {selected &&
                  measuredTerminals.length > 0 &&
                  Number.isSafeInteger(featureTokens) && (
                    <span className="fine-print">
                      {t('terminalStudio.featureTokens', {
                        tokens: new Intl.NumberFormat(i18n.resolvedLanguage).format(featureTokens),
                        measured: measuredTerminals.length,
                        total: terminals.length,
                      })}
                    </span>
                  )}
                {nativeWorkspace ? (
                  <AccountLimits
                    accounts={limits}
                    shown={limitPrefs.shown ?? limits.slice(0, 4).map((entry) => entry.id)}
                    caps={limitPrefs.caps}
                    now={now}
                    source={t('accountLimits.sourceApp')}
                    onOpenChange={setLimitsOpen}
                    onShownChange={(shown) => saveLimitPrefs({ ...limitPrefs, shown })}
                    onCapsChange={(caps) => saveLimitPrefs({ ...limitPrefs, caps })}
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
                {actions}
              </>
            }
            {...(nativeWorkspace && selected?.status !== 'archived'
              ? {
                  closePending: busy || quitFence,
                  onCloseTerminal: (terminalId: string) => {
                    const member = available.find((entry) => entry.terminalId === terminalId);
                    if (!member) return;
                    setCloseIssue(false);
                    void request({
                      action: 'pane',
                      slot: member.slot,
                      terminalId,
                      command: 'close',
                    }).then((status) => {
                      if (status && status !== 'ok' && status !== 'cancelled') setCloseIssue(true);
                    });
                  },
                }
              : {})}
            {...(!selected && snapshot && moveTargets.length > 0
              ? {
                  unassignedMove: {
                    targets: moveTargets.map(({ id, name: targetName }) => ({
                      id,
                      name: targetName,
                    })),
                    pending: busy || quitFence,
                    onMove: (terminalId: string, featureId: string) =>
                      void moveUnassignedTerminal(terminalId, featureId),
                  },
                }
              : {})}
            onMention={
              mentionScope && canWrite && selected?.status !== 'archived'
                ? (message: MentionSend) => sendMention(mentionScope, message)
                : undefined
            }
            {...(nativeWorkspace
              ? {
                  native: {
                    onLayout: (layout: NativePaneLayout[], mode: ArrangementMode) =>
                      arrange(layout, mode, scopeKey),
                    // The limits panel hides only the views under it (data-native-overlay).
                    overlayOpen: !!editor || !!renamePane || structuredOpen || quitFence,
                  },
                }
              : {})}
            orchestratorLabel={selected?.orchestratorTerminalId ?? null}
            onOrchestratorChange={
              selected
                ? (terminalId) =>
                    void request({
                      action: 'update',
                      featureId: selected.featureId,
                      input: {
                        expectedRevision: selected.revision,
                        orchestratorTerminalId: terminalId,
                      },
                    })
                : undefined
            }
          />
        </div>
      ) : (
        <>
          {!canvas && nativeWorkspace && (
            <TerminalWorkspaceBar
              panes={panes.filter((pane) => available.some((entry) => entry.slot === pane.slot))}
              busy={busy || quitFence}
              onCommand={paneCommand}
              onRename={editPane}
              onMove={movePane}
              onPrepare={canPrepare ? () => void prepare() : undefined}
            />
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
                {!selected && <p role="status">{t('terminalStudio.unassigned.notice')}</p>}
                <ul>
                  {available.map((slot) => (
                    <li key={slot.terminalId}>
                      <strong>
                        {slot.slot + 1} · {t(`shell.adapters.${slot.provider}`)}
                      </strong>{' '}
                      <code>{slot.terminalId}</code>
                      {!selected && moveTargets[0] && (
                        <>
                          {' '}
                          <button
                            type="button"
                            disabled={busy || quitFence}
                            onClick={() =>
                              void moveUnassignedTerminal(slot.terminalId, moveTargets[0]!.id)
                            }
                          >
                            {t('terminalStudio.unassigned.moveAction')}
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <footer className="feature-bottom">
            {canvas ? (
              <CanvasStatusBar agents={canvasAgents} connected={coreState === 'online'} />
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
      {(quitWait || quitFence || quitClosing) && (
        <div className="quit-blocked" role="alert">
          <strong>
            {t(
              quitFence
                ? 'quitBlocked.fence'
                : quitWait
                  ? 'quitBlocked.title'
                  : 'quitBlocked.closing',
            )}
          </strong>
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
