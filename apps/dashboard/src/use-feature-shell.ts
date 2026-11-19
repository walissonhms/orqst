import { useEffect, useRef, useState } from 'react';
import type { FeatureNativeRequest, FeatureNativeSnapshot, StudioStartup } from '@orqst/protocol';
import { workspacePanes, type WorkspacePane } from './feature-workspace-dock';

type ShellRequest =
  | Omit<Extract<FeatureNativeRequest, { action: 'create' }>, 'contractVersion' | 'generation'>
  | Omit<Extract<FeatureNativeRequest, { action: 'update' }>, 'contractVersion' | 'generation'>
  | Omit<Extract<FeatureNativeRequest, { action: 'select' }>, 'contractVersion' | 'generation'>
  | Omit<Extract<FeatureNativeRequest, { action: 'pane' }>, 'contractVersion' | 'generation'>;

/** The Core owns workspace scope, membership and terminal identity. */
export function useFeatureShell(inspectingCommunication = false) {
  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const studio =
    window.orqstTauriStudio?.contractVersion === 1 ? window.orqstTauriStudio : undefined;
  const [startup, setStartup] = useState<StudioStartup>();
  const [startupPending, setStartupPending] = useState(Boolean(studio));
  const [startupAttempt, setStartupAttempt] = useState(0);
  useEffect(() => {
    if (!studio) return;
    let active = true;
    // Let the shell settle '/' to '/studio' before native captures the document URL.
    void Promise.resolve()
      .then(() => (active ? studio.request({ action: 'startup' }) : undefined))
      .then((reply) => {
        if (active && reply?.status === 'startup') setStartup(reply.startup);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setStartupPending(false);
      });
    return () => {
      active = false;
    };
  }, [studio, startupAttempt]);
  function retryStartup() {
    setStartupPending(true);
    setStartupAttempt((value) => value + 1);
  }

  const [snapshot, setSnapshot] = useState<FeatureNativeSnapshot>();
  const latest = useRef<FeatureNativeSnapshot | undefined>(undefined);
  const [panes, setPanes] = useState<WorkspacePane[]>([]);
  const [loading, setLoading] = useState(Boolean(native));
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  function apply(incoming: FeatureNativeSnapshot) {
    if (!latest.current || incoming.generation >= latest.current.generation) {
      latest.current = incoming;
      setSnapshot(incoming);
    }
  }
  useEffect(() => {
    if (!native) return;
    let live = true;
    void native
      .request({ action: 'snapshot', contractVersion: 1, generation: 0 })
      .then((reply) => {
        if (live && reply.snapshot) apply(reply.snapshot);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    const update = (event: Event) => apply((event as CustomEvent<FeatureNativeSnapshot>).detail);
    const dock = (event: Event) => setPanes(workspacePanes((event as CustomEvent<unknown>).detail));
    const retired = () => {
      latest.current = undefined;
      setSnapshot(undefined);
      setPanes([]);
      setStartupPending(true);
      setStartupAttempt((attempt) => attempt + 1);
    };
    window.addEventListener('orqst-terminal-pool-closed', retired);
    window.addEventListener('orqst-feature-state', update);
    window.addEventListener('orqst-terminal-dock', dock);
    return () => {
      live = false;
      window.removeEventListener('orqst-terminal-pool-closed', retired);
      window.removeEventListener('orqst-feature-state', update);
      window.removeEventListener('orqst-terminal-dock', dock);
    };
  }, [native, inspectingCommunication]);

  async function request(action: ShellRequest) {
    if (!native || !latest.current || pending.current) return undefined;
    pending.current = true;
    setBusy(true);
    try {
      const reply = await native.request({
        ...action,
        contractVersion: 1,
        generation: latest.current.generation,
      });
      if (reply.snapshot) apply(reply.snapshot);
      return reply;
    } catch {
      return undefined;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function select(featureId: string) {
    const before = latest.current;
    if (!before?.features.some((feature) => feature.featureId === featureId)) return false;
    if (before.activeFeatureId === featureId) return true;
    const reply = await request({
      action: 'select',
      featureId,
      expectedRevision: before.view.revision,
    });
    return reply?.status === 'ok' && latest.current?.activeFeatureId === featureId;
  }

  async function focusTerminal(terminalId: string) {
    const slot = latest.current?.slots.find(
      (slot) => slot.terminalId === terminalId && !slot.closed,
    );
    if (!slot) return false;
    return (
      (await request({ action: 'pane', slot: slot.slot, terminalId, command: 'focus' }))?.status ===
      'ok'
    );
  }
  return {
    native,
    snapshot,
    panes,
    busy,
    loading,
    request,
    select,
    focusTerminal,
    startup,
    startupPending,
    retryStartup,
  };
}
