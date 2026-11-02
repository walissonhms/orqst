import type { AdapterDescriptor } from '@orqst/protocol';
export const opencodeDescriptor: AdapterDescriptor = {
  id: 'opencode',
  implemented: false,
  capabilities: {
    sessionDiscovery: false,
    realtimeEvents: false,
    messages: false,
    toolCalls: false,
    subagents: false,
    tokenUsage: false,
    taskResults: false,
    userIntervention: false,
    remoteControl: false,
  },
  evidence:
    'Contract only. See docs/adapters/opencode.md; no capability has been validated in ORQST.',
};
