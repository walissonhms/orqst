import { dashboardPathSchema } from '@orqst/protocol';
import { invoke } from '@tauri-apps/api/core';
import { createFileClients } from './files-bridge.js';

// Injected by the native shell before React starts, only in its owned top-level document.
if (
  window.top === window.self &&
  dashboardPathSchema.safeParse(location.pathname, { jitless: true }).success
) {
  const client = createFileClients(
    (request) => invoke('file_request', { request }),
    () => navigator.userActivation.isActive,
  );
  Object.defineProperty(window, 'orqstArtifacts', { value: client.artifacts });
  Object.defineProperty(window, 'orqstAnalytics', { value: client.analytics });
}
