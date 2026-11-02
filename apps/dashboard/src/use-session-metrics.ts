import { useEffect, useRef, useState } from 'react';
import {
  sessionMetricsResultSchema,
  type SessionMetrics,
  type SessionMetricsResult,
  type SessionView,
  type Snapshot,
} from '@orqst/protocol';
import { api } from './api';

export interface LiveMetricsState {
  confirmed?: SessionMetrics;
  result?: SessionMetricsResult;
  pending: boolean;
  failed: boolean;
  stale: boolean;
  offline: boolean;
}

/** One query per selected session, shared by its header and artifact panel.
 * Reuses snapshot reconciliation (WS events and the existing fallback poll), not a new timer.
 */
export function useSessionMetrics(
  session: SessionView,
  snapshot: Snapshot,
  connection: 'connecting' | 'connected' | 'offline',
  snapshotError: boolean,
): LiveMetricsState {
  const [state, setState] = useState<Omit<LiveMetricsState, 'stale' | 'offline'>>({
    pending: true,
    failed: false,
  });
  const confirmed = useRef<SessionMetrics>(undefined);
  useEffect(() => {
    if (connection !== 'connected') return;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, pending: true }));
    void api<unknown>(`/api/sessions/${encodeURIComponent(session.id)}/metrics`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const result = sessionMetricsResultSchema.parse(data);
        if (result.availability === 'available') {
          const { value } = result;
          if (
            value.identity.sessionRef.nativeSessionId !== session.id ||
            value.identity.sessionRef.adapterId !== session.adapter ||
            (confirmed.current &&
              (value.evidence.sequence < confirmed.current.evidence.sequence ||
                Date.parse(value.evidence.occurredAt) <
                  Date.parse(confirmed.current.evidence.occurredAt)))
          )
            throw new Error('Invalid session metric response');
          confirmed.current = value;
        }
        setState({ result, confirmed: confirmed.current, pending: false, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState((previous) => ({ ...previous, pending: false, failed: true }));
      });
    return () => controller.abort();
  }, [session.id, session.adapter, snapshot, connection]);
  const offline = connection !== 'connected';
  return {
    ...state,
    failed: state.failed || snapshotError,
    offline,
    stale:
      offline ||
      snapshotError ||
      state.pending ||
      state.failed ||
      state.result?.availability !== 'available',
  };
}
