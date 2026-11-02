import { useEffect, useRef, useState, useCallback } from 'react';
import type { Snapshot, StoredEvent, StreamMessage } from '@orqst/protocol';
import { api } from './api';
export function useObservatory(onLiveEvent: (event: StoredEvent) => void) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>(
    'connecting',
  );
  const [error, setError] = useState(false);
  const liveRef = useRef(onLiveEvent);
  liveRef.current = onLiveEvent;
  const refresh = useCallback(async () => {
    const next = await api<Snapshot>('/api/snapshot');
    setSnapshot(next);
    setError(false);
    return next;
  }, []);
  useEffect(() => {
    let active = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      refreshTimer: ReturnType<typeof setTimeout> | undefined,
      cursor = 0,
      attempt = 0;
    const scheduleRefresh = (): void => {
      if (!refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          if (active) void refresh().catch(() => setError(true));
        }, 250);
    };
    const connect = async (): Promise<void> => {
      try {
        await api('/api/bootstrap');
        const next = await refresh();
        if (!active) return;
        cursor = next.cursor;
        socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?after=${cursor}`,
        );
        socket.onopen = () => {
          if (active) {
            setConnection('connected');
            setError(false);
            attempt = 0;
          }
        };
        socket.onmessage = (message) => {
          if (!active) return;
          let data: StreamMessage;
          try {
            data = JSON.parse(String(message.data)) as StreamMessage;
          } catch {
            return;
          }
          if (data.type === 'event') {
            if (data.event.sequence <= cursor) return;
            cursor = data.event.sequence;
            if (data.live) liveRef.current(data.event);
            scheduleRefresh();
          } else if (data.type === 'resync') {
            cursor = data.cursor;
            scheduleRefresh();
          } else cursor = Math.max(cursor, data.cursor);
        };
        socket.onclose = () => {
          if (active) {
            setConnection('offline');
            retry = setTimeout(
              () => {
                void connect();
              },
              Math.min(10000, 500 * 2 ** attempt++),
            );
          }
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (active) {
          setError(true);
          setConnection('offline');
          retry = setTimeout(
            () => {
              void connect();
            },
            Math.min(10000, 1000 * 2 ** attempt++),
          );
        }
      }
    };
    void connect();
    const poll = setInterval(() => {
      if (active) scheduleRefresh();
    }, 5000);
    return () => {
      active = false;
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      socket?.close();
    };
  }, [refresh]);
  return { snapshot, connection, error, refresh };
}
