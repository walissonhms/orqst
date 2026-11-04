import { invoke } from '@tauri-apps/api/core';
import { createAgentsClient } from './agents-bridge.js';

Object.defineProperty(window, 'orqstManagedAgentsClient', {
  value: createAgentsClient(
    (request) => invoke('agents_request', { request }),
    () => navigator.userActivation.isActive,
  ),
});
void import('../../desktop/src/managed-agents-client.js');
