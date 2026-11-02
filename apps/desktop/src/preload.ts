import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopArtifacts, ArtifactSaveRequest } from '@orqst/protocol';

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
