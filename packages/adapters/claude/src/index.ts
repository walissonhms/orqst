import type { AdapterDescriptor } from '@orqst/protocol';
export const claudeDescriptor: AdapterDescriptor = {
  id: 'claude',
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
    'Contract only. See docs/adapters/claude.md; no capability has been validated in ORQST.',
};
