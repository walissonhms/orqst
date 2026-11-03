import { contextBridge, ipcRenderer } from 'electron';
import { createTerminalClient } from './terminal-client.js';

// Separate bundle: the observer preload never receives this capability.
contextBridge.exposeInMainWorld(
  'orqstTerminal',
  createTerminalClient(
    (request) => ipcRenderer.invoke('orqst:terminal-native', request),
    () => navigator.userActivation.isActive,
  ),
);

// Local layout actions only; no command, identity or proof is accepted.
contextBridge.exposeInMainWorld(
  'orqstTerminalPane',
  Object.freeze({
    show(action: unknown) {
      if (!navigator.userActivation.isActive || !['dashboard', 'hide'].includes(String(action)))
        return Promise.resolve(false);
      return ipcRenderer.invoke('orqst:terminal-view', action);
    },
  }),
);
