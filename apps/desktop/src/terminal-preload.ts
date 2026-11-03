import { contextBridge, ipcRenderer } from 'electron';
import { createTerminalClient } from './terminal-client.js';
import { parseTerminalViewAction, type TerminalLayoutState } from './terminal-layout.js';

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
      const parsed = parseTerminalViewAction(action);
      if (!navigator.userActivation.isActive || !parsed) return Promise.resolve(false);
      return ipcRenderer.invoke('orqst:terminal-view', parsed);
    },
    onLayout(listener: (state: TerminalLayoutState) => void) {
      if (typeof listener !== 'function') return () => {};
      const receive = (_event: Electron.IpcRendererEvent, state: TerminalLayoutState) =>
        listener(state);
      ipcRenderer.on('orqst:terminal-layout', receive);
      return () => ipcRenderer.removeListener('orqst:terminal-layout', receive);
    },
  }),
);
