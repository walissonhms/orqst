import { contextBridge, ipcRenderer } from 'electron';
import {
  analyticsNativeRequestSchema,
  managedAgentsOpenReplySchema,
  type ManagedAgentsOpenReply,
  type DesktopAnalytics,
  type DesktopArtifacts,
  type ArtifactSaveRequest,
} from '@orqst/protocol';

let busy = false;
const artifacts: DesktopArtifacts = {
  contractVersion: 1,
  async saveMarkdown(request: ArtifactSaveRequest) {
    // The isolated preload checks transient activation; main still requires a native grant.
    if (busy || !navigator.userActivation.isActive) return { status: 'failed' };
    busy = true;
    try {
      return await ipcRenderer.invoke('orqst:save-markdown', request);
    } catch {
      return { status: 'failed' };
    } finally {
      busy = false;
    }
  },
};
contextBridge.exposeInMainWorld('orqstArtifacts', Object.freeze(artifacts));
contextBridge.exposeInMainWorld(
  'orqstManagedAgents',
  Object.freeze({
    contractVersion: 1,
    async open(): Promise<ManagedAgentsOpenReply> {
      if (!navigator.userActivation.isActive) return { status: 'denied' };
      try {
        return managedAgentsOpenReplySchema.parse(
          await ipcRenderer.invoke('orqst:managed-agents-open'),
        );
      } catch {
        return { status: 'unavailable' };
      }
    },
  }),
);

let generation = 0;
const analytics: DesktopAnalytics = {
  contractVersion: 1,
  async setReading(reading) {
    const current = ++generation;
    const request = { contractVersion: 1, action: 'context', generation: current, reading };
    if (!analyticsNativeRequestSchema.safeParse(request).success) {
      // Invalid content must still revoke the preceding context.
      await ipcRenderer
        .invoke('orqst:analytics-export', { ...request, reading: null })
        .catch(() => {});
      return { generation: current, status: 'failed' };
    }
    try {
      const result = await ipcRenderer.invoke('orqst:analytics-export', request);
      return {
        generation: current,
        status:
          generation === current && result?.status === 'acknowledged' ? 'acknowledged' : 'failed',
      };
    } catch {
      return { generation: current, status: 'failed' };
    }
  },
  async save(format, current, reading) {
    if (!navigator.userActivation.isActive) return { status: 'failed' };
    if (busy) return { status: 'busy' };
    const request = { contractVersion: 1, action: 'save', generation: current, reading, format };
    if (current !== generation || !analyticsNativeRequestSchema.safeParse(request).success)
      return { status: 'stale' };
    busy = true;
    try {
      return await ipcRenderer.invoke('orqst:analytics-export', request);
    } catch {
      return { status: 'failed' };
    } finally {
      busy = false;
    }
  },
};
contextBridge.exposeInMainWorld('orqstAnalytics', Object.freeze(analytics));
