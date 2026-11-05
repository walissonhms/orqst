import { useEffect, useState } from 'react';
import type { FeatureNativeSnapshot } from '@orqst/protocol';

/** Shared Workspace → Feature view state. Selection changes the view only. */
export function useFeatureShell() {
  const native = window.orqstFeatures?.contractVersion === 1 ? window.orqstFeatures : undefined;
  const [snapshot, setSnapshot] = useState<FeatureNativeSnapshot>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!native) return;
    let live = true;
    void native
      .request({ action: 'snapshot', contractVersion: 1, generation: 0 })
      .then((reply) => {
        if (live && reply.snapshot) setSnapshot(reply.snapshot);
      })
      .catch(() => {});
    const update = (event: Event) => {
      const incoming = (event as CustomEvent<FeatureNativeSnapshot>).detail;
      setSnapshot((current) =>
        !current || incoming.generation >= current.generation ? incoming : current,
      );
    };
    window.addEventListener('orqst-feature-state', update);
    return () => {
      live = false;
      window.removeEventListener('orqst-feature-state', update);
    };
  }, [native]);
  async function select(featureId: string | null) {
    if (!native || busy || !snapshot) return;
    setBusy(true);
    try {
      const reply = await native.request({
        action: 'select',
        contractVersion: 1,
        generation: snapshot.generation,
        featureId,
        expectedRevision: snapshot.view.revision,
      });
      if (reply.snapshot) setSnapshot(reply.snapshot);
    } finally {
      setBusy(false);
    }
  }
  return { native, snapshot, busy, select };
}
