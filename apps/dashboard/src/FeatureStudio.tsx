import { createPortal } from 'react-dom';
import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Activity, Bell, Folder, Search, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  defaultFeatureId,
  featureDisplayName,
  type FeatureNativeRequest,
  type FeaturePreparationRequest,
  type FeatureDashboardDestination,
  type FeatureNativeReply,
  type FeatureNativeSnapshot,
  type FeatureCanvasEvidence,
  type WorkspaceFeature,
  type TerminalPreparationCatalog,
} from '@orqst/protocol';
import './feature-workspace.css';
import { dockGeneration, workspacePanes, type WorkspacePane } from './feature-workspace-dock.js';
import {
  featureNoticeAfterSnapshot,
  featureNoticeContext,
  type FeatureNoticeContext,
} from './feature-notice.js';
import { FeaturePermissions } from './FeaturePermissions.js';
import { StructuredAgents } from './StructuredAgents.js';
import { EndedTerminalList } from './EndedTerminalList.js';
import { TerminalOpeningCard } from './TerminalOpeningCard.js';
import {
  requestTerminalRetry,
  useTerminalLifecycle,
  clearRetiredTerminalEvidence,
  useOwnedPaneEvidence,
} from './use-terminal-lifecycle.js';
import { PaneLifecycleContent } from './PaneLifecycleContent.js';
import { invalidateTerminalCatalog, loadTerminalCatalog } from './terminal-catalog-cache.js';
import {
  projectPaneLifecycle,
  reconcileEndedTerminals,
  savedTerminalDisposition,
  type EndedTerminal,
} from './terminal-lifecycle.js';
import { openFeatureTerminalIds } from './feature-counts.js';
import { quitBlocked, type QuitBlocked } from './quit-notice.js';
import {
  FeatureStudioStage,
  type StudioLayoutControls,
  type StudioTerminal,
} from './FeatureStudioStage.js';
import { TauriStudioPreparation } from './TauriStudioPreparation.js';
import { NativeTerminalCreator } from './NativeTerminalCreator.js';
import { Modal } from './Modal.js';
import { LegacyStudioPreparation } from './feature-workspace-preparation.js';
import { LimitsChip } from './AccountLimits.js';
import { NotificationsDrawer } from './NotificationsDrawer.js';
import { useStudioNotifications } from './use-studio-notifications.js';
import {
  confirmedResults,
  focusTarget,
  limitThresholds,
  liveAlertMs,
  ownedTurnNotification,
} from './studio-notifications-model.js';
import { FeatureDelegate, type FeatureDelegateProps } from './MentionComposer.js';
import { parseAccountLimits, type AccountLimit, type LimitCaps } from './account-limits-model.js';
import {
  arrangeRequest,
  studioTerminals,
  nativeChrome,
  type NativePaneLayout,
} from './studio-native.js';
import { RouteHeaderActions } from './AppShell';
import { StudioShellContext } from './navigation';
import { studioArrangementModes, type ArrangementMode } from './terminal-arrangement.js';

export interface StudioCreationScope {
  workspaceId: string;
  reopenTerminalId?: string;
  featureId: string | null;
  /** Display metadata from the active Feature snapshot. */
  featureName?: string;
  workspaceName?: string;
}

type Action = FeatureNativeRequest extends infer R
  ? R extends FeatureNativeRequest
    ? Omit<R, 'contractVersion' | 'generation'>
    : never
  : never;

function featureScopeKey(snapshot: FeatureNativeSnapshot | undefined, workspaceId = '') {
  return JSON.stringify([snapshot?.workspace.id ?? workspaceId, snapshot?.activeFeatureId]);
}

/** Shared native chrome/Studio metadata UI. Terminals remain retained native documents. */
export type StudioFocus = (featureId: string | null, terminalId: string) => Promise<boolean>;

export function FeatureStudio({
  nativeWorkspace = false,
  focusRef,
  notificationsOpen,
  onNotificationsOpen,
  onUnreadChange,
  onRevealStudio,
  navigation,
  toolbarUtilities,
  preparationRequest,
  onPreparationHandled,
  notificationPreferences,
  onObservedNotifications,
  workspaces = [],
  workspaceId = '',
  savedStudio,
  liveWorkspaceId,
  onSavedMetadataChange,
  onLocateReservation,
  reservationTarget,
  onRetryStartup,
  onCanvas,
  onSnapshot,
}: {
  nativeWorkspace?: boolean;
  focusRef?: Ref<StudioFocus>;
  notificationsOpen?: boolean;
  onNotificationsOpen?: (open: boolean) => void;
  onUnreadChange?: (count: number) => void;
  onRevealStudio?: () => void;
  navigation?: ReactNode;
  toolbarUtilities?: ReactNode;
  preparationRequest?: FeaturePreparationRequest;
  onPreparationHandled?: () => void;
  notificationPreferences?: ReactNode;
  onObservedNotifications?: () => void;
  workspaces?: ReadonlyArray<{ id: string; name: string }>;
  workspaceId?: string;
  savedStudio?: Pick<FeatureNativeSnapshot, 'workspace' | 'features' | 'view' | 'activeFeatureId'>;
  liveWorkspaceId?: string;
  onSavedMetadataChange?: () => void;
  onLocateReservation?: () => void;
  reservationTarget?: { terminalId: string };
  onRetryStartup?: () => void;
  onSnapshot?: (snapshot: FeatureNativeSnapshot) => void;
  onCanvas?: (evidence: { workspaceId: string; canvas: FeatureCanvasEvidence }) => void;
  onWorkspace?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const shell = useContext(StudioShellContext);
  const [shellActions, setShellActions] = useState<HTMLDivElement | null>(null);
  const creator =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  const [creation, setCreation] = useState<{
    scope: StudioCreationScope;
    advanced: boolean;
  }>();
  const trigger = useRef<HTMLElement | null>(null);
  const advancedPending = useRef(false);
  const advancedStarted = useRef(false);
  const handled = useRef<FeaturePreparationRequest | undefined>(undefined);
  const openPreparation = useCallback(
    (scope: StudioCreationScope) => {
      if (trigger.current) return;
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      setCreation({ scope, advanced: !creator });
    },
    [creator],
  );

  function closePreparation(possibleStart = false) {
    if (advancedPending.current) return;
    const opener = trigger.current;
    trigger.current = null;
    advancedStarted.current = false;
    setCreation(undefined);
    if (!possibleStart) window.dispatchEvent(new Event('orqst-terminal-creator-closed'));
    requestAnimationFrame(() => {
      if (opener?.isConnected && !trigger.current) opener.focus();
    });
  }

  useEffect(() => {
    if (!preparationRequest || handled.current === preparationRequest) return;
    // The native sender validated the source and scope. Catalog and Open independently
    // verify the current scope and native review.
    handled.current = preparationRequest;
    openPreparation(preparationRequest);
    onPreparationHandled?.();
  }, [preparationRequest, onPreparationHandled, openPreparation]);

  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const [liveSnapshot, setSnapshot] = useState<FeatureNativeSnapshot>();
  const snapshot = useMemo<FeatureNativeSnapshot | undefined>(
    () =>
      savedStudio
        ? {
            ...savedStudio,
            contractVersion: 1,
            storage: 'core',
            generation: 0,
            slots: [],
            layoutSaved: false,
          }
        : liveSnapshot,
    [savedStudio, liveSnapshot],
  );
  const nativeSnapshot = savedStudio ? undefined : liveSnapshot;
  const [evidence, setEvidence] = useState<FeatureCanvasEvidence>();
  // Provider-reported limits only.
  const [limits, setLimits] = useState<AccountLimit[]>([]);
  const priorLimits = useRef<FeatureNativeReply['accountLimits']>(undefined);
  const liveSince = useRef<number | undefined>(undefined);
  const [standaloneNotificationsOpen, setStandaloneNotificationsOpen] = useState(false);
  const studioNotificationsOpen = notificationsOpen ?? standaloneNotificationsOpen;
  const setStudioNotificationsOpen = onNotificationsOpen ?? setStandaloneNotificationsOpen;
  const revealStudio = useRef(onRevealStudio);
  revealStudio.current = onRevealStudio;
  const [focusAlertTarget, setFocusAlertTarget] = useState<{
    terminalId: string;
    at: number;
    nativeTap?: boolean;
  }>();
  const studioNotifications = useStudioNotifications();
  const addNotifications = studioNotifications.add;
  const unreadCount = studioNotifications.unreadCount;
  useEffect(() => onUnreadChange?.(unreadCount), [onUnreadChange, unreadCount]);
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
  const [limitPrefs] = useState<{ shown?: string[]; caps: LimitCaps }>(() => {
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
  const capsForAlerts = useRef(limitPrefs.caps);
  capsForAlerts.current = limitPrefs.caps;
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [dockEpoch, setDockEpoch] = useState(0);
  const [panes, setPanes] = useState<WorkspacePane[]>([]);
  const scopeTree = useRef<HTMLElement>(null);
  const [coreState, setCoreState] = useState<'connecting' | 'online' | 'unavailable'>(
    native ? 'connecting' : 'unavailable',
  );
  const [renamePane, setRenamePane] = useState<{
    slot: number;
    terminalId: string;
    name: string;
  } | null>(null);
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
  const acceptSnapshot = useCallback(
    (incoming: FeatureNativeSnapshot) => {
      if (current.current && incoming.generation < current.current.generation) return false;
      current.current = incoming;
      setSnapshot(incoming);
      onSnapshot?.(incoming);
      setCoreState('online');
      return true;
    },
    [onSnapshot],
  );
  useEffect(() => {
    const retired = () => {
      clearRetiredTerminalEvidence(
        current.current?.slots.map(({ terminalId }) => terminalId) ?? [],
      );
      current.current = undefined;
      setSnapshot(undefined);
      setEvidence(undefined);
      setPanes([]);
    };
    window.addEventListener('orqst-terminal-pool-closed', retired);
    return () => window.removeEventListener('orqst-terminal-pool-closed', retired);
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

  const studio = nativeWorkspace || !!native || !!creator;
  const embedsPtys = nativeWorkspace || (!!shell && !!native?.arrange);
  const [structuredFeature, setStructuredFeature] = useState<string>();
  const structured = nativeWorkspace ? window.orqstStructuredAgents : undefined;
  const structuredOpen =
    !!selected &&
    selected.status !== 'archived' &&
    structuredFeature === selected.featureId &&
    !!structured &&
    !!snapshot;

  const hasSnapshot = !!liveSnapshot;
  const reconciling = !!nativeSnapshot?.slots.some(({ closed }) => !closed) && !evidence;
  const openingWorkspaceId = snapshot?.workspace.id ?? workspaceId;
  const preparationFeatureId = savedStudio
    ? savedStudio.view.featureId
    : (snapshot?.activeFeatureId ?? null);
  const preparationMatchesView =
    !savedStudio || !preparationFeatureId || preparationFeatureId === selected?.featureId;
  const openingTerminals = useTerminalLifecycle(
    openingWorkspaceId,
    snapshot?.activeFeatureId ?? null,
    !nativeWorkspace && studio && (!liveWorkspaceId || !savedStudio) ? creator : undefined,
    preparationFeatureId,
  );
  const [history, setHistory] = useState<TerminalPreparationCatalog>();
  useEffect(() => {
    if (
      !creator ||
      !openingWorkspaceId ||
      !selected?.terminalDisplays?.some(({ released }) => released)
    )
      return;
    let active = true;
    void loadTerminalCatalog(creator, {
      workspaceId: openingWorkspaceId,
      featureId: preparationFeatureId,
    })
      .then((reply) => {
        if (active && reply.status === 'catalog') setHistory(reply.catalog);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    creator,
    openingWorkspaceId,
    preparationFeatureId,
    selected?.revision,
    selected?.terminalDisplays,
  ]);
  const paneEvidence = useOwnedPaneEvidence();
  const openingByTerminal = useMemo(() => {
    const openings = new Map<string, (typeof openingTerminals)[number]>();
    for (const card of openingTerminals) {
      openings.set(card.id, card);
      if (card.terminalId) openings.set(card.terminalId, card);
    }
    return openings;
  }, [openingTerminals]);
  const existing = useMemo(() => {
    const releasedIds = new Set(
      selected?.terminalDisplays
        ?.filter(({ released }) => released)
        .map(({ terminalId }) => terminalId),
    );
    const projected = studioTerminals(snapshot, panes, evidence, now);
    return projected.map((terminal) => {
      const opening = openingByTerminal.get(terminal.id);
      const facts = paneEvidence.get(terminal.id);
      const lifecycle =
        releasedIds.has(terminal.id) ||
        (terminal.cardState === 'ended' && facts?.process !== 'exited')
          ? { state: 'ended' as const }
          : facts
            ? projectPaneLifecycle({
                ...facts,
                transport: coreState === 'online' ? facts.transport : 'lost',
                turn:
                  terminal.status === 'running' ||
                  terminal.status === 'waiting_for_user' ||
                  terminal.status === 'failed'
                    ? terminal.status
                    : undefined,
              })
            : (opening ?? { state: terminal.cardState ?? 'unknown' });
      return {
        ...terminal,
        cardState: lifecycle.state,
        lifecycle,
        ...(opening ? { correlationId: opening.id, name: opening.name } : {}),
      };
    });
  }, [snapshot, selected, panes, evidence, now, paneEvidence, openingByTerminal, coreState]);
  const ownedTerminals = useMemo(() => {
    const openIds = openFeatureTerminalIds(snapshot, evidence, paneEvidence);
    return existing.filter(({ id, cardState }) => {
      if (cardState === 'ended' || paneEvidence.get(id)?.process === 'uncertain') return false;
      return openIds.has(id) || openingByTerminal.has(id) || cardState === 'failed';
    });
  }, [snapshot, evidence, existing, openingByTerminal, paneEvidence]);
  const terminals = useMemo<StudioTerminal[]>(
    () => [
      ...ownedTerminals,
      ...openingTerminals
        .filter(
          (card) =>
            card.state !== 'ended' &&
            !snapshot?.slots.some(({ terminalId }) => terminalId === card.terminalId),
        )
        .map((card): StudioTerminal => ({
          id: card.id,
          correlationId: card.id,
          label: '',
          name: card.name,
          provider: card.provider,
          status: 'unknown',
          cardState: card.state,
          lifecycle: card,
          workspace: snapshot?.workspace ??
            workspaces.find(({ id }) => id === openingWorkspaceId) ?? {
              id: openingWorkspaceId,
              name: '',
            },
        })),
    ],
    [ownedTerminals, openingTerminals, openingWorkspaceId, snapshot, workspaces],
  );
  const scopeKey = featureScopeKey(snapshot, workspaceId);
  const scopeSince = useRef({ key: scopeKey, at: Date.now() });
  if (scopeSince.current.key !== scopeKey) scopeSince.current = { key: scopeKey, at: Date.now() };
  const messages = communication.filter((event) => event.at >= scopeSince.current.at);
  const recentMessage = communication.at(-1);
  const [endingTerminal, setEndingTerminal] = useState<string>();
  const studioRef = useRef<HTMLDivElement>(null);
  const layoutControls = useRef<StudioLayoutControls>(null);
  const openDelegate = useRef<(terminalId: string) => void>(null);
  const requestedSlot = useRef<{ scope: string; slot: number; known: Set<string>; until: number }>(
    undefined,
  );
  useEffect(() => {
    const pending = requestedSlot.current;
    if (!pending) return;
    if (pending.scope !== scopeKey || pending.until < Date.now()) {
      requestedSlot.current = undefined;
      return;
    }
    const arrivals = ownedTerminals.filter(({ id }) => !pending.known.has(id));
    if (arrivals.length === 0) return;
    requestedSlot.current = undefined;
    if (arrivals.length === 1) layoutControls.current?.placeTerminal(arrivals[0]!.id, pending.slot);
  }, [scopeKey, ownedTerminals]);
  const focusedTerminals = useRef(new Map<string, string>());
  useEffect(() => {
    if (!native) return;
    const tap = (event: Event) => {
      const result = z
        .strictObject({ terminalId: z.uuid() })
        .safeParse((event as CustomEvent<unknown>).detail);
      if (result.success) {
        setStudioNotificationsOpen(false);
        revealStudio.current?.();
        setFocusAlertTarget({
          terminalId: result.data.terminalId,
          at: Date.now(),
          nativeTap: true,
        });
      }
    };
    window.addEventListener('orqst-owned-notification-click', tap);
    return () => window.removeEventListener('orqst-owned-notification-click', tap);
  }, [native, setStudioNotificationsOpen]);
  useEffect(() => {
    if (
      (shell && !shell.active) ||
      !focusAlertTarget ||
      !layoutControls.current ||
      busy ||
      studioNotificationsOpen
    )
      return;
    const { terminalId, at, nativeTap } = focusAlertTarget;
    if (Date.now() - at > liveAlertMs) {
      setFocusAlertTarget(undefined);
      return;
    }
    const slot = focusTarget(snapshot, snapshot?.activeFeatureId ?? null, terminalId);
    if (!slot || (nativeTap && !panes.some((pane) => pane.slot === slot.slot && pane.active)))
      return;
    layoutControls.current.focusTerminal(terminalId);
    setFocusAlertTarget(undefined);
  }, [focusAlertTarget, studioNotificationsOpen, busy, snapshot, panes, shell]);
  const arranging = useRef<{
    layout: NativePaneLayout[];
    mode: ArrangementMode;
    scope: string;
  } | null>(null);
  const preparingOpen = openingTerminals.some(
    (card) => card.state === 'starting' && !card.terminalId,
  );
  const preparingOpenRef = useRef(preparingOpen);
  preparingOpenRef.current = preparingOpen;
  const arrangeRef =
    useRef<(layout: NativePaneLayout[], mode: ArrangementMode, scope: string) => void>(undefined);
  const arrangeRetry = useRef<{ timer?: number; attempt: number }>({ attempt: 0 });
  /** Send the Studio geometry to native views; the bridge keeps only the latest frame. */
  const arrange = useCallback(
    (layout: NativePaneLayout[], mode: ArrangementMode, frameScope: string) => {
      const snapshot = current.current;
      if (!native?.arrange || !snapshot || drawerOpen()) return;
      if (featureScopeKey(snapshot) !== frameScope) return;
      const submitted = { layout, mode, scope: frameScope };
      arranging.current = submitted;
      if (preparingOpenRef.current) return;
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
        const selectedNow = snapshotNow.features.find(
          (feature) => feature.featureId === snapshotNow.activeFeatureId,
        );
        const memberIds =
          selectedNow?.terminalIds ??
          snapshotNow.slots
            .filter(
              (slot) =>
                !snapshotNow.features.some((feature) =>
                  feature.terminalIds.includes(slot.terminalId),
                ),
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
            if (reply.status === 'busy') {
              if (arrangeRetry.current.attempt++ < 8) resendLatest(40);
              return;
            }
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
  }, [generation, dockEpoch, arrange, scopeKey, studio, preparingOpen]);
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
        const previousScope = featureScopeKey(current.current);
        const accepted = reply.snapshot && acceptSnapshot(reply.snapshot);
        if (previousScope !== featureScopeKey(current.current)) {
          setCommunication([]);
          setEvidence(undefined);
        }
        if (accepted && reply.snapshot && reply.canvas) {
          setEvidence(reply.canvas);
          onCanvas?.({ workspaceId: reply.snapshot.workspace.id, canvas: reply.canvas });
        }
        if (accepted && reply.communication) setCommunication(reply.communication.events);
        const observedAt = Date.now();
        if (accepted && reply.canvas) setNow(observedAt);
        if (reply.status === 'ok' && accepted && reply.snapshot) {
          if (readsLimits) {
            const prior = priorLimits.current;
            const next = reply.accountLimits;
            if (prior && next) {
              addNotifications(
                limitThresholds(prior, next, capsForAlerts.current, observedAt),
                observedAt,
              );
            }
            priorLimits.current = next;
            setLimits(parseAccountLimits(next?.accounts));
          }
          if (reply.communication && liveSince.current !== undefined) {
            addNotifications(
              confirmedResults(reply.communication, reply.snapshot, liveSince.current, observedAt),
              observedAt,
            );
          }
          liveSince.current ??= observedAt;
        } else if (readsLimits && reply.status === 'unavailable') {
          priorLimits.current = undefined;
          liveSince.current = undefined;
          setLimits([]);
          if (action.action === 'snapshot') setCoreState('unavailable');
        }
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
          if (readsLimits) {
            priorLimits.current = undefined;
            liveSince.current = undefined;
            setLimits([]);
          }
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
    [native, acceptSnapshot, addNotifications, onCanvas],
  );

  useEffect(() => {
    if (!native) return;
    const receive = (event: Event) => {
      const snapshot = current.current;
      if (!snapshot || liveSince.current === undefined) return;
      const now = Date.now();
      const alert = ownedTurnNotification((event as CustomEvent<unknown>).detail, snapshot, now);
      if (alert && alert.at >= liveSince.current) addNotifications([alert], now);
    };
    window.addEventListener('orqst-owned-turn-alert', receive);
    return () => window.removeEventListener('orqst-owned-turn-alert', receive);
  }, [native, addNotifications]);

  // A cold host may become available between periodic snapshots. Ask once as soon
  // as native accepts a UUID so its real body does not wait for the next poll.
  const observedAdmissions = useRef(new Set<string>());
  useEffect(() => {
    if (!native?.arrange || busy) return;
    const newAdmissions = openingTerminals.flatMap(({ terminalId, state }) =>
      terminalId && state === 'starting' && !observedAdmissions.current.has(terminalId)
        ? [terminalId]
        : [],
    );
    if (!newAdmissions.length) return;
    newAdmissions.forEach((id) => observedAdmissions.current.add(id));
    if (
      newAdmissions.some(
        (id) => !current.current?.slots.some(({ terminalId }) => terminalId === id),
      )
    )
      void request({ action: 'snapshot' });
  }, [openingTerminals, busy, native, request]);

  // The main document receives the creator's cancel event after native suspended the
  // sibling webviews. Keep that presentation recovery separate from scope switches.
  useEffect(() => {
    if (nativeWorkspace) return;
    const closed = () => {
      requestedSlot.current = undefined;
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
    if (!native) return;
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
  }, [native, request, hasSnapshot]);
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
      setDockEpoch(dockGeneration(detail));
      setPanes(workspacePanes(detail));
    };
    window.addEventListener('orqst-terminal-dock', update);
    return () => window.removeEventListener('orqst-terminal-dock', update);
  }, []);

  function editPane(slot: number) {
    const member = available.find((entry) => entry.slot === slot);
    if (member)
      setRenamePane({
        slot,
        terminalId: member.terminalId,
        name: panes.find((pane) => pane.slot === slot)?.label ?? '',
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
        `.ts-pane[data-pane-id="${CSS.escape(terminalId)}"]`,
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
    setFocusScope({ featureId, workspace });
    return true;
  }

  /** View-only L2 integration point. The ID is immutable and the owning Feature is checked. */
  async function focusTerminal(featureId: string | null, terminalId: string) {
    if (quitFence || editor || renamePane || structuredOpen) return false;
    if ((await request({ action: 'snapshot' })) !== 'ok') return false;
    const latest = current.current;
    if (!latest || !focusTarget(latest, featureId, terminalId)) return false;
    if (latest.activeFeatureId !== featureId) {
      if (
        (await request({ action: 'select', featureId, expectedRevision: latest.view.revision })) !==
        'ok'
      )
        return false;
    }
    const slot = focusTarget(current.current, featureId, terminalId);
    if (!slot || current.current?.activeFeatureId !== featureId) return false;
    onRevealStudio?.();
    const status = await request({ action: 'pane', command: 'focus', slot: slot.slot, terminalId });
    if (status !== 'ok') return false;
    setFocusAlertTarget({ terminalId, at: Date.now() });
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
  const canWrite = coreState === 'online' && !!nativeSnapshot && !quitFence;
  const canPrepare =
    !quitFence &&
    selected?.status !== 'archived' &&
    (nativeWorkspace
      ? canWrite && !!native?.showPreparationDrawer
      : (!liveWorkspaceId || !!nativeSnapshot) && preparationMatchesView && !!openingWorkspaceId);
  // The New terminal dialog has its own latch: snapshot polling must not refuse the click.
  async function prepare(slot?: number, reopenTerminalId?: string) {
    if (preparing.current) {
      setPrepareIssue('busy');
      return;
    }
    setPrepareIssue('');
    requestedSlot.current =
      slot === undefined
        ? undefined
        : {
            scope: scopeKey,
            slot,
            known: new Set(terminals.map(({ id }) => id)),
            until: Date.now() + 60_000,
          };
    if (!nativeWorkspace) {
      const targetWorkspaceId = snapshot?.workspace.id ?? workspaceId;
      if (reopenTerminalId && creator)
        invalidateTerminalCatalog(creator, {
          workspaceId: targetWorkspaceId,
          featureId: preparationFeatureId,
        });
      openPreparation({
        workspaceId: targetWorkspaceId,
        featureId: preparationFeatureId,
        workspaceName: snapshot?.workspace.name,
        featureName: selected ? displayFeatureName(selected) : undefined,
        reopenTerminalId,
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
        requestedSlot.current = undefined;
        setNotice(reply.status);
        setPrepareIssue(reply.status);
      }
    } catch {
      requestedSlot.current = undefined;
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
  const notificationsBell = native && (
    <button
      type="button"
      className="icon-button feature-nav-control studio-notifications-trigger"
      aria-label={t('notifications')}
      aria-haspopup="dialog"
      aria-expanded={studioNotificationsOpen}
      title={`${t('notifications')} · ${t('notificationCounts', { count: studioNotifications.unreadCount })}`}
      onClick={() => setStudioNotificationsOpen(true)}
    >
      <Bell size={16} aria-hidden="true" />
      {studioNotifications.unreadCount > 0 && (
        <>
          <span className="studio-notifications-count" aria-hidden="true">
            {studioNotifications.unreadCount > 99 ? '99+' : studioNotifications.unreadCount}
          </span>
          <span className="al-sr-only" role="status">
            {t('notificationCounts', { count: studioNotifications.unreadCount })}
          </span>
        </>
      )}
    </button>
  );
  const savedMembers = reconcileEndedTerminals(
    members.map((id): EndedTerminal => {
      const slot = snapshot?.slots.find((entry) => entry.terminalId === id);
      const terminal = existing.find(({ id: terminalId }) => terminalId === id);
      const display = selected?.terminalDisplays?.find(({ terminalId }) => terminalId === id);
      const release =
        history?.workspaceId === openingWorkspaceId && history.featureId === preparationFeatureId
          ? history.reopenable?.find(({ terminalId }) => terminalId === id)
          : undefined;
      const exit = evidence?.entries.find(
        ({ terminalId, state }) => terminalId === id && state === 'exited',
      );
      return {
        terminalId: id,
        disposition: savedTerminalDisposition(
          !!exit || paneEvidence.get(id)?.process === 'exited',
          display?.released === true,
        ),
        released: display?.released,
        displayId: display?.displayId ?? terminal?.label,
        provider: slot?.provider ?? display?.provider ?? release?.provider,
        name: slot?.displayName ?? display?.name ?? terminal?.name ?? release?.name,
        activeReservation: display?.activeReservation,
        exitedAt: exit?.exitedAt,
      };
    }),
    new Set(ownedTerminals.map(({ id }) => id)),
  );
  async function removeSavedTerminal(terminalId: string) {
    if (!creator || !savedStudio || !selected || !preparationMatchesView || quitFence) return;
    const scope = { workspaceId: savedStudio.workspace.id, featureId: preparationFeatureId };
    try {
      const catalog = await loadTerminalCatalog(creator, scope, true);
      if (catalog.status !== 'catalog' || !catalog.snapshot || !catalog.catalog.restoredFeature) {
        setPrepareIssue('unavailable');
        return;
      }
      const result = await creator.request({
        action: 'remove-terminal',
        workspaceId: scope.workspaceId,
        featureId: catalog.catalog.restoredFeature.featureId,
        terminalId,
        catalogId: catalog.catalog.catalogId,
        generation: catalog.snapshot.generation,
      });
      if (result.status === 'ok') {
        invalidateTerminalCatalog(creator, scope);
        onSavedMetadataChange?.();
      } else if (result.status !== 'denied' || result.failure) {
        setPrepareIssue(result.status);
      }
    } catch {
      setPrepareIssue('unavailable');
    }
  }
  const savedTerminalList = (
    <EndedTerminalList
      key={scopeKey}
      terminals={savedMembers}
      target={reservationTarget}
      now={now}
      onRemove={
        canWrite && selected && !busy
          ? ({ terminalId }) =>
              void request({
                action: 'removeTerminal',
                featureId: selected.featureId,
                terminalId,
                expectedRevision: selected.revision,
              })
          : savedStudio && !liveWorkspaceId && canPrepare && creator
            ? ({ terminalId }) => void removeSavedTerminal(terminalId)
            : undefined
      }
      onReopen={
        canPrepare && !busy ? ({ terminalId }) => void prepare(undefined, terminalId) : undefined
      }
    />
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
  const creationFeatureId =
    creation && (creation.scope.featureId ?? defaultFeatureId(creation.scope.workspaceId));
  const creationMemberIds =
    liveSnapshot?.workspace.id === creation?.scope.workspaceId
      ? liveSnapshot?.features.find(({ featureId }) => featureId === creationFeatureId)?.terminalIds
      : undefined;
  const creationNames = [
    ...(liveSnapshot?.slots.flatMap(({ terminalId, displayName }) =>
      displayName && creationMemberIds?.includes(terminalId) ? [displayName] : [],
    ) ?? []),
    ...openingTerminals.flatMap(({ targetFeatureId, name, state, failure }) =>
      targetFeatureId === creationFeatureId &&
      (state !== 'failed' || failure?.reason === 'opening_uncertain') &&
      state !== 'ended'
        ? [name]
        : [],
    ),
  ];
  const breadcrumb = (
    <strong className="feature-crumb" title={selected?.featureId}>
      <span aria-hidden="true">◈ </span>
      {snapshot?.workspace.name ??
        workspaceCatalog.get(workspaceId)?.name ??
        t('features.workspace')}
      {selected ? ` / ${displayFeatureName(selected)}` : ''}
    </strong>
  );
  const layoutControlsDisabled = !available.length || busy || quitFence;
  const layoutActions = (
    <>
      <div className="feature-grid-control">
        <button
          type="button"
          className="feature-action feature-grid"
          aria-disabled={layoutControlsDisabled}
          title={!available.length ? gridReason : t('features.grid')}
          onClick={() => {
            if (!layoutControlsDisabled) layoutControls.current?.toggleGrid();
          }}
        >
          <span aria-hidden="true">▦ </span>
          {t('features.grid')}
        </button>
        <select
          className="feature-layout-picker"
          aria-label={t('studio.pane.layouts')}
          title={t('studio.pane.layouts')}
          disabled={layoutControlsDisabled}
          value=""
          onChange={(event) => {
            const mode = studioArrangementModes.find((value) => value === event.target.value);
            if (mode) layoutControls.current?.setMode(mode);
          }}
        >
          <option value="" disabled>
            {t('studio.pane.layouts')}
          </option>
          {studioArrangementModes.map((mode) => (
            <option key={mode} value={mode}>
              {t(`terminalStudio.mode.${mode}`)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="feature-action feature-restore"
        aria-disabled={!available.length || busy || quitFence}
        title={!available.length ? t('feature.noRestore') : undefined}
        onClick={() => {
          if (!layoutControlsDisabled) layoutControls.current?.restore();
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
        terminals={ownedTerminals}
        hasAntigravity={
          snapshot?.slots.some(
            ({ terminalId, provider }) =>
              members.includes(terminalId) && provider === 'antigravity',
          ) || savedMembers.some(({ provider }) => provider === 'antigravity')
        }
        onSend={sendMention}
        openForRecipient={openDelegate}
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
  useImperativeHandle(focusRef, () => focusTerminal);
  useEffect(() => {
    if (!shell?.active || !shell.command || !shellActions || coreState === 'connecting') return;
    const selector = shell.command === 'delegate' ? '.mc-delegate' : '.feature-add-terminal';
    const button = shellActions.querySelector<HTMLButtonElement>(selector);
    const activated =
      !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    if (activated) button.click();
    shell.onCommandHandled?.(activated);
  }, [shell, shellActions, coreState]);

  const studioActions = (
    <>
      {layoutActions}
      {actions}
      {native && (
        <span className="studio-limits-control">
          <LimitsChip
            accounts={limits}
            shown={limitPrefs.shown ?? limits.map((entry) => entry.id)}
            caps={limitPrefs.caps}
            now={now}
            onRefresh={(accountId) =>
              void request({ action: 'accountLimits', command: 'refresh', accountId })
            }
            canRefresh={(accountId) => accountId === 'codex-default'}
          />
        </span>
      )}
    </>
  );
  if (!studio) return <LegacyStudioPreparation />;
  const feedback = (notice ||
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
    </div>
  );
  const notificationsDrawer = (
    <NotificationsDrawer
      items={studioNotifications.items}
      unreadCount={studioNotifications.unreadCount}
      open={studioNotificationsOpen}
      onClose={() => setStudioNotificationsOpen(false)}
      onMarkRead={studioNotifications.markRead}
      onClearAll={studioNotifications.clearAll}
      canFocus={(featureId, terminalId) =>
        coreState === 'online' && !!focusTarget(snapshot, featureId, terminalId)
      }
      focusTerminal={focusTerminal}
      preferences={
        <>
          {notificationPreferences}
          {(onObservedNotifications || (nativeWorkspace && native?.showDashboard)) && (
            <button
              type="button"
              onClick={() => {
                setStudioNotificationsOpen(false);
                if (onObservedNotifications) onObservedNotifications();
                else void openDashboard('notifications');
              }}
            >
              {t('studioNotifications.observedHistory')}
            </button>
          )}
          {nativeWorkspace && native?.showDashboard && (
            <button
              type="button"
              onClick={() => {
                setStudioNotificationsOpen(false);
                void openDashboard('settings');
              }}
            >
              {t('studioNotifications.settings')}
            </button>
          )}
        </>
      }
    />
  );
  const workspace = (
    <section
      className={`feature-workspace${nativeWorkspace ? ' feature-native' : ''}`}
      aria-label={t('features.workspace')}
    >
      {shell?.active && (
        <RouteHeaderActions>
          <div className="studio-header-actions" ref={setShellActions}>
            {studioActions}
          </div>
        </RouteHeaderActions>
      )}
      {shell ? createPortal(notificationsDrawer, document.body) : notificationsDrawer}
      {!shell && (
        <aside className="feature-sidebar" ref={scopeTree}>
          <div className="feature-brand">
            <img
              src={
                nativeWorkspace ? 'orqst-features://local/logo.svg' : '/brand/orqst-logo-dark.svg'
              }
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
                    onChange={(event) =>
                      setStatus(event.target.value as WorkspaceFeature['status'])
                    }
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
            {feedback}
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
          {(navigation || nativeNavigation || notificationsBell) && (
            <div className="feature-navigation">
              {navigation ?? nativeNavigation}
              {notificationsBell}
            </div>
          )}
          <footer className="feature-core" role="status" data-state={coreState}>
            <span aria-hidden="true">●</span> {t(`feature.core.${coreState}`)}
          </footer>
        </aside>
      )}
      {shell && feedback}
      {structuredOpen && (
        <StructuredAgents
          key={selected.featureId}
          client={structured}
          scope={{ workspaceId: snapshot.workspace.id, featureId: selected.featureId }}
          featureName={displayFeatureName(selected)}
          onClose={() => setStructuredFeature(undefined)}
        />
      )}
      {[
        ...new Map(
          openingTerminals
            .filter((entry) => entry.verifiedUpdate)
            .map((entry) => [entry.provider, entry.verifiedUpdate]),
        ).entries(),
      ].map(([provider, version]) => (
        <p className="feature-feedback fine-print" role="status" key={provider}>
          {t('studio.cliReview.verified', {
            name: t(`terminalStudio.providers.${provider}`),
            version,
          })}
        </p>
      ))}
      <div
        className="feature-studio"
        ref={studioRef}
        onFocusCapture={(event) => {
          if (!(event.target instanceof HTMLElement)) return;
          const id = event.target.closest<HTMLElement>('.ts-pane[data-pane-id]')?.dataset.paneId;
          if (id) focusedTerminals.current.set(scopeKey, id);
        }}
      >
        <FeatureStudioStage
          key={scopeKey}
          reconciling={reconciling || !!savedStudio}
          storageKey={`orqst.studio.${snapshot?.workspace.id ?? 'none'}.${selected?.featureId ?? 'unassigned'}`}
          terminals={terminals}
          messages={messages}
          recentMessage={recentMessage}
          layoutUnsaved={snapshot?.layoutSaved === false}
          endingTerminal={endingTerminal}
          onNewTerminal={canPrepare ? (slot) => void prepare(slot) : undefined}
          dockEnd={
            savedMembers.length > 0 && (
              <div className="pane-lifecycle-dock">{savedTerminalList}</div>
            )
          }
          renderBody={(terminal) => {
            const opening = openingByTerminal.get(terminal.id);
            const real = available.some(({ terminalId }) => terminalId === terminal.id);
            const retry =
              opening && opening.state === 'failed'
                ? () => {
                    requestTerminalRetry(opening);
                    void prepare();
                  }
                : undefined;
            if (opening && (!real || opening.state === 'failed'))
              return (
                <TerminalOpeningCard
                  card={opening}
                  onRetry={retry}
                  onLocateReservation={onLocateReservation}
                />
              );
            if (embedsPtys && !terminal.lifecycle?.failure)
              return (
                <div className="ts-hole" aria-hidden="true">
                  {terminal.lifecycle?.state === 'starting' && (
                    <PaneLifecycleContent lifecycle={terminal.lifecycle} />
                  )}
                </div>
              );
            if (
              paneEvidence.get(terminal.id)?.process === 'live' ||
              evidence?.entries.some(
                ({ terminalId, state }) => terminalId === terminal.id && state === 'running',
              ) ||
              terminal.cardState === 'starting' ||
              terminal.cardState === 'disconnected'
            )
              return (
                terminal.lifecycle && (
                  <PaneLifecycleContent
                    lifecycle={terminal.lifecycle}
                    onReconnect={() => void request({ action: 'snapshot' })}
                  />
                )
              );
            return terminal.lifecycle && <PaneLifecycleContent lifecycle={terminal.lifecycle} />;
          }}
          emptyHint={
            onRetryStartup ? (
              <>
                <span className="ts-loading">{t(`feature.core.${coreState}`)}</span>
                <span role="alert">{t('feature.workspace.startupUnavailable')}</span>
                <button type="button" className="button" onClick={onRetryStartup}>
                  {t('paneLifecycle.retry')}
                </button>
              </>
            ) : !snapshot && !openingWorkspaceId ? (
              <span className="ts-loading">{t(`feature.core.${coreState}`)}</span>
            ) : selected?.status === 'archived' ? (
              <span>{t('feature.archived')}</span>
            ) : undefined
          }
          v6={{
            featureName: selected ? displayFeatureName(selected) : t('features.unassigned'),
            layoutControlsRef: layoutControls,
            onDelegate:
              mentionScope && canWrite && selected?.status !== 'archived'
                ? (terminalId) => {
                    if (available.some((slot) => slot.terminalId === terminalId))
                      openDelegate.current?.(terminalId);
                  }
                : undefined,
            ...(embedsPtys && canWrite && selected?.status !== 'archived'
              ? {
                  onRename: (id: string) => {
                    const slot = available.find(({ terminalId }) => terminalId === id);
                    if (slot) editPane(slot.slot);
                  },
                }
              : {}),
          }}
          showToolbar={!shell}
          toolbarStart={shell ? undefined : breadcrumb}
          toolbarEnd={
            shell ? undefined : (
              <>
                {studioActions}
                {toolbarUtilities}
              </>
            )
          }
          {...(embedsPtys && selected?.status !== 'archived'
            ? {
                closePending: busy || quitFence,
                onCloseTerminal: (terminalId: string) => {
                  const member = available.find((entry) => entry.terminalId === terminalId);
                  if (!member) return;
                  setCloseIssue(false);
                  setEndingTerminal(terminalId);
                  void request({
                    action: 'pane',
                    slot: member.slot,
                    terminalId,
                    command: 'close',
                  })
                    .then((status) => {
                      if (status && status !== 'ok' && status !== 'cancelled') setCloseIssue(true);
                    })
                    .finally(() => setEndingTerminal(undefined));
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
          {...(embedsPtys
            ? {
                native: {
                  onLayout: (layout: NativePaneLayout[], mode: ArrangementMode) =>
                    arrange(layout, mode, scopeKey),
                  dashboard: !!shell,
                  // The limits panel hides only the views under it (data-native-overlay).
                  overlayOpen:
                    (shell && !shell.active) ||
                    !!creation ||
                    preparingOpen ||
                    !!editor ||
                    !!renamePane ||
                    structuredOpen ||
                    quitFence ||
                    studioNotificationsOpen,
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
      {embedsPtys &&
        renamePane &&
        available.some((entry) => entry.terminalId === renamePane.terminalId) && (
          <Modal
            label={t('studio.pane.settings')}
            className="mc-dialog"
            initialFocus="input"
            onClose={() => setRenamePane(null)}
          >
            <form
              data-native-overlay=""
              className="ts-pane-edit-form"
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
          </Modal>
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
      {creator && creation && !creation.advanced && (
        <NativeTerminalCreator
          native={creator}
          workspace={{
            id: creation.scope.workspaceId,
            name:
              creation.scope.workspaceName ??
              workspaces.find((workspace) => workspace.id === creation.scope.workspaceId)?.name ??
              t('studio.create.workspaceUnknown'),
          }}
          featureId={creation.scope.featureId}
          featureName={creation.scope.featureName}
          reopenTerminalId={creation.scope.reopenTerminalId}
          existingNames={creationNames}
          onAdvanced={() => setCreation({ ...creation, advanced: true })}
          onClose={closePreparation}
        />
      )}
      {creation?.advanced && (
        <Modal
          className="studio-preparation-dialog"
          label={t('studio.tauri.openTitle')}
          onClose={() => closePreparation(advancedStarted.current)}
        >
          <div className="studio-preparation-heading">
            <h2>{t('studio.tauri.openTitle')}</h2>
            <button
              className="icon-button"
              aria-label={t('close')}
              onClick={() => closePreparation(advancedStarted.current)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <section className="panel studio-setup" aria-labelledby="studio-setup-title">
            {!creator && (
              <p className="notice" title={t('studio.tauri.unavailable.detail')}>
                {t('studio.tauri.unavailable.label')}
              </p>
            )}
            <TauriStudioPreparation
              native={creator}
              context={creation.scope}
              onReviewPending={(pending) => {
                advancedPending.current = pending;
                if (pending) advancedStarted.current = true;
              }}
            />
            <p className="studio-boundary" title={t('studio.grantsHelp.detail')}>
              {t('studio.grantsHelp.label')}
            </p>
          </section>
        </Modal>
      )}
    </section>
  );
  return nativeWorkspace ? workspace : <div className="studio-workspace">{workspace}</div>;
}
