import { dashboardPathSchema } from '@orqst/protocol';
import { invoke } from '@tauri-apps/api/core';
import { createTauriStudioClient } from './studio-bridge.js';

// Install on supported dashboard documents so SPA navigation back to Studio works
// after a reload elsewhere. Native capability/identity still gate every invocation.
if (
  window.top === window.self &&
  dashboardPathSchema.safeParse(location.pathname, { jitless: true }).success
) {
  Object.defineProperty(window, 'orqstTauriStudio', {
    value: createTauriStudioClient(
      (request) => invoke('studio_request', { request }),
      () => navigator.userActivation.isActive,
    ),
  });
}
