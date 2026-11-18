import './features-client.js';
import { invoke } from '@tauri-apps/api/core';
import {
  desktopStructuredAgentsRequestSchema,
  structuredAgentsScopeSchema,
  type DesktopStructuredAgents,
} from '@orqst/protocol';
import { mountFeatureWorkspace } from '../../dashboard/src/feature-workspace-mount.js';

if (
  location.href === 'orqst-features://local/index.html' &&
  document.documentElement.hasAttribute('data-structured-agents')
) {
  const client: DesktopStructuredAgents = {
    async request(scope, request) {
      const scoped = structuredAgentsScopeSchema.safeParse(scope, { jitless: true });
      const parsed = desktopStructuredAgentsRequestSchema.safeParse(request, { jitless: true });
      if (!scoped.success || !parsed.success) return { status: 'denied' };
      if (parsed.data.action !== 'snapshot' && !navigator.userActivation.isActive)
        return { status: 'denied' };
      return invoke('feature_structured_agents', { scope: scoped.data, request: parsed.data });
    },
  };
  Object.defineProperty(window, 'orqstStructuredAgents', { value: Object.freeze(client) });
}

mountFeatureWorkspace();
