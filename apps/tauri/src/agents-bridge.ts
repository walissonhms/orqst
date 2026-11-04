import {
  managedAgentsReplySchema,
  managedAgentsRequestSchema,
  type ManagedAgentsRequest,
  type ManagedAgentsReply,
} from '@orqst/protocol';

/** Same narrow browser boundary as the existing terminal client; no native authority here. */
export function createAgentsClient(
  invoke: (request: ManagedAgentsRequest) => Promise<unknown>,
  activated: () => boolean,
) {
  return Object.freeze({
    async request(raw: ManagedAgentsRequest): Promise<ManagedAgentsReply> {
      const parsed = managedAgentsRequestSchema.safeParse(raw);
      if (!parsed.success || (parsed.data.action !== 'snapshot' && !activated()))
        return { status: 'denied' };
      try {
        return managedAgentsReplySchema.parse(await invoke(parsed.data));
      } catch {
        return { status: 'unavailable' };
      }
    },
  });
}
