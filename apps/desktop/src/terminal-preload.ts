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
