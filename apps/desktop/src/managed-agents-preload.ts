import { contextBridge, ipcRenderer } from 'electron';
import {
  managedAgentsReplySchema,
  managedAgentsRequestSchema,
  type ManagedAgentsRequest,
  type ManagedAgentsReply,
} from '@orqst/protocol';
contextBridge.exposeInMainWorld(
  'orqstManagedAgentsClient',
  Object.freeze({
    async request(raw: ManagedAgentsRequest): Promise<ManagedAgentsReply> {
      const parsed = managedAgentsRequestSchema.safeParse(raw);
      if (
        !parsed.success ||
        (parsed.data.action !== 'snapshot' && !navigator.userActivation.isActive)
      )
        return { status: 'denied' };
      try {
        return managedAgentsReplySchema.parse(
          await ipcRenderer.invoke('orqst:managed-agents', parsed.data),
        );
      } catch {
        return { status: 'unavailable' };
      }
    },
  }),
);
